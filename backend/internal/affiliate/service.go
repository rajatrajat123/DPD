package affiliate

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/auradating/platform/backend/internal/events"
)

type Service struct {
	repo           Repository
	payoutRegistry *PayoutRegistry
	logger         *slog.Logger
}

func NewService(repo Repository, payoutRegistry *PayoutRegistry, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		repo:           repo,
		payoutRegistry: payoutRegistry,
		logger:         logger,
	}
}

// RegisterAffiliate registers a member as an affiliate partner.
func (s *Service) RegisterAffiliate(ctx context.Context, userID string, req RegisterAffiliateRequest) (*Affiliate, error) {
	if !req.TermsAccepted {
		return nil, errors.New("terms of service and affiliate agreement must be accepted")
	}

	existing, err := s.repo.GetAffiliateByUserID(ctx, userID)
	if err == nil && existing != nil {
		return nil, ErrAffiliateAlreadyExists
	}

	partnerCode := strings.ToUpper(strings.TrimSpace(req.PartnerCode))
	if partnerCode == "" {
		partnerCode = generatePartnerCode()
	} else {
		if len(partnerCode) < 3 || len(partnerCode) > 24 {
			return nil, errors.New("partner_code must be between 3 and 24 characters")
		}
		// Verify uniqueness
		if dup, _ := s.repo.GetAffiliateByPartnerCode(ctx, partnerCode); dup != nil {
			return nil, errors.New("partner_code is already taken")
		}
	}

	now := time.Now().UTC()
	termsVersion := req.TermsVersion
	if termsVersion == "" {
		termsVersion = "1.0"
	}
	minPayout := req.MinimumPayoutCents
	if minPayout <= 0 {
		minPayout = 5000 // $50.00 default
	}
	currency := strings.ToUpper(strings.TrimSpace(req.PayoutCurrency))
	if currency == "" {
		currency = "USD"
	}

	aff := &Affiliate{
		UserID:             userID,
		PartnerCode:        partnerCode,
		Status:             StatusActive, // activated upon registration
		Tier:               TierStandard,
		PayoutCurrency:     currency,
		TaxFormVerified:    false,
		TermsAcceptedAt:    &now,
		TermsVersion:       termsVersion,
		PayoutMethod:       PayoutMethodStripeConnect,
		CryptoAsset:        "USDC",
		CryptoNetwork:      "POLYGON",
		MinimumPayoutCents: minPayout,
	}

	if err := s.repo.CreateAffiliate(ctx, aff); err != nil {
		s.logger.Error("failed_to_create_affiliate", slog.String("error", err.Error()), slog.String("user_id", userID))
		return nil, err
	}

	// Create default campaign
	_ = s.repo.CreateCampaign(ctx, &AffiliateCampaign{
		AffiliateID:    aff.ID,
		CampaignSlug:   "default",
		Name:           "Default Campaign",
		DestinationURL: "https://auradating.com",
		IsActive:       true,
	})

	// Emit affiliate registered outbox event
	env, err := events.NewEnvelope(
		"affiliate", aff.ID, "affiliate.registered.v1", "", 1,
		map[string]any{
			"affiliate_id": aff.ID,
			"user_id":      userID,
			"partner_code": aff.PartnerCode,
			"tier":         aff.Tier,
		},
	)
	if err == nil {
		_ = s.repo.PublishOutboxEvent(ctx, env)
	}

	return aff, nil
}

