package billing_test

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/billing"
	"github.com/auradating/platform/backend/internal/discovery"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/stripe/stripe-go/v74"
)

type mockPreDebitSink struct {
	mu      sync.Mutex
	notices []billing.PreDebitNotice
}

func (m *mockPreDebitSink) DeliverPreDebitNotice(ctx context.Context, notice billing.PreDebitNotice) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.notices = append(m.notices, notice)
	return nil
}

func setupTestBillingService(t *testing.T) (*billing.Service, *billing.MemoryRepository) {
	t.Helper()
	repo := billing.NewMemoryRepository()
	stripeAdapter := billing.NewStripeAdapter("sk_test_123", "whsec_test_secret_456")
	stripeAdapter.SetCheckoutFunc(func(params *stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error) {
		return &stripe.CheckoutSession{
			ID:  "cs_test_mock_12345",
			URL: "https://checkout.stripe.com/c/pay/cs_test_mock_12345",
		}, nil
	})
	appleAdapter := billing.NewAppleAppStoreAdapter("apple_secret", "com.aura.dating")
	googleAdapter := billing.NewGooglePlayAdapter(`{"project_id":"aura-dev"}`, "com.aura.dating")
	reg := billing.NewProviderRegistry(stripeAdapter, appleAdapter, googleAdapter)
	svc := billing.NewService(repo, reg, nil)
	return svc, repo
}

func TestProductCatalog(t *testing.T) {
	svc, _ := setupTestBillingService(t)
	ctx := context.Background()

	products, err := svc.ListProducts(ctx, true)
	if err != nil {
		t.Fatalf("failed to list products: %v", err)
	}
	if len(products) < 6 {
		t.Errorf("expected at least 6 active products, got %d", len(products))
	}

	plus, err := svc.GetProductByPlanCode(ctx, billing.PlanAuraPlusMonthly)
	if err != nil {
		t.Fatalf("failed to get aura plus: %v", err)
	}
	if plus.PriceCents != 1999 {
		t.Errorf("expected price 1999 cents, got %d", plus.PriceCents)
	}
	if plus.Tier != billing.TierPlus {
		t.Errorf("expected tier PLUS, got %s", plus.Tier)
	}
}

func TestCheckoutSessionCreation(t *testing.T) {
	svc, _ := setupTestBillingService(t)
	ctx := context.Background()

	session, err := svc.CreateCheckout(ctx, "usr_1", "test@aura.dating", billing.CheckoutRequest{
		PlanCode:      billing.PlanAuraPlusMonthly,
		Provider:      billing.ProviderStripe,
		SuccessURL:    "https://aura.dating/success",
		CancelURL:     "https://aura.dating/cancel",
		TermsAccepted: true,
		TermsVersion:  "2026-10-15",
	})
	if err != nil {
		t.Fatalf("failed to create checkout session: %v", err)
	}
	if session.SessionID == "" {
		t.Errorf("expected non-empty session ID")
	}
	if session.AmountCents != 1999 {
		t.Errorf("expected 1999 cents, got %d", session.AmountCents)
	}
}

func TestPurchaseVerificationAndSubscriptionLifecycle(t *testing.T) {
	svc, repo := setupTestBillingService(t)
	ctx := context.Background()
	userID := "usr_subscriber_1"

	// 1. Initial purchase of Aura Plus Annual
	verified, err := svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderStripe,
		PlanCode:              billing.PlanAuraPlusAnnual,
		ExternalTransactionID: "ch_test_123",
	}, "corr_1")
	if err != nil {
		t.Fatalf("verify purchase failed: %v", err)
	}
	if verified.GrossAmountCents != 11988 {
		t.Errorf("expected 11988 cents, got %d", verified.GrossAmountCents)
	}

	// 2. Check subscription status & entitlements
	status, err := svc.GetSubscriptionStatus(ctx, userID)
	if err != nil {
		t.Fatalf("failed to get subscription status: %v", err)
	}
	if !status.HasActiveSubscription {
		t.Errorf("expected user to have active subscription")
	}
	if status.Tier != billing.TierPlus {
		t.Errorf("expected tier PLUS, got %s", status.Tier)
	}
	if status.BoostCreditsRemaining != 12 {
		t.Errorf("expected 12 boost credits included in annual plan, got %d", status.BoostCreditsRemaining)
	}

	hasUnlimited, err := repo.HasEntitlement(ctx, userID, billing.EntitlementUnlimitedSwipes)
	if err != nil || !hasUnlimited {
		t.Errorf("expected user to have UNLIMITED_SWIPES entitlement")
	}

	// 3. User cancels subscription
	canceledSub, err := svc.CancelSubscription(ctx, userID)
	if err != nil {
		t.Fatalf("failed to cancel subscription: %v", err)
	}
	if !canceledSub.CancelAtPeriodEnd {
		t.Errorf("expected CancelAtPeriodEnd to be true")
	}

	// Benefits must still remain active until period end
	statusAfterCancel, err := svc.GetSubscriptionStatus(ctx, userID)
	if err != nil {
		t.Fatalf("failed to get status after cancellation: %v", err)
	}
	if !statusAfterCancel.HasActiveSubscription {
		t.Errorf("expected subscription to remain active until period end")
	}
}

