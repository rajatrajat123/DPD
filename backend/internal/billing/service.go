package billing

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/auradating/platform/backend/internal/events"
)

type PreDebitNotificationSink interface {
	DeliverPreDebitNotice(ctx context.Context, notice PreDebitNotice) error
}

type Service struct {
	repo             Repository
	providers        *ProviderRegistry
	notificationSink PreDebitNotificationSink
	logger           *slog.Logger
}

func NewService(repo Repository, providers *ProviderRegistry, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		repo:      repo,
		providers: providers,
		logger:    logger,
	}
}

func (s *Service) SetNotificationSink(sink PreDebitNotificationSink) {
	s.notificationSink = sink
}

func (s *Service) ListProducts(ctx context.Context, activeOnly bool) ([]Product, error) {
	return s.repo.GetProducts(ctx, activeOnly)
}

func (s *Service) GetProductByPlanCode(ctx context.Context, planCode string) (*Product, error) {
	return s.repo.GetProductByPlanCode(ctx, planCode)
}

func (s *Service) CreateCheckout(ctx context.Context, userID, userEmail string, req CheckoutRequest) (*CheckoutSession, error) {
	product, err := s.repo.GetProductByPlanCode(ctx, req.PlanCode)
	if err != nil {
		return nil, err
	}
	if !product.IsActive {
		return nil, errors.New("selected product is currently unavailable")
	}

	// Invariant 1: Explicit subscription consent is required before checkout
	if !req.TermsAccepted {
		return nil, ErrTermsConsentRequired
	}

	// Invariant 2: India recurring payment must have compliant pre-debit sink
	if req.Storefront == "IN" || product.Currency == "INR" {
		if s.notificationSink == nil {
			return nil, fmt.Errorf("%w: RBI e-mandate pre-debit notification sink unconfigured", ErrIndiaMandateNotCompliant)
		}
	}

	adapter, err := s.providers.Get(req.Provider)
	if err != nil {
		return nil, err
	}

	// Record explicit user consent before generating checkout session
	consent := &SubscriptionConsentRecord{
		UserID:          userID,
		PlanCode:        product.PlanCode,
		PriceCents:      product.PriceCents,
		Currency:        product.Currency,
		BillingInterval: product.BillingPeriod,
		TermsVersion:    req.TermsVersion,
		ConsentGiven:    true,
		CreatedAt:       time.Now().UTC(),
	}
	if consent.TermsVersion == "" {
		consent.TermsVersion = "2026-10-v1"
	}
	_ = s.repo.RecordConsent(ctx, consent)

	return adapter.CreateCheckoutSession(ctx, userID, userEmail, *product, req.SuccessURL, req.CancelURL)
}