// TrackClick logs an incoming referral link click and issues a privacy-safe attribution token.
func (s *Service) TrackClick(ctx context.Context, req TrackClickRequest) (*ClickTrackingResponse, error) {
	partnerCode := strings.ToUpper(strings.TrimSpace(req.PartnerCode))
	aff, err := s.repo.GetAffiliateByPartnerCode(ctx, partnerCode)
	if err != nil {
		return nil, ErrInvalidPartnerCode
	}
	if aff.Status != StatusActive {
		return nil, ErrAffiliateNotActive
	}

	campaignSlug := strings.ToLower(strings.TrimSpace(req.CampaignSlug))
	if campaignSlug == "" {
		campaignSlug = "default"
	}

	// Privacy protection: hash client IP and User Agent
	ipHash := hashString(req.ClientIP)
	var uaHash *string
	if req.UserAgent != "" {
		h := hashString(req.UserAgent)
		uaHash = &h
	}

	tokenBytes := make([]byte, 16)
	_, _ = rand.Read(tokenBytes)
	clickToken := fmt.Sprintf("clk_%s_%d", hex.EncodeToString(tokenBytes), time.Now().Unix())

	destURL := "https://auradating.com"
	if camp, err := s.repo.GetCampaignBySlug(ctx, aff.ID, campaignSlug); err == nil && camp != nil && camp.DestinationURL != "" {
		destURL = camp.DestinationURL
	}

	click := &ReferralClick{
		AffiliateID:   aff.ID,
		PartnerCode:   aff.PartnerCode,
		CampaignSlug:  &campaignSlug,
		ClickToken:    clickToken,
		IPHash:        ipHash,
		UserAgentHash: uaHash,
		LandingURL:    req.LandingURL,
		ClickedAt:     time.Now().UTC(),
	}

	_ = s.repo.RecordClick(ctx, click)
	_ = s.repo.IncrementCampaignClick(ctx, aff.ID, campaignSlug)

	return &ClickTrackingResponse{
		ClickToken:     clickToken,
		DestinationURL: destURL,
	}, nil
}

// AttributeRegistration binds a newly registered user to an affiliate.
func (s *Service) AttributeRegistration(ctx context.Context, referredUserID, partnerCode, campaignSlug string) (*ReferralAttribution, error) {
	code := strings.ToUpper(strings.TrimSpace(partnerCode))
	if code == "" {
		return nil, nil // Organic registration
	}

	aff, err := s.repo.GetAffiliateByPartnerCode(ctx, code)
	if err != nil {
		s.logger.Warn("invalid_affiliate_partner_code_on_reg", slog.String("partner_code", code))
		return nil, ErrInvalidPartnerCode
	}
	if aff.Status != StatusActive {
		return nil, ErrAffiliateNotActive
	}

	// Self-referral anti-fraud rule
	if aff.UserID == referredUserID {
		s.logger.Warn("self_referral_blocked", slog.String("user_id", referredUserID), slog.String("partner_code", code))
		return nil, ErrSelfReferralBlocked
	}

	var subCamp *string
	if campaignSlug != "" {
		clean := strings.ToLower(strings.TrimSpace(campaignSlug))
		subCamp = &clean
	}

	attr := &ReferralAttribution{
		ReferredUserID: referredUserID,
		AffiliateID:    aff.ID,
		PartnerCode:    aff.PartnerCode,
		SubCampaign:    subCamp,
		AttributedAt:   time.Now().UTC(),
	}

	if err := s.repo.CreateAttribution(ctx, attr); err != nil {
		s.logger.Error("failed_to_create_attribution", slog.String("error", err.Error()))
		return nil, err
	}

	if subCamp != nil {
		_ = s.repo.IncrementCampaignConversion(ctx, aff.ID, *subCamp)
	} else {
		_ = s.repo.IncrementCampaignConversion(ctx, aff.ID, "default")
	}

	// Emit outbox domain event
	env, _ := events.NewEnvelope(
		"referral_attribution", attr.ID, "affiliate.user_attributed.v1", "", 1,
		map[string]any{
			"attribution_id":   attr.ID,
			"affiliate_id":     aff.ID,
			"referred_user_id": referredUserID,
			"partner_code":     aff.PartnerCode,
		},
	)
	_ = s.repo.PublishOutboxEvent(ctx, env)

	return attr, nil
}