func TestConsumableBoostPurchaseAndConsumption(t *testing.T) {
	svc, _ := setupTestBillingService(t)
	ctx := context.Background()
	userID := "usr_boost_shopper"

	// 1. Purchase 5-pack boosts
	_, err := svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderStripe,
		PlanCode:              billing.PlanBoost5Pack,
		ExternalTransactionID: "ch_boost_5pk",
	}, "corr_boost")
	if err != nil {
		t.Fatalf("boost purchase failed: %v", err)
	}

	bStatus, err := svc.GetBoostStatus(ctx, userID)
	if err != nil {
		t.Fatalf("failed to get boost status: %v", err)
	}
	if bStatus.CreditsRemaining != 5 {
		t.Fatalf("expected 5 boost credits, got %d", bStatus.CreditsRemaining)
	}

	// 2. Activate boost
	res, err := svc.ActivateBoost(ctx, userID, 30)
	if err != nil {
		t.Fatalf("failed to activate boost: %v", err)
	}
	if res.CreditsRemaining != 4 {
		t.Errorf("expected 4 remaining credits, got %d", res.CreditsRemaining)
	}
	if res.Boost.Multiplier != 2.5 {
		t.Errorf("expected 2.5x multiplier, got %f", res.Boost.Multiplier)
	}
	if !res.Boost.IsActive() {
		t.Errorf("expected boost to be active")
	}

	// 3. Attempt to activate a second boost while one is active -> should fail with conflict
	_, err = svc.ActivateBoost(ctx, userID, 30)
	if err != billing.ErrActiveBoostRunning {
		t.Errorf("expected ErrActiveBoostRunning, got %v", err)
	}
}

func TestConcurrentBoostDoubleSpendPrevention(t *testing.T) {
	_, repo := setupTestBillingService(t)
	ctx := context.Background()
	userID := "usr_concurrent_user"

	// Grant exactly 1 credit
	_, _ = repo.AddBoostCredits(ctx, userID, 1)

	var wg sync.WaitGroup
	var successCount int
	var failCount int
	var mu sync.Mutex

	// Launch 10 concurrent requests attempting to consume the 1 credit
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := repo.ConsumeBoostCredit(ctx, userID)
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				successCount++
			} else {
				failCount++
			}
		}()
	}
	wg.Wait()

	if successCount != 1 {
		t.Errorf("expected exactly 1 successful credit consumption, got %d", successCount)
	}
	if failCount != 9 {
		t.Errorf("expected 9 failures due to insufficient credits, got %d", failCount)
	}

	rem, _ := repo.GetBoostCredits(ctx, userID)
	if rem != 0 {
		t.Errorf("expected 0 remaining credits, got %d", rem)
	}
}

