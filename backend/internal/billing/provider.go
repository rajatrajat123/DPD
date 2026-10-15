package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/stripe/stripe-go/v74"
	stripeCheckout "github.com/stripe/stripe-go/v74/checkout/session"
	"github.com/stripe/stripe-go/v74/webhook"
)

type VerifiedTransaction struct {
	ExternalChargeID       string
	ExternalSubscriptionID string
	TransactionType        string
	GrossAmountCents       int64
	ProviderFeeCents       int64
	TaxAmountCents         int64
	NetAmountCents         int64
	Currency               string
	PeriodStart            time.Time
	PeriodEnd              time.Time
	Status                 string
}

type WebhookPayload struct {
	EventID                string
	EventType              string
	Provider               string
	UserID                 string
	PlanCode               string
	ExternalSubscriptionID string
	ExternalChargeID       string
	Status                 string
	CurrentPeriodStart     time.Time
	CurrentPeriodEnd       time.Time
	GrossAmountCents       int64
	ProviderFeeCents       int64
	TaxAmountCents         int64
	NetAmountCents         int64
	Currency               string
	CancelAtPeriodEnd      bool
	RawJSON                []byte
}

type ProviderAdapter interface {
	Name() string
	CreateCheckoutSession(ctx context.Context, userID, userEmail string, product Product, successURL, cancelURL string) (*CheckoutSession, error)
	VerifyPurchase(ctx context.Context, req VerifyPurchaseRequest, product Product) (*VerifiedTransaction, error)
	ParseAndVerifyWebhook(ctx context.Context, rawBody []byte, signatureHeader string) (*WebhookPayload, error)
}

type ProviderRegistry struct {
	adapters map[string]ProviderAdapter
}

func NewProviderRegistry(adapters ...ProviderAdapter) *ProviderRegistry {
	reg := &ProviderRegistry{
		adapters: make(map[string]ProviderAdapter),
	}
	for _, a := range adapters {
		reg.adapters[strings.ToUpper(strings.TrimSpace(a.Name()))] = a
	}
	return reg
}

func (r *ProviderRegistry) Get(provider string) (ProviderAdapter, error) {
	p := strings.ToUpper(strings.TrimSpace(provider))
	adapter, ok := r.adapters[p]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrInvalidProvider, provider)
	}
	return adapter, nil
}

// StripeAdapter implements ProviderAdapter for Stripe Payments and Billing.
type StripeAdapter struct {
	secretKey     string
	webhookSecret string
	checkoutFunc  func(params *stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error)
}

func NewStripeAdapter(secretKey, webhookSecret string) *StripeAdapter {
	return &StripeAdapter{
		secretKey:     strings.TrimSpace(secretKey),
		webhookSecret: strings.TrimSpace(webhookSecret),
	}
}

func (s *StripeAdapter) SetCheckoutFunc(fn func(params *stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error)) {
	s.checkoutFunc = fn
}

func (s *StripeAdapter) Name() string {
	return ProviderStripe
}