// ProcessVerifiedTransaction calculates and accrues commissions on verified billing transactions.
func (s *Service) ProcessVerifiedTransaction(
	ctx context.Context,
	txID, referredUserID string,
	netAmountCents int64,
	currency string,
	cycleIndex int,
) (*AffiliateCommission, error) {
	if netAmountCents <= 0 {
		return nil, nil // Zero-amount trial or promo charge produces no commission
	}

	attr, err := s.repo.GetAttributionByReferredUser(ctx, referredUserID)
	if err != nil || attr == nil {
		return nil, nil // Organic non-referred customer
	}

	aff, err := s.repo.GetAffiliateByID(ctx, attr.AffiliateID)
	if err != nil || aff == nil || aff.Status != StatusActive {
		return nil, nil // Partner not active
	}

	// Check idempotency: check if commission already exists for transaction
	if existing, _ := s.repo.GetCommissionByTransactionID(ctx, txID); existing != nil {
		s.logger.Info("ignoring_duplicate_commission_processing", slog.String("tx_id", txID), slog.String("affiliate_id", aff.ID))
		return existing, nil
	}

	// Retrieve active commission rules for partner tier
	rule, err := s.repo.GetCommissionRuleByTier(ctx, aff.Tier)
	if err != nil {
		s.logger.Error("failed_to_get_commission_rule", slog.String("tier", aff.Tier), slog.String("error", err.Error()))
		return nil, err
	}

	// Calculate commission amount C_k using integer arithmetic
	var commissionCents int64
	if cycleIndex <= 1 {
		// First purchase
		switch rule.Model {
		case ModelCPAFixed:
			commissionCents = rule.CPAAmountCents
		case ModelRevsharePercent:
			commissionCents = (netAmountCents * int64(rule.RevshareBps)) / 10000
		case ModelHybrid:
			commissionCents = rule.CPAAmountCents + ((netAmountCents * int64(rule.RevshareBps)) / 10000)
		}
	} else {
		// Recurring renewals
		if rule.RecurringEnabled && (rule.MaxRecurringMonths == 0 || cycleIndex <= rule.MaxRecurringMonths) {
			commissionCents = (netAmountCents * int64(rule.RevshareBps)) / 10000
		} else {
			commissionCents = 0
		}
	}

	if commissionCents <= 0 {
		return nil, nil
	}

	now := time.Now().UTC()
	maturesAt := now.Add(time.Duration(rule.EscrowHoldDays) * 24 * time.Hour)

	// Post Double-Entry Journal:
	// Debit: 5000_COMMISSION_EXPENSE (+commissionCents)
	// Credit: 2100_PENDING_ESCROW_{affiliate_id} (+commissionCents)
	expenseAcc, err := s.repo.GetOrCreateLedgerAccount(ctx, AccountCodeCommissionExpense, AccountTypeExpense, currency, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get expense account: %w", err)
	}

	escrowAccCode := fmt.Sprintf("2100_PENDING_ESCROW_%s", aff.ID)
	escrowAcc, err := s.repo.GetOrCreateLedgerAccount(ctx, escrowAccCode, AccountTypeLiability, currency, &aff.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get escrow account: %w", err)
	}

	journal := &LedgerJournal{
		ReferenceType: JournalCommissionAccrual,
		ReferenceID:   txID,
		Description:   fmt.Sprintf("Commission accrual for transaction %s (Cycle %d)", txID, cycleIndex),
		Currency:      currency,
		PostedAt:      now,
	}

	entries := []LedgerEntry{
		{AccountID: expenseAcc.ID, Direction: EntryDebit, AmountCents: commissionCents},
		{AccountID: escrowAcc.ID, Direction: EntryCredit, AmountCents: commissionCents},
	}

	if err := s.repo.PostJournalEntry(ctx, journal, entries); err != nil {
		s.logger.Error("failed_to_post_accrual_journal", slog.String("error", err.Error()))
		return nil, err
	}

	ruleSnapshot := map[string]any{
		"rule_id":        rule.ID,
		"rule_name":      rule.Name,
		"tier":           rule.AffiliateTier,
		"model":          rule.Model,
		"cpa_cents":      rule.CPAAmountCents,
		"revshare_bps":   rule.RevshareBps,
		"hold_days":      rule.EscrowHoldDays,
		"cycle_index":    cycleIndex,
		"net_amount":     netAmountCents,
	}

	comm := &AffiliateCommission{
		AffiliateID:           aff.ID,
		TransactionID:         txID,
		ReferredUserID:        referredUserID,
		RuleSnapshot:          ruleSnapshot,
		GrossAmountCents:      netAmountCents,
		CommissionAmountCents: commissionCents,
		Currency:              currency,
		BillingCycleIndex:     cycleIndex,
		Status:                CommissionPendingClearance,
		MaturesAt:             maturesAt,
		JournalID:             &journal.ID,
	}

	if err := s.repo.CreateCommission(ctx, comm); err != nil {
		s.logger.Error("failed_to_create_commission_record", slog.String("error", err.Error()))
		return nil, err
	}

	// Emit domain event
	env, _ := events.NewEnvelope(
		"affiliate_commission", comm.ID, "affiliate.commission_accrued.v1", txID, 1,
		map[string]any{
			"commission_id":    comm.ID,
			"affiliate_id":     aff.ID,
			"amount_cents":     comm.CommissionAmountCents,
			"currency":         comm.Currency,
			"matures_at":       comm.MaturesAt,
			"transaction_id":   txID,
		},
	)
	_ = s.repo.PublishOutboxEvent(ctx, env)

	return comm, nil
}