func (s *Service) VerifyPurchase(
	ctx context.Context,
	userID string,
	req VerifyPurchaseRequest,
	correlationID string,
) (*VerifiedTransaction, error) {
	product, err := s.repo.GetProductByPlanCode(ctx, req.PlanCode)
	if err != nil {
		return nil, err
	}

	adapter, err := s.providers.Get(req.Provider)
	if err != nil {
		return nil, err
	}

	verified, err := adapter.VerifyPurchase(ctx, req, *product)
	if err != nil {
		return nil, fmt.Errorf("purchase verification failed: %w", err)
	}

	// Record payment transaction
	var subIDPtr *string
	if product.ProductType == ProductTypeSubscription && verified.ExternalSubscriptionID != "" {
		sub := &Subscription{
			UserID:                 userID,
			PlanCode:               product.PlanCode,
			Provider:               adapter.Name(),
			ExternalSubscriptionID: verified.ExternalSubscriptionID,
			Status:                 verified.Status,
			Currency:               verified.Currency,
			PriceCents:             verified.GrossAmountCents,
			CurrentPeriodStart:     verified.PeriodStart,
			CurrentPeriodEnd:       verified.PeriodEnd,
			CancelAtPeriodEnd:      false,
		}
		if err := s.repo.UpsertSubscription(ctx, sub); err != nil {
			s.logger.Error("failed_to_upsert_subscription", slog.String("error", err.Error()), slog.String("user_id", userID))
			return nil, err
		}
		subIDPtr = &sub.ID

		// Grant subscription entitlements
		if len(product.Entitlements) > 0 {
			if err := s.repo.GrantEntitlements(
				ctx, userID, product.Entitlements, "SUBSCRIPTION", verified.PeriodEnd,
				map[string]any{"plan_code": product.PlanCode, "provider": adapter.Name()},
			); err != nil {
				s.logger.Error("failed_to_grant_subscription_entitlements", slog.String("error", err.Error()))
			}
		}

		// Add subscription boost credits (if included in plan)
		if product.BoostCredits > 0 {
			_, _ = s.repo.AddBoostCredits(ctx, userID, product.BoostCredits)
		}

		// Emit subscription activated event
		env, err := events.NewEnvelope(
			"subscription", sub.ID, "subscription.activated.v1", correlationID, 1,
			map[string]any{
				"subscription_id": sub.ID,
				"user_id":         userID,
				"plan_code":       product.PlanCode,
				"provider":        adapter.Name(),
				"expires_at":      verified.PeriodEnd,
			},
		)
		if err == nil {
			_ = s.repo.PublishOutboxEvent(ctx, env)
		}
	} else if product.ProductType == ProductTypeConsumable {
		// Grant consumable boost credits
		if product.BoostCredits > 0 {
			_, _ = s.repo.AddBoostCredits(ctx, userID, product.BoostCredits)
		}
		// Grant consumable entitlements (e.g. SUPER_SPARK)
		if len(product.Entitlements) > 0 {
			expires := time.Now().UTC().Add(365 * 24 * time.Hour)
			_ = s.repo.GrantEntitlements(ctx, userID, product.Entitlements, "PURCHASE", expires, map[string]any{"plan_code": product.PlanCode})
		}
	}

	tx := &PaymentTransaction{
		UserID:            userID,
		SubscriptionID:    subIDPtr,
		Provider:          adapter.Name(),
		ExternalChargeID:  verified.ExternalChargeID,
		TransactionType:   verified.TransactionType,
		GrossAmountCents:  verified.GrossAmountCents,
		ProviderFeeCents:  verified.ProviderFeeCents,
		TaxAmountCents:    verified.TaxAmountCents,
		NetAmountCents:    verified.NetAmountCents,
		Currency:          verified.Currency,
		BillingCycleIndex: 1,
		OccurredAt:        time.Now().UTC(),
	}
	if err := s.repo.CreateTransaction(ctx, tx); err != nil {
		s.logger.Error("failed_to_record_payment_transaction", slog.String("error", err.Error()))
		return nil, err
	}

	// Emit billing transaction verified event
	txEnv, err := events.NewEnvelope(
		"billing_transaction", tx.ID, "billing.transaction_verified.v1", correlationID, 1,
		map[string]any{
			"transaction_id":      tx.ID,
			"user_id":             userID,
			"provider":            adapter.Name(),
			"gross_amount_cents":  tx.GrossAmountCents,
			"net_amount_cents":    tx.NetAmountCents,
			"currency":            tx.Currency,
			"plan_code":           product.PlanCode,
			"billing_cycle_index": tx.BillingCycleIndex,
		},
	)
	if err == nil {
		_ = s.repo.PublishOutboxEvent(ctx, txEnv)
	}

	return verified, nil
}