func TestWebhookIdempotencyAndRefunds(t *testing.T) {
	svc, repo := setupTestBillingService(t)
	ctx := context.Background()
	userID := "usr_webhook_target"

	// First simulate a verified transaction
	_, _ = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderStripe,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "ch_refundable_123",
	}, "corr_w")

	// Create signed webhook event
	secret := "whsec_test_secret_456"
	now := time.Now().Unix()
	body := []byte(fmt.Sprintf(`{
		"id": "evt_stripe_refund_1",
		"object": "event",
		"api_version": "2022-11-15",
		"type": "charge.refunded",
		"data": {
			"object": {
				"id": "ch_refundable_123",
				"amount_refunded": 1999
			}
		}
	}`))

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(append([]byte(fmt.Sprintf("%d.", now)), body...))
	sig := hex.EncodeToString(mac.Sum(nil))
	sigHeader := fmt.Sprintf("t=%d,v1=%s", now, sig)

	// Process refund webhook
	err := svc.ProcessWebhook(ctx, billing.ProviderStripe, body, sigHeader)
	if err != nil {
		t.Fatalf("failed to process valid webhook: %v", err)
	}

	// Duplicate delivery must be ignored idempotently without error
	err = svc.ProcessWebhook(ctx, billing.ProviderStripe, body, sigHeader)
	if err != nil {
		t.Fatalf("expected duplicate webhook to succeed idempotently, got %v", err)
	}

	// Invalid signature must be rejected
	err = svc.ProcessWebhook(ctx, billing.ProviderStripe, body, "t=123,v1=invalid_sig")
	if err == nil {
		t.Errorf("expected error for invalid signature, got nil")
	}

	// Verify entitlements revoked after refund
	hasUnlimited, _ := repo.HasEntitlement(ctx, userID, billing.EntitlementUnlimitedSwipes)
	if hasUnlimited {
		t.Errorf("expected UNLIMITED_SWIPES to be revoked after charge refund")
	}
}

func TestDiscoveryBoostIntegration(t *testing.T) {
	discoRepo := discovery.NewMemoryRepository(identity.NewMemoryRepository())

	// Test boosted score calculation
	baseScore := 50.0
	boostedScore := discovery.CalculateBoostedScore(baseScore, 2.5)
	if boostedScore != 125.0 {
		t.Errorf("expected 125.0 boosted score, got %f", boostedScore)
	}

	// Setting user boost
	discoRepo.SetUserBoost("usr_target_1", 2.5)
	// Base score without boost <= 1.0 does not mutate
	unboosted := discovery.CalculateBoostedScore(baseScore, 1.0)
	if unboosted != 50.0 {
		t.Errorf("expected unboosted 50.0, got %f", unboosted)
	}
}