// ProcessTransactionRefund claws back commissions when a billing transaction is refunded.
func (s *Service) ProcessTransactionRefund(ctx context.Context, txID string) error {
	comm, err := s.repo.GetCommissionByTransactionID(ctx, txID)
	if err != nil || comm == nil {
		return nil // No commission associated with this refunded charge
	}
	if comm.Status == CommissionClawedBack {
		return nil // Already reversed
	}

	now := time.Now().UTC()
	expenseAcc, err := s.repo.GetOrCreateLedgerAccount(ctx, AccountCodeCommissionExpense, AccountTypeExpense, comm.Currency, nil)
	if err != nil {
		return err
	}

	// Compensating double-entry reversal
	var sourceAccID string
	if comm.Status == CommissionPendingClearance {
		// Clawback from Pending Escrow
		escrowAccCode := fmt.Sprintf("2100_PENDING_ESCROW_%s", comm.AffiliateID)
		escrowAcc, err := s.repo.GetOrCreateLedgerAccount(ctx, escrowAccCode, AccountTypeLiability, comm.Currency, &comm.AffiliateID)
		if err != nil {
			return err
		}
		sourceAccID = escrowAcc.ID
	} else {
		// Clawback from Payable Available
		payableAccCode := fmt.Sprintf("2200_PAYABLE_AVAILABLE_%s", comm.AffiliateID)
		payableAcc, err := s.repo.GetOrCreateLedgerAccount(ctx, payableAccCode, AccountTypeLiability, comm.Currency, &comm.AffiliateID)
		if err != nil {
			return err
		}
		sourceAccID = payableAcc.ID
	}

	journal := &LedgerJournal{
		ReferenceType: JournalRefundClawback,
		ReferenceID:   txID,
		Description:   fmt.Sprintf("Compensating clawback for refunded transaction %s", txID),
		Currency:      comm.Currency,
		PostedAt:      now,
	}

	entries := []LedgerEntry{
		{AccountID: sourceAccID, Direction: EntryDebit, AmountCents: comm.CommissionAmountCents},
		{AccountID: expenseAcc.ID, Direction: EntryCredit, AmountCents: comm.CommissionAmountCents},
	}

	if err := s.repo.PostJournalEntry(ctx, journal, entries); err != nil {
		s.logger.Error("failed_to_post_clawback_journal", slog.String("error", err.Error()))
		return err
	}

	_ = s.repo.UpdateCommissionStatus(ctx, comm.ID, CommissionClawedBack)

	// Emit clawback event
	env, _ := events.NewEnvelope(
		"affiliate_commission", comm.ID, "affiliate.commission_clawed_back.v1", txID, 1,
		map[string]any{
			"commission_id": comm.ID,
			"affiliate_id":  comm.AffiliateID,
			"amount_cents":  comm.CommissionAmountCents,
			"currency":      comm.Currency,
		},
	)
	_ = s.repo.PublishOutboxEvent(ctx, env)

	return nil
}