func (s *Service) ProcessWebhook(ctx context.Context, providerName string, rawBody []byte, signatureHeader string) error {
	adapter, err := s.providers.Get(providerName)
	if err != nil {
		return err
	}

	payload, err := adapter.ParseAndVerifyWebhook(ctx, rawBody, signatureHeader)
	if err != nil {
		return err
	}

	// Idempotency check: Record webhook event
	isDuplicate, err := s.repo.RecordWebhookEvent(ctx, payload.EventID, adapter.Name(), payload.EventType, rawBody)
	if err != nil {
		return fmt.Errorf("failed to record webhook event: %w", err)
	}
	if isDuplicate {
		s.logger.Info("ignoring_duplicate_webhook_event", slog.String("event_id", payload.EventID), slog.String("provider", adapter.Name()))
		return nil
	}

	s.logger.Info("processing_webhook_event",
		slog.String("provider", adapter.Name()),
		slog.String("event_id", payload.EventID),
		slog.String("event_type", payload.EventType),
	)

	now := time.Now().UTC()

	switch payload.EventType {
	case "checkout.session.completed", "invoice.payment_succeeded", "DID_RENEW", "SUBSCRIPTION_RENEWED":
		if payload.ExternalSubscriptionID != "" {
			sub, err := s.repo.GetSubscriptionByExternalID(ctx, adapter.Name(), payload.ExternalSubscriptionID)
			if err == nil && sub != nil {
				sub.Status = StatusActive
				sub.CurrentPeriodStart = payload.CurrentPeriodStart
				sub.CurrentPeriodEnd = payload.CurrentPeriodEnd
				sub.CancelAtPeriodEnd = false
				_ = s.repo.UpsertSubscription(ctx, sub)

				// Grant refreshed entitlements
				prod, prodErr := s.repo.GetProductByPlanCode(ctx, sub.PlanCode)
				if prodErr == nil && prod != nil && len(prod.Entitlements) > 0 {
					_ = s.repo.GrantEntitlements(ctx, sub.UserID, prod.Entitlements, "SUBSCRIPTION", payload.CurrentPeriodEnd, map[string]any{"plan_code": sub.PlanCode})
				}

				// Emit subscription renewed event
				env, _ := events.NewEnvelope("subscription", sub.ID, "subscription.renewed.v1", payload.EventID, 1, map[string]any{
					"subscription_id": sub.ID,
					"user_id":         sub.UserID,
					"expires_at":      payload.CurrentPeriodEnd,
				})
				_ = s.repo.PublishOutboxEvent(ctx, env)

				// Record renewal transaction
				if payload.ExternalChargeID != "" {
					tx := &PaymentTransaction{
						UserID:            sub.UserID,
						SubscriptionID:    &sub.ID,
						Provider:          adapter.Name(),
						ExternalChargeID:  payload.ExternalChargeID,
						TransactionType:   TxRenewal,
						GrossAmountCents:  payload.GrossAmountCents,
						ProviderFeeCents:  payload.ProviderFeeCents,
						TaxAmountCents:    payload.TaxAmountCents,
						NetAmountCents:    payload.NetAmountCents,
						Currency:          payload.Currency,
						BillingCycleIndex: 2,
						OccurredAt:        now,
					}
					_ = s.repo.CreateTransaction(ctx, tx)

					renewalTxEnv, _ := events.NewEnvelope(
						"billing_transaction", tx.ID, "billing.transaction_verified.v1", payload.EventID, 1,
						map[string]any{
							"transaction_id":      tx.ID,
							"user_id":             sub.UserID,
							"provider":            adapter.Name(),
							"gross_amount_cents":  tx.GrossAmountCents,
							"net_amount_cents":    tx.NetAmountCents,
							"currency":            tx.Currency,
							"plan_code":           sub.PlanCode,
							"billing_cycle_index": tx.BillingCycleIndex,
						},
					)
					_ = s.repo.PublishOutboxEvent(ctx, renewalTxEnv)
				}
			}
		}

	case "invoice.upcoming":
		if payload.ExternalSubscriptionID != "" {
			sub, err := s.repo.GetSubscriptionByExternalID(ctx, adapter.Name(), payload.ExternalSubscriptionID)
			if err == nil && sub != nil {
				notice := PreDebitNotice{
					UserID:          sub.UserID,
					SubscriptionID:  sub.ID,
					ExternalSubID:   payload.ExternalSubscriptionID,
					AmountCents:     payload.GrossAmountCents,
					Currency:        payload.Currency,
					ScheduledDate:   payload.CurrentPeriodEnd,
					MandateID:       payload.ExternalSubscriptionID,
					CancellationURL: "https://auradating.com/membership?action=cancel",
				}
				if s.notificationSink != nil {
					_ = s.notificationSink.DeliverPreDebitNotice(ctx, notice)
				}
				env, _ := events.NewEnvelope("subscription", sub.ID, "billing.pre_debit_notification_scheduled.v1", payload.EventID, 1, map[string]any{
					"subscription_id": sub.ID,
					"user_id":         sub.UserID,
					"amount_cents":    payload.GrossAmountCents,
					"scheduled_date":  payload.CurrentPeriodEnd,
				})
				_ = s.repo.PublishOutboxEvent(ctx, env)
			}
		}

	case "customer.subscription.deleted", "EXPIRED":
		if payload.ExternalSubscriptionID != "" {
			sub, err := s.repo.GetSubscriptionByExternalID(ctx, adapter.Name(), payload.ExternalSubscriptionID)
			if err == nil && sub != nil {
				sub.Status = StatusExpired
				_ = s.repo.UpsertSubscription(ctx, sub)
				_ = s.repo.RevokeEntitlements(ctx, sub.UserID, "SUBSCRIPTION")

				env, _ := events.NewEnvelope("subscription", sub.ID, "subscription.expired.v1", payload.EventID, 1, map[string]any{
					"subscription_id": sub.ID,
					"user_id":         sub.UserID,
				})
				_ = s.repo.PublishOutboxEvent(ctx, env)
			}
		}

	case "customer.subscription.updated":
		if payload.ExternalSubscriptionID != "" {
			sub, err := s.repo.GetSubscriptionByExternalID(ctx, adapter.Name(), payload.ExternalSubscriptionID)
			if err == nil && sub != nil {
				if payload.Status != "" {
					sub.Status = payload.Status
				}
				sub.CancelAtPeriodEnd = payload.CancelAtPeriodEnd
				if !payload.CurrentPeriodEnd.IsZero() {
					sub.CurrentPeriodEnd = payload.CurrentPeriodEnd
				}
				_ = s.repo.UpsertSubscription(ctx, sub)

				if payload.CancelAtPeriodEnd {
					env, _ := events.NewEnvelope("subscription", sub.ID, "subscription.cancelled.v1", payload.EventID, 1, map[string]any{
						"subscription_id": sub.ID,
						"user_id":         sub.UserID,
						"expires_at":      sub.CurrentPeriodEnd,
					})
					_ = s.repo.PublishOutboxEvent(ctx, env)
				}
			}
		}

	case "charge.refunded":
		if payload.ExternalChargeID != "" {
			tx, err := s.repo.GetTransactionByExternalID(ctx, adapter.Name(), payload.ExternalChargeID)
			if err == nil && tx != nil {
				// Record refund transaction
				refundTx := &PaymentTransaction{
					UserID:           tx.UserID,
					SubscriptionID:   tx.SubscriptionID,
					Provider:         adapter.Name(),
					ExternalChargeID: fmt.Sprintf("%s_refund", payload.ExternalChargeID),
					TransactionType:  TxRefund,
					GrossAmountCents: -payload.GrossAmountCents,
					NetAmountCents:   -payload.GrossAmountCents,
					Currency:         tx.Currency,
					OccurredAt:       now,
				}
				_ = s.repo.CreateTransaction(ctx, refundTx)

				// Revoke benefits
				_ = s.repo.RevokeEntitlements(ctx, tx.UserID, "SUBSCRIPTION")

				env, _ := events.NewEnvelope("billing_transaction", tx.ID, "billing.transaction_refunded.v1", payload.EventID, 1, map[string]any{
					"transaction_id": tx.ID,
					"user_id":        tx.UserID,
					"refunded_cents": payload.GrossAmountCents,
				})
				_ = s.repo.PublishOutboxEvent(ctx, env)
			}
		}
	}

	return nil
}