func TestBillingHTTPHandlerEndpoints(t *testing.T) {
	svc, _ := setupTestBillingService(t)
	handler := billing.NewHandler(svc, nil)

	// 1. GET /api/v1/billing/plans
	req := httptest.NewRequest(http.MethodGet, "/api/v1/billing/plans", nil)
	rr := httptest.NewRecorder()
	handler.Plans(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for plans, got %d: %s", rr.Code, rr.Body.String())
	}
	var plansResp struct {
		Plans []billing.Product `json:"plans"`
		Count int               `json:"count"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &plansResp); err != nil {
		t.Fatalf("failed to decode plans response: %v", err)
	}
	if plansResp.Count < 6 {
		t.Errorf("expected at least 6 plans, got %d", plansResp.Count)
	}

	// 2. Webhook endpoint with invalid signature
	whReq := httptest.NewRequest(http.MethodPost, "/api/v1/billing/webhooks/stripe", bytes.NewBufferString(`{"id":"evt_test"}`))
	whReq.Header.Set("Stripe-Signature", "t=123,v1=bad")
	whRR := httptest.NewRecorder()
	handler.Webhook(whRR, whReq)

	if whRR.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request for bad signature, got %d", whRR.Code)
	}

	// 3. GET /api/v1/billing/policy
	policyReq := httptest.NewRequest(http.MethodGet, "/api/v1/billing/policy?platform=android&storefront=FR", nil)
	policyRR := httptest.NewRecorder()
	handler.Policy(policyRR, policyReq)

	if policyRR.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for policy, got %d", policyRR.Code)
	}
	var policy billing.StorefrontBillingPolicy
	if err := json.Unmarshal(policyRR.Body.Bytes(), &policy); err != nil {
		t.Fatalf("failed to decode policy response: %v", err)
	}
	if !policy.ExternalCheckoutPermitted || !policy.RequiresChoiceScreen {
		t.Errorf("expected UCB enabled for Android in France, got: %+v", policy)
	}
}

func TestStorefrontBillingPolicy_Resolution(t *testing.T) {
	// 1. Web: Direct Stripe checkout always preferred and permitted
	webPolicy := billing.ResolveStorefrontPolicy("web", "US", false, "https://auradating.com")
	if !webPolicy.ExternalCheckoutPermitted || webPolicy.PreferredMethod != billing.BillingMethodStripe {
		t.Errorf("expected web policy to prefer Stripe, got %+v", webPolicy)
	}

	// 2. Android: EU storefront (e.g., DE) triggers Google User Choice Billing
	androidEUPolicy := billing.ResolveStorefrontPolicy("android", "DE", false, "https://auradating.com")
	if !androidEUPolicy.ExternalCheckoutPermitted || !androidEUPolicy.RequiresChoiceScreen || androidEUPolicy.PreferredMethod != "USER_CHOICE" {
		t.Errorf("expected Android EU to require choice screen, got %+v", androidEUPolicy)
	}

	// 3. Android: Non-UCB region has Google Play Billing mandatory
	androidROWPolicy := billing.ResolveStorefrontPolicy("android", "ZA", false, "https://auradating.com")
	if androidROWPolicy.ExternalCheckoutPermitted || androidROWPolicy.PreferredMethod != billing.BillingMethodGooglePlayBilling {
		t.Errorf("expected Android South Africa to enforce Google Play Billing only, got %+v", androidROWPolicy)
	}

	// 4. iOS: US with approved external link entitlement allows website checkout choice
	iosUSEntitled := billing.ResolveStorefrontPolicy("ios", "US", true, "https://auradating.com")
	if !iosUSEntitled.ExternalCheckoutPermitted || len(iosUSEntitled.SupportedBillingMethods) != 2 {
		t.Errorf("expected iOS US entitled to allow external checkout, got %+v", iosUSEntitled)
	}

	// 5. iOS: US WITHOUT entitlement strictly requires StoreKit IAP (complies with App Store Review 3.1.1)
	iosUSUnentitled := billing.ResolveStorefrontPolicy("ios", "US", false, "https://auradating.com")
	if iosUSUnentitled.ExternalCheckoutPermitted || iosUSUnentitled.PreferredMethod != billing.BillingMethodAppleIAP {
		t.Errorf("expected iOS US unentitled to require Apple IAP, got %+v", iosUSUnentitled)
	}

	// 6. iOS: ROW (e.g., JP) requires Apple IAP strictly
	iosROWPolicy := billing.ResolveStorefrontPolicy("ios", "JP", false, "https://auradating.com")
	if iosROWPolicy.ExternalCheckoutPermitted || iosROWPolicy.PreferredMethod != billing.BillingMethodAppleIAP {
		t.Errorf("expected iOS Japan to require Apple IAP strictly, got %+v", iosROWPolicy)
	}
}

func TestUnconfiguredProviderCredentialsBlocked(t *testing.T) {
	ctx := context.Background()

	// Stripe with unconfigured key
	blockedStripe := billing.NewStripeAdapter("", "")
	prod := billing.Product{PlanCode: billing.PlanAuraPlusMonthly, PriceCents: 1999, Currency: "USD", ProductType: billing.ProductTypeSubscription}
	_, err := blockedStripe.CreateCheckoutSession(ctx, "usr_1", "test@aura.dating", prod, "https://aura.dating/s", "https://aura.dating/c")
	if !errors.Is(err, billing.ErrProviderNotConfigured) {
		t.Errorf("expected ErrProviderNotConfigured for unconfigured Stripe, got %v", err)
	}

	// Apple with unconfigured secret
	blockedAppleSecret := billing.NewAppleAppStoreAdapter("", "com.aura.dating")
	_, err = blockedAppleSecret.VerifyPurchase(ctx, billing.VerifyPurchaseRequest{
		ReceiptData:           "valid_apple_receipt_123",
		ExternalTransactionID: "tx_123",
	}, prod)
	if !errors.Is(err, billing.ErrProviderNotConfigured) {
		t.Errorf("expected ErrProviderNotConfigured for unconfigured Apple secret, got %v", err)
	}

	// Apple with unconfigured bundle ID
	blockedAppleBundle := billing.NewAppleAppStoreAdapter("apple_secret", "")
	_, err = blockedAppleBundle.VerifyPurchase(ctx, billing.VerifyPurchaseRequest{
		ReceiptData:           "valid_apple_receipt_123",
		ExternalTransactionID: "tx_123",
	}, prod)
	if !errors.Is(err, billing.ErrProviderNotConfigured) {
		t.Errorf("expected ErrProviderNotConfigured for unconfigured Apple bundle ID, got %v", err)
	}

	// Google with unconfigured credentials
	blockedGoogleCreds := billing.NewGooglePlayAdapter("", "com.aura.dating")
	_, err = blockedGoogleCreds.VerifyPurchase(ctx, billing.VerifyPurchaseRequest{
		ReceiptData:           "token_123",
		ExternalTransactionID: "tx_123",
	}, prod)
	if !errors.Is(err, billing.ErrProviderNotConfigured) {
		t.Errorf("expected ErrProviderNotConfigured for unconfigured Google credentials, got %v", err)
	}

	// Google with unconfigured package name
	blockedGooglePkg := billing.NewGooglePlayAdapter(`{"project_id":"aura-dev"}`, "")
	_, err = blockedGooglePkg.VerifyPurchase(ctx, billing.VerifyPurchaseRequest{
		ReceiptData:           "token_123",
		ExternalTransactionID: "tx_123",
	}, prod)
	if !errors.Is(err, billing.ErrProviderNotConfigured) {
		t.Errorf("expected ErrProviderNotConfigured for unconfigured Google package name, got %v", err)
	}
}

func TestExplicitConsentRequired(t *testing.T) {
	svc, repo := setupTestBillingService(t)
	ctx := context.Background()

	// Checkout without consent fails
	_, err := svc.CreateCheckout(ctx, "usr_consent", "test@aura.dating", billing.CheckoutRequest{
		PlanCode:      billing.PlanAuraPlusMonthly,
		Provider:      billing.ProviderStripe,
		SuccessURL:    "https://aura.dating/success",
		CancelURL:     "https://aura.dating/cancel",
		TermsAccepted: false,
	})
	if !errors.Is(err, billing.ErrTermsConsentRequired) {
		t.Errorf("expected ErrTermsConsentRequired when TermsAccepted is false, got %v", err)
	}

	// Checkout with consent succeeds and writes record
	_, err = svc.CreateCheckout(ctx, "usr_consent", "test@aura.dating", billing.CheckoutRequest{
		PlanCode:      billing.PlanAuraPlusMonthly,
		Provider:      billing.ProviderStripe,
		SuccessURL:    "https://aura.dating/success",
		CancelURL:     "https://aura.dating/cancel",
		TermsAccepted: true,
		TermsVersion:  "2026-10-v1",
	})
	if err != nil {
		t.Fatalf("checkout with consent failed: %v", err)
	}

	consent, err := repo.GetLatestConsent(ctx, "usr_consent", billing.PlanAuraPlusMonthly)
	if err != nil || consent == nil {
		t.Fatalf("expected consent record persisted, got err=%v, consent=%v", err, consent)
	}
	if consent.TermsVersion != "2026-10-v1" || !consent.ConsentGiven {
		t.Errorf("unexpected consent record data: %+v", consent)
	}
}

func TestStoreReceiptVerification(t *testing.T) {
	svc, repo := setupTestBillingService(t)
	ctx := context.Background()
	userID := "usr_iap_1"

	// 1. Missing receipt data must fail with ErrInvalidReceiptData
	_, err := svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_iap_1",
		ReceiptData:           "",
	}, "corr_iap_1")
	if !errors.Is(err, billing.ErrInvalidReceiptData) {
		t.Errorf("expected ErrInvalidReceiptData for empty receipt, got %v", err)
	}

	// Invariant: Entitlement must NOT be granted when verification fails
	hasUnlimited, _ := repo.HasEntitlement(ctx, userID, billing.EntitlementUnlimitedSwipes)
	if hasUnlimited {
		t.Errorf("entitlement must not be granted for unverified transaction")
	}

	// 2. Apple Bundle ID mismatch must fail with ErrReceiptValidationFailed
	badBundleReceipt := `{"bundle_id":"com.fraudulent.app","product_id":"AURA_PLUS_MONTHLY","transaction_id":"tx_1","status":"ACTIVE"}`
	_, err = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_iap_2",
		ReceiptData:           badBundleReceipt,
	}, "corr_iap_2")
	if !errors.Is(err, billing.ErrReceiptValidationFailed) {
		t.Errorf("expected ErrReceiptValidationFailed for bundle mismatch, got %v", err)
	}

	// 3. Valid Apple receipt data matching configured bundle ID (com.aura.dating) succeeds
	validAppleReceipt := `{"bundle_id":"com.aura.dating","product_id":"AURA_PLUS_MONTHLY","transaction_id":"tx_apple_valid","status":"ACTIVE","expires_date_ms":` + fmt.Sprintf("%d", time.Now().Add(30*24*time.Hour).UnixMilli()) + `}`
	verifiedApple, err := svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_apple_valid",
		ReceiptData:           validAppleReceipt,
	}, "corr_iap_3")
	if err != nil {
		t.Fatalf("expected valid Apple receipt to verify, got %v", err)
	}
	if verifiedApple.ExternalChargeID != "tx_apple_valid" {
		t.Errorf("unexpected external charge id: %s", verifiedApple.ExternalChargeID)
	}

	// 4. Google Play Package Name mismatch must fail with ErrReceiptValidationFailed
	badGoogleReceipt := `{"package_name":"com.fraudulent.app","product_id":"AURA_PLUS_MONTHLY","purchase_token":"tok_fraud","purchase_state":0}`
	_, err = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderGooglePlay,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_gplay_bad",
		ReceiptData:           badGoogleReceipt,
	}, "corr_iap_4")
	if !errors.Is(err, billing.ErrReceiptValidationFailed) {
		t.Errorf("expected ErrReceiptValidationFailed for package mismatch, got %v", err)
	}

	// 5. Valid Google Play purchase matching configured package name (com.aura.dating) succeeds
	validGoogleReceipt := `{"package_name":"com.aura.dating","product_id":"AURA_PLUS_MONTHLY","purchase_token":"tok_valid_gplay","purchase_state":0}`
	verifiedGoogle, err := svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderGooglePlay,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_gplay_valid",
		ReceiptData:           validGoogleReceipt,
	}, "corr_iap_5")
	if err != nil {
		t.Fatalf("expected valid Google Play purchase to verify, got %v", err)
	}
	if verifiedGoogle.ExternalChargeID != "tx_gplay_valid" {
		t.Errorf("unexpected external charge id: %s", verifiedGoogle.ExternalChargeID)
	}

	// 6. Dynamic Rebrand verification: changing configured identifiers verifies new name and strictly rejects old
	rebrandedApple := billing.NewAppleAppStoreAdapter("apple_secret", "com.rebranded.dating")
	rebrandedGoogle := billing.NewGooglePlayAdapter(`{"project_id":"rebrand-dev"}`, "com.rebranded.dating")
	rebrandedReg := billing.NewProviderRegistry(billing.NewStripeAdapter("sk_test", "whsec_test"), rebrandedApple, rebrandedGoogle)
	rebrandedSvc := billing.NewService(repo, rebrandedReg, nil)

	// Old identifier now fails
	_, err = rebrandedSvc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_old_aura",
		ReceiptData:           validAppleReceipt, // contains com.aura.dating
	}, "corr_rebrand_1")
	if !errors.Is(err, billing.ErrReceiptValidationFailed) {
		t.Errorf("expected ErrReceiptValidationFailed when verifying old identifier against rebranded adapter, got %v", err)
	}

	// Rebranded receipt succeeds
	rebrandedReceipt := `{"bundle_id":"com.rebranded.dating","product_id":"AURA_PLUS_MONTHLY","transaction_id":"tx_rebrand_ok","status":"ACTIVE"}`
	verifiedRebrand, err := rebrandedSvc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_rebrand_ok",
		ReceiptData:           rebrandedReceipt,
	}, "corr_rebrand_2")
	if err != nil {
		t.Fatalf("expected rebranded receipt to verify cleanly, got %v", err)
	}
	if verifiedRebrand.ExternalChargeID != "tx_rebrand_ok" {
		t.Errorf("unexpected charge ID: %s", verifiedRebrand.ExternalChargeID)
	}
}

func TestUpcomingInvoicePreDebitNotice(t *testing.T) {
	svc, repo := setupTestBillingService(t)
	ctx := context.Background()
	sink := &mockPreDebitSink{}
	svc.SetNotificationSink(sink)

	// Setup active subscription in repo
	userID := "usr_predebit_1"
	sub := &billing.Subscription{
		ID:                     "sub_internal_predebit",
		UserID:                 userID,
		Provider:               billing.ProviderStripe,
		ExternalSubscriptionID: "sub_stripe_predebit_999",
		PlanCode:               billing.PlanAuraPlusMonthly,
		Status:                 billing.StatusActive,
		CurrentPeriodStart:     time.Now().Add(-25 * 24 * time.Hour),
		CurrentPeriodEnd:       time.Now().Add(5 * 24 * time.Hour),
		CreatedAt:              time.Now().Add(-25 * 24 * time.Hour),
		UpdatedAt:              time.Now(),
	}
	_ = repo.UpsertSubscription(ctx, sub)

	// Send invoice.upcoming webhook
	secret := "whsec_test_secret_456"
	now := time.Now().Unix()
	body := []byte(fmt.Sprintf(`{
		"id": "evt_stripe_upcoming_1",
		"object": "event",
		"api_version": "2022-11-15",
		"type": "invoice.upcoming",
		"data": {
			"object": {
				"subscription": "sub_stripe_predebit_999",
				"amount_due": 1999,
				"currency": "usd"
			}
		}
	}`))
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(append([]byte(fmt.Sprintf("%d.", now)), body...))
	sig := hex.EncodeToString(mac.Sum(nil))
	sigHeader := fmt.Sprintf("t=%d,v1=%s", now, sig)

	err := svc.ProcessWebhook(ctx, billing.ProviderStripe, body, sigHeader)
	if err != nil {
		t.Fatalf("failed to process invoice.upcoming: %v", err)
	}

	sink.mu.Lock()
	defer sink.mu.Unlock()
	if len(sink.notices) != 1 {
		t.Fatalf("expected 1 pre-debit notice delivered, got %d", len(sink.notices))
	}
	if sink.notices[0].UserID != userID || sink.notices[0].AmountCents != 1999 {
		t.Errorf("unexpected pre-debit notice: %+v", sink.notices[0])
	}
}

func TestIndiaRecurringPreDebitCompliance(t *testing.T) {
	svc, _ := setupTestBillingService(t)
	ctx := context.Background()

	// 1. Without notification sink, India recurring checkout must fail with ErrIndiaMandateNotCompliant
	_, err := svc.CreateCheckout(ctx, "usr_in_1", "test@aura.dating", billing.CheckoutRequest{
		PlanCode:      billing.PlanAuraPlusMonthly,
		Provider:      billing.ProviderStripe,
		SuccessURL:    "https://aura.dating/success",
		CancelURL:     "https://aura.dating/cancel",
		TermsAccepted: true,
		TermsVersion:  "2026-10-15",
		Storefront:    "IN",
	})
	if !errors.Is(err, billing.ErrIndiaMandateNotCompliant) {
		t.Errorf("expected ErrIndiaMandateNotCompliant when sink is unconfigured, got %v", err)
	}

	// 2. With notification sink configured, India recurring checkout succeeds
	sink := &mockPreDebitSink{}
	svc.SetNotificationSink(sink)

	sess, err := svc.CreateCheckout(ctx, "usr_in_1", "test@aura.dating", billing.CheckoutRequest{
		PlanCode:      billing.PlanAuraPlusMonthly,
		Provider:      billing.ProviderStripe,
		SuccessURL:    "https://aura.dating/success",
		CancelURL:     "https://aura.dating/cancel",
		TermsAccepted: true,
		TermsVersion:  "2026-10-15",
		Storefront:    "IN",
	})
	if err != nil {
		t.Fatalf("expected India checkout with sink to succeed, got %v", err)
	}
	if sess.SessionID == "" {
		t.Errorf("expected valid session ID")
	}
}