// MaturePendingCommissions releases matured escrow commissions into the payable balance.
func (s *Service) MaturePendingCommissions(ctx context.Context, asOf time.Time) (int, error) {
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}

	maturedList, err := s.repo.ListMaturedPendingCommissions(ctx, asOf)
	if err != nil {
		return 0, err
	}

	var maturedCount int
	for _, comm := range maturedList {
		escrowAccCode := fmt.Sprintf("2100_PENDING_ESCROW_%s", comm.AffiliateID)
		payableAccCode := fmt.Sprintf("2200_PAYABLE_AVAILABLE_%s", comm.AffiliateID)

		escrowAcc, err := s.repo.GetOrCreateLedgerAccount(ctx, escrowAccCode, AccountTypeLiability, comm.Currency, &comm.AffiliateID)
		if err != nil {
			continue
		}
		payableAcc, err := s.repo.GetOrCreateLedgerAccount(ctx, payableAccCode, AccountTypeLiability, comm.Currency, &comm.AffiliateID)
		if err != nil {
			continue
		}

		journal := &LedgerJournal{
			ReferenceType: JournalEscrowMaturation,
			ReferenceID:   comm.ID,
			Description:   fmt.Sprintf("Escrow hold maturation for commission %s", comm.ID),
			Currency:      comm.Currency,
			PostedAt:      time.Now().UTC(),
		}

		entries := []LedgerEntry{
			{AccountID: escrowAcc.ID, Direction: EntryDebit, AmountCents: comm.CommissionAmountCents},
			{AccountID: payableAcc.ID, Direction: EntryCredit, AmountCents: comm.CommissionAmountCents},
		}

		if err := s.repo.PostJournalEntry(ctx, journal, entries); err != nil {
			s.logger.Error("failed_to_post_maturation_journal", slog.String("error", err.Error()))
			continue
		}

		_ = s.repo.UpdateCommissionStatus(ctx, comm.ID, CommissionMatured)
		maturedCount++

		env, _ := events.NewEnvelope(
			"affiliate_commission", comm.ID, "affiliate.commission_matured.v1", comm.ID, 1,
			map[string]any{
				"commission_id": comm.ID,
				"affiliate_id":  comm.AffiliateID,
				"amount_cents":  comm.CommissionAmountCents,
			},
		)
		_ = s.repo.PublishOutboxEvent(ctx, env)
	}

	return maturedCount, nil
}

// RequestPayout requests disbursement of matured payable commissions.
func (s *Service) RequestPayout(ctx context.Context, affiliateID string, req RequestPayoutRequest) (*PayoutBatch, error) {
	aff, err := s.repo.GetAffiliateByID(ctx, affiliateID)
	if err != nil {
		return nil, err
	}
	if aff.Status != StatusActive {
		return nil, ErrAffiliateNotActive
	}
	if !aff.TaxFormVerified {
		return nil, ErrTaxFormUnverified
	}

	_, payableCents, _, err := s.repo.GetAffiliateBalances(ctx, aff.ID)
	if err != nil {
		return nil, err
	}

	amountCents := req.AmountCents
	if amountCents <= 0 {
		amountCents = payableCents // Full balance request
	}

	if amountCents > payableCents {
		return nil, ErrInsufficientPayable
	}
	if amountCents < aff.MinimumPayoutCents {
		return nil, ErrPayoutBelowMinimum
	}

	var destinationRef string
	switch aff.PayoutMethod {
	case PayoutMethodStripeConnect:
		if aff.StripeConnectAccountID == nil || *aff.StripeConnectAccountID == "" {
			return nil, errors.New("Stripe Connect account not configured")
		}
		destinationRef = *aff.StripeConnectAccountID
	case PayoutMethodCrypto:
		if aff.CryptoWalletAddress == nil || *aff.CryptoWalletAddress == "" {
			return nil, errors.New("crypto wallet address not configured")
		}
		destinationRef = *aff.CryptoWalletAddress
	default:
		return nil, errors.New("invalid payout method")
	}

	batch := &PayoutBatch{
		AffiliateID:          aff.ID,
		AmountCents:          amountCents,
		Currency:             aff.PayoutCurrency,
		PayoutMethod:         aff.PayoutMethod,
		DestinationReference: destinationRef,
		CryptoAsset:          aff.CryptoAsset,
		CryptoNetwork:        aff.CryptoNetwork,
		Status:               PayoutPendingApproval,
	}

	if err := s.repo.CreatePayoutBatch(ctx, batch); err != nil {
		return nil, err
	}

	return batch, nil
}