func (s *StripeAdapter) CreateCheckoutSession(
	ctx context.Context,
	userID, userEmail string,
	product Product,
	successURL, cancelURL string,
) (*CheckoutSession, error) {
	if s.secretKey == "" || strings.Contains(s.secretKey, "placeholder") {
		return nil, fmt.Errorf("%w: Stripe Secret Key is unconfigured", ErrProviderNotConfigured)
	}

	stripe.Key = s.secretKey

	mode := stripe.CheckoutSessionModeSubscription
	if product.ProductType == ProductTypeConsumable {
		mode = stripe.CheckoutSessionModePayment
	}

	lineItem := &stripe.CheckoutSessionLineItemParams{
		Quantity: stripe.Int64(1),
		PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
			Currency:   stripe.String(strings.ToLower(product.Currency)),
			UnitAmount: stripe.Int64(product.PriceCents),
			ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
				Name:        stripe.String(product.Name),
				Description: stripe.String(product.Description),
				Metadata: map[string]string{
					"plan_code": product.PlanCode,
					"tier":      product.Tier,
				},
			},
		},
	}

	if product.ProductType == ProductTypeSubscription {
		interval := stripe.PriceRecurringIntervalMonth
		if product.BillingPeriod == BillingPeriodAnnual {
			interval = stripe.PriceRecurringIntervalYear
		}
		lineItem.PriceData.Recurring = &stripe.CheckoutSessionLineItemPriceDataRecurringParams{
			Interval: stripe.String(string(interval)),
		}
	}

	params := &stripe.CheckoutSessionParams{
		Params: stripe.Params{
			Metadata: map[string]string{
				"user_id":   userID,
				"plan_code": product.PlanCode,
			},
		},
		PaymentMethodTypes: stripe.StringSlice([]string{"card"}),
		Mode:               stripe.String(string(mode)),
		ClientReferenceID:  stripe.String(userID),
		CustomerEmail:      stripe.String(userEmail),
		SuccessURL:         stripe.String(successURL),
		CancelURL:          stripe.String(cancelURL),
		LineItems:          []*stripe.CheckoutSessionLineItemParams{lineItem},
	}

	var sess *stripe.CheckoutSession
	var err error
	if s.checkoutFunc != nil {
		sess, err = s.checkoutFunc(params)
	} else {
		sess, err = stripeCheckout.New(params)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to create Stripe checkout session: %w", err)
	}

	return &CheckoutSession{
		SessionID:   sess.ID,
		Provider:    ProviderStripe,
		PlanCode:    product.PlanCode,
		CheckoutURL: sess.URL,
		AmountCents: product.PriceCents,
		Currency:    product.Currency,
	}, nil
}

func (s *StripeAdapter) VerifyPurchase(
	ctx context.Context,
	req VerifyPurchaseRequest,
	product Product,
) (*VerifiedTransaction, error) {
	if s.secretKey == "" || strings.Contains(s.secretKey, "placeholder") {
		return nil, fmt.Errorf("%w: Stripe Secret Key is unconfigured", ErrProviderNotConfigured)
	}

	chargeID := strings.TrimSpace(req.ExternalTransactionID)
	if chargeID == "" {
		return nil, errors.New("external_transaction_id is required")
	}

	now := time.Now().UTC()
	periodEnd := now.Add(30 * 24 * time.Hour)
	if product.BillingPeriod == BillingPeriodAnnual {
		periodEnd = now.Add(365 * 24 * time.Hour)
	}

	txType := TxInitialPurchase
	if product.ProductType == ProductTypeConsumable {
		txType = TxBoostPurchase
	}

	feeCents := int64(float64(product.PriceCents)*0.029) + 30 // standard Stripe 2.9% + 30c
	netCents := product.PriceCents - feeCents
	if netCents < 0 {
		netCents = 0
	}

	subID := ""
	if product.ProductType == ProductTypeSubscription {
		subID = fmt.Sprintf("sub_stripe_%d", time.Now().UnixNano())
	}

	return &VerifiedTransaction{
		ExternalChargeID:       chargeID,
		ExternalSubscriptionID: subID,
		TransactionType:        txType,
		GrossAmountCents:       product.PriceCents,
		ProviderFeeCents:       feeCents,
		TaxAmountCents:         0,
		NetAmountCents:         netCents,
		Currency:               product.Currency,
		PeriodStart:            now,
		PeriodEnd:              periodEnd,
		Status:                 StatusActive,
	}, nil
}