func (s *Service) CancelSubscription(ctx context.Context, userID string) (*Subscription, error) {
	activeSub, err := s.repo.GetActiveSubscriptionByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if activeSub == nil {
		return nil, ErrSubscriptionNotFound
	}

	canceled, err := s.repo.CancelSubscriptionAtPeriodEnd(ctx, userID, activeSub.ID)
	if err != nil {
		return nil, err
	}

	env, err := events.NewEnvelope("subscription", canceled.ID, "subscription.cancelled.v1", "", 1, map[string]any{
		"subscription_id": canceled.ID,
		"user_id":         userID,
		"expires_at":      canceled.CurrentPeriodEnd,
	})
	if err == nil {
		_ = s.repo.PublishOutboxEvent(ctx, env)
	}

	return canceled, nil
}

func (s *Service) GetSubscriptionStatus(ctx context.Context, userID string) (*SubscriptionStatusResponse, error) {
	sub, err := s.repo.GetActiveSubscriptionByUserID(ctx, userID)
	if err != nil && !errors.Is(err, ErrSubscriptionNotFound) {
		return nil, err
	}

	tier := TierFree
	var activeSub *Subscription
	if sub != nil && sub.IsActive() {
		activeSub = sub
		prod, _ := s.repo.GetProductByPlanCode(ctx, sub.PlanCode)
		if prod != nil {
			tier = prod.Tier
		} else if strings.Contains(sub.PlanCode, "BLACK") {
			tier = TierBlack
		} else {
			tier = TierPlus
		}
	}

	ents, _ := s.repo.GetActiveEntitlements(ctx, userID)
	entCodes := make([]string, 0, len(ents))
	seenEnts := make(map[string]struct{})
	for _, e := range ents {
		if _, seen := seenEnts[e.EntitlementCode]; !seen {
			seenEnts[e.EntitlementCode] = struct{}{}
			entCodes = append(entCodes, e.EntitlementCode)
		}
	}

	credits, _ := s.repo.GetBoostCredits(ctx, userID)
	activeBoost, _ := s.repo.GetActiveProfileBoost(ctx, userID)

	return &SubscriptionStatusResponse{
		HasActiveSubscription: activeSub != nil,
		Tier:                  tier,
		Subscription:          activeSub,
		Entitlements:          entCodes,
		BoostCreditsRemaining: credits,
		ActiveBoost:           activeBoost,
	}, nil
}