// ApproveAndDisbursePayout approves a pending payout batch and dispatches funds via provider adapter.
func (s *Service) ApproveAndDisbursePayout(ctx context.Context, batchID string) (*PayoutBatch, error) {
	batch, err := s.repo.GetPayoutBatchByID(ctx, batchID)
	if err != nil {
		return nil, err
	}
	if batch.Status != PayoutPendingApproval {
		return nil, ErrPayoutAlreadyProcessed
	}

	adapter, err := s.payoutRegistry.Get(batch.PayoutMethod)
	if err != nil {
		return nil, err
	}

	// Execute payout disbursement via provider
	result, err := adapter.DisbursePayout(ctx, batch)
	now := time.Now().UTC()
	if err != nil {
		s.logger.Error("payout_disbursement_failed", slog.String("batch_id", batch.ID), slog.String("error", err.Error()))
		reason := err.Error()
		batch.Status = PayoutFailed
		batch.FailureReason = &reason
		batch.ProcessedAt = &now
		_ = s.repo.UpdatePayoutBatch(ctx, batch)

		env, _ := events.NewEnvelope("payout_batch", batch.ID, "affiliate.payout_failed.v1", batch.ID, 1, map[string]any{
			"batch_id": batch.ID,
			"reason":   reason,
		})
		_ = s.repo.PublishOutboxEvent(ctx, env)

		return batch, err
	}

	// Post Double-Entry Journal on Successful Disbursement:
	// Debit: 2200_PAYABLE_AVAILABLE_{affiliate_id} (+batch.AmountCents)
	// Credit: 1010_PLATFORM_CASH (+batch.AmountCents)
	payableAccCode := fmt.Sprintf("2200_PAYABLE_AVAILABLE_%s", batch.AffiliateID)
	payableAcc, err := s.repo.GetOrCreateLedgerAccount(ctx, payableAccCode, AccountTypeLiability, batch.Currency, &batch.AffiliateID)
	if err != nil {
		return nil, err
	}

	cashAcc, err := s.repo.GetOrCreateLedgerAccount(ctx, AccountCodePlatformCash, AccountTypeAsset, batch.Currency, nil)
	if err != nil {
		return nil, err
	}

	journal := &LedgerJournal{
		ReferenceType: JournalPayoutSettlement,
		ReferenceID:   batch.ID,
		Description:   fmt.Sprintf("Disbursement for payout batch %s via %s", batch.ID, batch.PayoutMethod),
		Currency:      batch.Currency,
		PostedAt:      now,
	}

	entries := []LedgerEntry{
		{AccountID: payableAcc.ID, Direction: EntryDebit, AmountCents: batch.AmountCents},
		{AccountID: cashAcc.ID, Direction: EntryCredit, AmountCents: batch.AmountCents},
	}

	if err := s.repo.PostJournalEntry(ctx, journal, entries); err != nil {
		s.logger.Error("failed_to_post_payout_settlement_journal", slog.String("error", err.Error()))
		return nil, err
	}

	batch.Status = PayoutPaid
	batch.ExternalPayoutID = &result.ExternalPayoutID
	batch.JournalID = &journal.ID
	batch.ProcessedAt = &now
	_ = s.repo.UpdatePayoutBatch(ctx, batch)

	env, _ := events.NewEnvelope(
		"payout_batch", batch.ID, "affiliate.payout_disbursed.v1", batch.ID, 1,
		map[string]any{
			"batch_id":           batch.ID,
			"affiliate_id":       batch.AffiliateID,
			"amount_cents":       batch.AmountCents,
			"currency":           batch.Currency,
			"external_payout_id": result.ExternalPayoutID,
		},
	)
	_ = s.repo.PublishOutboxEvent(ctx, env)

	return batch, nil
}