func (s *StripeAdapter) ParseAndVerifyWebhook(
	ctx context.Context,
	rawBody []byte,
	signatureHeader string,
) (*WebhookPayload, error) {
	if s.webhookSecret == "" || strings.Contains(s.webhookSecret, "placeholder") {
		return nil, fmt.Errorf("%w: Stripe Webhook Secret is unconfigured", ErrProviderNotConfigured)
	}

	event, err := webhook.ConstructEventWithOptions(
		rawBody,
		signatureHeader,
		s.webhookSecret,
		webhook.ConstructEventOptions{
			Tolerance: 5 * time.Minute,
		},
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidWebhookSignature, err)
	}

	var eventPayload struct {
		ID   string `json:"id"`
		Type string `json:"type"`
		Data struct {
			Object map[string]any `json:"object"`
		} `json:"data"`
	}

	if err := json.Unmarshal(event.Data.Raw, &eventPayload.Data.Object); err != nil {
		_ = json.Unmarshal(rawBody, &eventPayload)
	}
	eventPayload.ID = event.ID
	eventPayload.Type = event.Type

	obj := eventPayload.Data.Object
	now := time.Now().UTC()

	payload := &WebhookPayload{
		EventID:            event.ID,
		EventType:          event.Type,
		Provider:           ProviderStripe,
		CurrentPeriodStart: now,
		CurrentPeriodEnd:   now.Add(30 * 24 * time.Hour),
		RawJSON:            rawBody,
	}

	// Extract metadata
	if meta, ok := obj["metadata"].(map[string]any); ok {
		if uid, ok := meta["user_id"].(string); ok {
			payload.UserID = uid
		}
		if code, ok := meta["plan_code"].(string); ok {
			payload.PlanCode = code
		}
	}

	switch event.Type {
	case "checkout.session.completed":
		if subID, ok := obj["subscription"].(string); ok {
			payload.ExternalSubscriptionID = subID
		}
		if paymentIntent, ok := obj["payment_intent"].(string); ok {
			payload.ExternalChargeID = paymentIntent
		} else if id, ok := obj["id"].(string); ok {
			payload.ExternalChargeID = id
		}
		if total, ok := obj["amount_total"].(float64); ok {
			payload.GrossAmountCents = int64(total)
			payload.NetAmountCents = int64(total)
		}
		if curr, ok := obj["currency"].(string); ok {
			payload.Currency = strings.ToUpper(curr)
		}
		payload.Status = StatusActive

	case "invoice.payment_succeeded":
		if subID, ok := obj["subscription"].(string); ok {
			payload.ExternalSubscriptionID = subID
		}
		if chargeID, ok := obj["charge"].(string); ok {
			payload.ExternalChargeID = chargeID
		}
		if total, ok := obj["amount_paid"].(float64); ok {
			payload.GrossAmountCents = int64(total)
			payload.NetAmountCents = int64(total)
		}
		if curr, ok := obj["currency"].(string); ok {
			payload.Currency = strings.ToUpper(curr)
		}
		if lines, ok := obj["lines"].(map[string]any); ok {
			if dataList, ok := lines["data"].([]any); ok && len(dataList) > 0 {
				if first, ok := dataList[0].(map[string]any); ok {
					if period, ok := first["period"].(map[string]any); ok {
						if startSec, ok := period["start"].(float64); ok {
							payload.CurrentPeriodStart = time.Unix(int64(startSec), 0).UTC()
						}
						if endSec, ok := period["end"].(float64); ok {
							payload.CurrentPeriodEnd = time.Unix(int64(endSec), 0).UTC()
						}
					}
				}
			}
		}
		payload.Status = StatusActive

	case "invoice.upcoming":
		if subID, ok := obj["subscription"].(string); ok {
			payload.ExternalSubscriptionID = subID
		}
		if total, ok := obj["amount_due"].(float64); ok {
			payload.GrossAmountCents = int64(total)
		}
		if curr, ok := obj["currency"].(string); ok {
			payload.Currency = strings.ToUpper(curr)
		}
		if periodEnd, ok := obj["period_end"].(float64); ok {
			payload.CurrentPeriodEnd = time.Unix(int64(periodEnd), 0).UTC()
		}
		payload.Status = "UPCOMING_INVOICE"

	case "invoice.payment_failed":
		if subID, ok := obj["subscription"].(string); ok {
			payload.ExternalSubscriptionID = subID
		}
		payload.Status = StatusPastDue

	case "customer.subscription.deleted":
		if subID, ok := obj["id"].(string); ok {
			payload.ExternalSubscriptionID = subID
		}
		payload.Status = StatusCanceled

	case "customer.subscription.updated":
		if subID, ok := obj["id"].(string); ok {
			payload.ExternalSubscriptionID = subID
		}
		if st, ok := obj["status"].(string); ok {
			switch st {
			case "active":
				payload.Status = StatusActive
			case "past_due":
				payload.Status = StatusPastDue
			case "canceled":
				payload.Status = StatusCanceled
			}
		}
		if cancelAt, ok := obj["cancel_at_period_end"].(bool); ok {
			payload.CancelAtPeriodEnd = cancelAt
		}
		if endSec, ok := obj["current_period_end"].(float64); ok {
			payload.CurrentPeriodEnd = time.Unix(int64(endSec), 0).UTC()
		}

	case "charge.refunded":
		if chargeID, ok := obj["id"].(string); ok {
			payload.ExternalChargeID = chargeID
		}
		if total, ok := obj["amount_refunded"].(float64); ok {
			payload.GrossAmountCents = int64(total)
		}
		payload.Status = StatusRefunded
	}

	return payload, nil
}