func (s *Service) ListUserTransactions(ctx context.Context, userID string, limit int) ([]PaymentTransaction, error) {
	return s.repo.ListTransactionsByUserID(ctx, userID, limit)
}

func (s *Service) GetBoostStatus(ctx context.Context, userID string) (*BoostStatusResponse, error) {
	credits, err := s.repo.GetBoostCredits(ctx, userID)
	if err != nil {
		return nil, err
	}
	activeBoost, _ := s.repo.GetActiveProfileBoost(ctx, userID)

	return &BoostStatusResponse{
		CreditsRemaining: credits,
		ActiveBoost:      activeBoost,
	}, nil
}

func (s *Service) ActivateBoost(ctx context.Context, userID string, durationMinutes int) (*ActivateBoostResponse, error) {
	active, err := s.repo.GetActiveProfileBoost(ctx, userID)
	if err == nil && active != nil && active.IsActive() {
		return nil, ErrActiveBoostRunning
	}

	if durationMinutes <= 0 {
		durationMinutes = 30
	}

	// Atomically consume one credit
	remaining, err := s.repo.ConsumeBoostCredit(ctx, userID)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	boost := &ProfileBoost{
		UserID:          userID,
		DurationMinutes: durationMinutes,
		Multiplier:      2.5,
		ActivatedAt:     now,
		ExpiresAt:       now.Add(time.Duration(durationMinutes) * time.Minute),
		Status:          BoostStatusActive,
	}

	if err := s.repo.CreateProfileBoost(ctx, boost); err != nil {
		s.logger.Error("failed_to_create_profile_boost", slog.String("error", err.Error()), slog.String("user_id", userID))
		return nil, err
	}

	// Emit boost activated outbox event
	env, err := events.NewEnvelope("profile_boost", boost.ID, "boost.activated.v1", "", 1, map[string]any{
		"boost_id":         boost.ID,
		"user_id":          userID,
		"duration_minutes": durationMinutes,
		"multiplier":       boost.Multiplier,
		"expires_at":       boost.ExpiresAt,
	})
	if err == nil {
		_ = s.repo.PublishOutboxEvent(ctx, env)
	}

	return &ActivateBoostResponse{
		Boost:            boost,
		CreditsRemaining: remaining,
	}, nil
}

func (s *Service) AdminListSubscriptions(ctx context.Context, statusFilter, planFilter string, limit, offset int) ([]Subscription, int, error) {
	return s.repo.ListAllSubscriptions(ctx, statusFilter, planFilter, limit, offset)
}

func (s *Service) AdminListTransactions(ctx context.Context, txTypeFilter string, limit, offset int) ([]PaymentTransaction, int, error) {
	return s.repo.ListAllTransactions(ctx, txTypeFilter, limit, offset)
}

func (s *Service) AdminRefund(ctx context.Context, actorID string, txID string, reason string) (*PaymentTransaction, error) {
	if strings.TrimSpace(txID) == "" {
		return nil, errors.New("transaction ID is required")
	}

	tx, err := s.repo.RefundTransaction(ctx, txID, reason, actorID)
	if err != nil {
		return nil, err
	}

	env, err := events.NewEnvelope("payment_transaction", tx.ID, "billing.refund_issued.v1", "", 1, map[string]any{
		"transaction_id": tx.ID,
		"user_id":        tx.UserID,
		"amount_cents":   tx.GrossAmountCents,
		"currency":       tx.Currency,
		"reason":         reason,
		"issued_by":      actorID,
	})
	if err == nil {
		_ = s.repo.PublishOutboxEvent(ctx, env)
	}

	return tx, nil
}