// RejectPayout rejects a pending payout batch and keeps the payable balance available.
func (s *Service) RejectPayout(ctx context.Context, batchID, reason string) (*PayoutBatch, error) {
	batch, err := s.repo.GetPayoutBatchByID(ctx, batchID)
	if err != nil {
		return nil, err
	}
	if batch.Status != PayoutPendingApproval {
		return nil, ErrPayoutAlreadyProcessed
	}

	now := time.Now().UTC()
	batch.Status = PayoutCancelled
	batch.FailureReason = &reason
	batch.ProcessedAt = &now
	if err := s.repo.UpdatePayoutBatch(ctx, batch); err != nil {
		return nil, err
	}

	return batch, nil
}

// GetAffiliateSummary returns dashboard statistics for an affiliate.
func (s *Service) GetAffiliateSummary(ctx context.Context, affiliateID string) (*AffiliateDashboardSummary, error) {
	aff, err := s.repo.GetAffiliateByID(ctx, affiliateID)
	if err != nil {
		return nil, err
	}

	pendingEscrow, payable, lifetimePaid, err := s.repo.GetAffiliateBalances(ctx, aff.ID)
	if err != nil {
		return nil, err
	}

	campaigns, _ := s.repo.ListCampaigns(ctx, aff.ID)
	var totalClicks, totalConversions int64
	for _, c := range campaigns {
		totalClicks += c.ClicksCount
		totalConversions += c.ConversionsCount
	}

	return &AffiliateDashboardSummary{
		Affiliate: *aff,
		Balances: AffiliateBalanceSummary{
			PendingEscrowCents: pendingEscrow,
			PayableCents:       payable,
			LifetimePaidCents:  lifetimePaid,
			Currency:           aff.PayoutCurrency,
		},
		TotalClicks:  totalClicks,
		Conversions:  totalConversions,
		Campaigns:    campaigns,
	}, nil
}

func generatePartnerCode() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return fmt.Sprintf("AURA%s", strings.ToUpper(hex.EncodeToString(b)))
}

func hashString(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// HandleBillingEvent safely handles verified billing domain events emitted by the billing service.
func (s *Service) HandleBillingEvent(ctx context.Context, env events.Envelope) error {
	switch env.EventType {
	case "billing.transaction_verified.v1":
		var payload struct {
			TransactionID     string `json:"transaction_id"`
			UserID            string `json:"user_id"`
			GrossAmountCents  int64  `json:"gross_amount_cents"`
			NetAmountCents    int64  `json:"net_amount_cents"`
			Currency          string `json:"currency"`
			BillingCycleIndex int    `json:"billing_cycle_index"`
		}
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			return fmt.Errorf("failed to decode billing.transaction_verified.v1 payload: %w", err)
		}
		netAmount := payload.NetAmountCents
		if netAmount <= 0 {
			netAmount = payload.GrossAmountCents
		}
		cycle := payload.BillingCycleIndex
		if cycle <= 0 {
			cycle = 1
		}
		_, err := s.ProcessVerifiedTransaction(ctx, payload.TransactionID, payload.UserID, netAmount, payload.Currency, cycle)
		return err

	case "billing.transaction_refunded.v1":
		var payload struct {
			TransactionID string `json:"transaction_id"`
		}
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			return fmt.Errorf("failed to decode billing.transaction_refunded.v1 payload: %w", err)
		}
		return s.ProcessTransactionRefund(ctx, payload.TransactionID)
	}

	return nil
}