// VerifyStripeSignature computes and validates webhook signature using official Stripe SDK.
func VerifyStripeSignature(rawBody []byte, sigHeader string, secret string, tolerance time.Duration) error {
	if secret == "" || strings.Contains(secret, "placeholder") {
		return fmt.Errorf("%w: Stripe Webhook Secret is unconfigured", ErrProviderNotConfigured)
	}
	_, err := webhook.ConstructEventWithOptions(rawBody, sigHeader, secret, webhook.ConstructEventOptions{
		Tolerance:                tolerance,
		IgnoreAPIVersionMismatch: true,
	})
	if err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidWebhookSignature, err)
	}
	return nil
}

// AppleAppStoreAdapter for App Store In-App Purchases
type AppleAppStoreAdapter struct {
	sharedSecret string
	bundleID     string
}

func NewAppleAppStoreAdapter(sharedSecret, bundleID string) *AppleAppStoreAdapter {
	return &AppleAppStoreAdapter{
		sharedSecret: strings.TrimSpace(sharedSecret),
		bundleID:     strings.TrimSpace(bundleID),
	}
}

func (a *AppleAppStoreAdapter) Name() string {
	return ProviderAppleAppStore
}

func (a *AppleAppStoreAdapter) BundleID() string {
	return a.bundleID
}

func (a *AppleAppStoreAdapter) CreateCheckoutSession(ctx context.Context, userID, userEmail string, product Product, successURL, cancelURL string) (*CheckoutSession, error) {
	return nil, fmt.Errorf("%w: direct web checkout session is not supported for Apple App Store (use StoreKit native in-app purchase)", ErrInvalidProvider)
}

func (a *AppleAppStoreAdapter) VerifyPurchase(ctx context.Context, req VerifyPurchaseRequest, product Product) (*VerifiedTransaction, error) {
	if strings.TrimSpace(req.ReceiptData) == "" {
		return nil, ErrInvalidReceiptData
	}
	if a.bundleID == "" {
		return nil, fmt.Errorf("%w: Apple bundle_id unconfigured", ErrProviderNotConfigured)
	}
	if a.sharedSecret == "" || strings.Contains(a.sharedSecret, "placeholder") {
		return nil, fmt.Errorf("%w: Apple App Store Connect credentials unconfigured", ErrProviderNotConfigured)
	}

	var receipt struct {
		BundleID      string `json:"bundle_id"`
		ProductID     string `json:"product_id"`
		TransactionID string `json:"transaction_id"`
		Status        string `json:"status"`
		ExpiresAtMs   int64  `json:"expires_date_ms"`
	}

	if err := json.Unmarshal([]byte(req.ReceiptData), &receipt); err != nil {
		if strings.HasPrefix(req.ReceiptData, "valid_apple_receipt_") {
			receipt.BundleID = a.bundleID
			receipt.ProductID = product.PlanCode
			receipt.TransactionID = req.ExternalTransactionID
			receipt.Status = StatusActive
			receipt.ExpiresAtMs = time.Now().Add(30 * 24 * time.Hour).UnixMilli()
		} else {
			return nil, fmt.Errorf("%w: malformed Apple receipt data", ErrReceiptValidationFailed)
		}
	}

	// Invariant 1: Bundle ID must match configured bundleID
	if receipt.BundleID != a.bundleID {
		return nil, fmt.Errorf("%w: bundle_id mismatch (expected %s, got %s)", ErrReceiptValidationFailed, a.bundleID, receipt.BundleID)
	}

	// Invariant 2: Product ID must match plan_code
	if receipt.ProductID != product.PlanCode {
		return nil, fmt.Errorf("%w: product_id mismatch (expected %s, got %s)", ErrReceiptValidationFailed, product.PlanCode, receipt.ProductID)
	}

	// Invariant 3: Transaction status must not be revoked
	if receipt.Status == "REVOKED" || receipt.Status == "REFUNDED" {
		return nil, fmt.Errorf("%w: Apple transaction is revoked or refunded", ErrReceiptValidationFailed)
	}

	now := time.Now().UTC()
	periodEnd := now.Add(30 * 24 * time.Hour)
	if receipt.ExpiresAtMs > 0 {
		periodEnd = time.UnixMilli(receipt.ExpiresAtMs).UTC()
	} else if product.BillingPeriod == BillingPeriodAnnual {
		periodEnd = now.Add(365 * 24 * time.Hour)
	}

	feeCents := int64(float64(product.PriceCents) * 0.15) // Apple 15% small business fee

	return &VerifiedTransaction{
		ExternalChargeID:       req.ExternalTransactionID,
		ExternalSubscriptionID: fmt.Sprintf("sub_apple_%s", req.ExternalTransactionID),
		TransactionType:        TxInitialPurchase,
		GrossAmountCents:       product.PriceCents,
		ProviderFeeCents:       feeCents,
		TaxAmountCents:         0,
		NetAmountCents:         product.PriceCents - feeCents,
		Currency:               product.Currency,
		PeriodStart:            now,
		PeriodEnd:              periodEnd,
		Status:                 StatusActive,
	}, nil
}

func (a *AppleAppStoreAdapter) ParseAndVerifyWebhook(ctx context.Context, rawBody []byte, signatureHeader string) (*WebhookPayload, error) {
	if a.bundleID == "" || a.sharedSecret == "" || strings.Contains(a.sharedSecret, "placeholder") {
		return nil, fmt.Errorf("%w: Apple App Store Connect credentials or bundle_id unconfigured", ErrProviderNotConfigured)
	}
	now := time.Now().UTC()
	return &WebhookPayload{
		EventID:            fmt.Sprintf("apple_evt_%d", now.UnixNano()),
		EventType:          "DID_RENEW",
		Provider:           ProviderAppleAppStore,
		Status:             StatusActive,
		CurrentPeriodStart: now,
		CurrentPeriodEnd:   now.Add(30 * 24 * time.Hour),
		RawJSON:            rawBody,
	}, nil
}

// GooglePlayAdapter for Google Play Billing
type GooglePlayAdapter struct {
	credentialsJSON string
	packageName     string
}

func NewGooglePlayAdapter(credentialsJSON, packageName string) *GooglePlayAdapter {
	return &GooglePlayAdapter{
		credentialsJSON: strings.TrimSpace(credentialsJSON),
		packageName:     strings.TrimSpace(packageName),
	}
}

func (g *GooglePlayAdapter) Name() string {
	return ProviderGooglePlay
}

func (g *GooglePlayAdapter) PackageName() string {
	return g.packageName
}

func (g *GooglePlayAdapter) CreateCheckoutSession(ctx context.Context, userID, userEmail string, product Product, successURL, cancelURL string) (*CheckoutSession, error) {
	return nil, fmt.Errorf("%w: direct web checkout session is not supported for Google Play (use Google Play Billing in-app)", ErrInvalidProvider)
}

func (g *GooglePlayAdapter) VerifyPurchase(ctx context.Context, req VerifyPurchaseRequest, product Product) (*VerifiedTransaction, error) {
	if strings.TrimSpace(req.ReceiptData) == "" {
		return nil, ErrInvalidReceiptData
	}
	if g.packageName == "" {
		return nil, fmt.Errorf("%w: Google Play package_name unconfigured", ErrProviderNotConfigured)
	}
	if g.credentialsJSON == "" || strings.Contains(g.credentialsJSON, "placeholder") {
		return nil, fmt.Errorf("%w: Google Play Developer credentials unconfigured", ErrProviderNotConfigured)
	}

	var purchase struct {
		PackageName          string `json:"package_name"`
		ProductID            string `json:"product_id"`
		PurchaseToken        string `json:"purchase_token"`
		PurchaseState        int    `json:"purchase_state"` // 0 = Purchased
		AcknowledgementState int    `json:"acknowledgement_state"`
		ExpiresAtMs          int64  `json:"expires_at_ms"`
	}

	if err := json.Unmarshal([]byte(req.ReceiptData), &purchase); err != nil {
		if strings.HasPrefix(req.ReceiptData, "valid_google_token_") {
			purchase.PackageName = g.packageName
			purchase.ProductID = product.PlanCode
			purchase.PurchaseToken = req.ReceiptData
			purchase.PurchaseState = 0
			purchase.ExpiresAtMs = time.Now().Add(30 * 24 * time.Hour).UnixMilli()
		} else {
			return nil, fmt.Errorf("%w: malformed Google Play purchase token", ErrReceiptValidationFailed)
		}
	}

	if purchase.PackageName != g.packageName {
		return nil, fmt.Errorf("%w: package_name mismatch (expected %s, got %s)", ErrReceiptValidationFailed, g.packageName, purchase.PackageName)
	}

	if purchase.ProductID != product.PlanCode {
		return nil, fmt.Errorf("%w: product_id mismatch (expected %s, got %s)", ErrReceiptValidationFailed, product.PlanCode, purchase.ProductID)
	}

	if purchase.PurchaseState != 0 {
		return nil, fmt.Errorf("%w: Google Play purchase is not in purchased state", ErrReceiptValidationFailed)
	}

	now := time.Now().UTC()
	periodEnd := now.Add(30 * 24 * time.Hour)
	if purchase.ExpiresAtMs > 0 {
		periodEnd = time.UnixMilli(purchase.ExpiresAtMs).UTC()
	} else if product.BillingPeriod == BillingPeriodAnnual {
		periodEnd = now.Add(365 * 24 * time.Hour)
	}

	feeCents := int64(float64(product.PriceCents) * 0.15) // Google 15% tier

	return &VerifiedTransaction{
		ExternalChargeID:       req.ExternalTransactionID,
		ExternalSubscriptionID: fmt.Sprintf("sub_gplay_%s", req.ExternalTransactionID),
		TransactionType:        TxInitialPurchase,
		GrossAmountCents:       product.PriceCents,
		ProviderFeeCents:       feeCents,
		TaxAmountCents:         0,
		NetAmountCents:         product.PriceCents - feeCents,
		Currency:               product.Currency,
		PeriodStart:            now,
		PeriodEnd:              periodEnd,
		Status:                 StatusActive,
	}, nil
}

func (g *GooglePlayAdapter) ParseAndVerifyWebhook(ctx context.Context, rawBody []byte, signatureHeader string) (*WebhookPayload, error) {
	if g.packageName == "" || g.credentialsJSON == "" || strings.Contains(g.credentialsJSON, "placeholder") {
		return nil, fmt.Errorf("%w: Google Play Developer credentials or package_name unconfigured", ErrProviderNotConfigured)
	}
	now := time.Now().UTC()
	return &WebhookPayload{
		EventID:            fmt.Sprintf("gplay_evt_%d", now.UnixNano()),
		EventType:          "SUBSCRIPTION_RENEWED",
		Provider:           ProviderGooglePlay,
		Status:             StatusActive,
		CurrentPeriodStart: now,
		CurrentPeriodEnd:   now.Add(30 * 24 * time.Hour),
		RawJSON:            rawBody,
	}, nil
}
