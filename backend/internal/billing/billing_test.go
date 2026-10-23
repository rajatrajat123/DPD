package billing_test

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/billing"
	"github.com/auradating/platform/backend/internal/discovery"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/stripe/stripe-go/v74"
	"google.golang.org/api/androidpublisher/v3"
	"google.golang.org/api/option"
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
	if plus.PriceCents != 2500 {
		t.Errorf("expected price 2500 cents ($25.00), got %d", plus.PriceCents)
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
	if session.AmountCents != 2500 {
		t.Errorf("expected 2500 cents ($25.00), got %d", session.AmountCents)
	}
}

func TestPurchaseVerificationAndSubscriptionLifecycle(t *testing.T) {
	svc, repo := setupTestBillingService(t)
	ctx := context.Background()
	userID := "usr_subscriber_1"

	// 1. Initial purchase of Aura Plus Annual ($200.00 / 20000 cents)
	verified, err := svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderStripe,
		PlanCode:              billing.PlanAuraPlusAnnual,
		ExternalTransactionID: "ch_test_123",
	}, "corr_1")
	if err != nil {
		t.Fatalf("verify purchase failed: %v", err)
	}
	if verified.GrossAmountCents != 20000 {
		t.Errorf("expected 20000 cents ($200.00), got %d", verified.GrossAmountCents)
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
	if res.Boost.Multiplier != 5.0 {
		t.Errorf("expected 5.0x multiplier, got %f", res.Boost.Multiplier)
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

func TestPricingUpdatesAndSuperLikes(t *testing.T) {
	svc, repo := setupTestBillingService(t)
	ctx := context.Background()
	userID := "usr_super_likes_tester"

	// 1. Verify updated product catalog prices
	plusMonthly, err := svc.GetProductByPlanCode(ctx, billing.PlanAuraPlusMonthly)
	if err != nil || plusMonthly.PriceCents != 2500 {
		t.Errorf("expected Plus Monthly at 2500 cents ($25), got %+v", plusMonthly)
	}

	plusAnnual, err := svc.GetProductByPlanCode(ctx, billing.PlanAuraPlusAnnual)
	if err != nil || plusAnnual.PriceCents != 20000 {
		t.Errorf("expected Plus Annual at 20000 cents ($200), got %+v", plusAnnual)
	}

	extraPremiumMonthly, err := svc.GetProductByPlanCode(ctx, billing.PlanAuraBlackMonthly)
	if err != nil || extraPremiumMonthly.PriceCents != 3499 {
		t.Errorf("expected Extra Premium Monthly at 3499 cents ($34.99), got %+v", extraPremiumMonthly)
	}

	extraPremiumAnnual, err := svc.GetProductByPlanCode(ctx, billing.PlanAuraBlackAnnual)
	if err != nil || extraPremiumAnnual.PriceCents != 30000 {
		t.Errorf("expected Extra Premium Annual at 30000 cents ($300), got %+v", extraPremiumAnnual)
	}

	boostSingle, err := svc.GetProductByPlanCode(ctx, billing.PlanBoostSingle)
	if err != nil || boostSingle.PriceCents != 799 {
		t.Errorf("expected Boost Single at 799 cents ($7.99), got %+v", boostSingle)
	}

	superLikes5, err := svc.GetProductByPlanCode(ctx, billing.PlanSuperSpark5Pack)
	if err != nil || superLikes5.PriceCents != 499 {
		t.Errorf("expected Super Likes 5Pack at 499 cents ($4.99), got %+v", superLikes5)
	}

	// 2. Initial Super Likes balance must be 0
	initialCredits, err := svc.GetSuperLikeCredits(ctx, userID)
	if err != nil || initialCredits != 0 {
		t.Fatalf("expected 0 initial super like credits, got %d (err: %v)", initialCredits, err)
	}

	// Consuming with 0 credits must fail with ErrInsufficientSuperLikeCredits
	_, err = svc.ConsumeSuperLikeCredit(ctx, userID)
	if !errors.Is(err, billing.ErrInsufficientSuperLikeCredits) {
		t.Fatalf("expected ErrInsufficientSuperLikeCredits, got: %v", err)
	}

	// 3. Purchase 5-pack of Super Likes ($4.99)
	verified, err := svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderStripe,
		PlanCode:              billing.PlanSuperSpark5Pack,
		ExternalTransactionID: "ch_super_likes_1",
	}, "corr_sl_1")
	if err != nil {
		t.Fatalf("purchase of super likes failed: %v", err)
	}
	if verified.GrossAmountCents != 499 {
		t.Errorf("expected 499 cents, got %d", verified.GrossAmountCents)
	}

	// Balance must now be 5
	creditsAfterPurchase, err := svc.GetSuperLikeCredits(ctx, userID)
	if err != nil || creditsAfterPurchase != 5 {
		t.Fatalf("expected 5 super like credits after purchase, got %d", creditsAfterPurchase)
	}

	// Subscription status must reflect remaining credits
	subStatus, err := svc.GetSubscriptionStatus(ctx, userID)
	if err != nil || subStatus.SuperLikeCreditsRemaining != 5 {
		t.Fatalf("expected status SuperLikeCreditsRemaining=5, got: %+v", subStatus)
	}

	// 4. Replay of same transaction must not grant double credits
	_, err = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderStripe,
		PlanCode:              billing.PlanSuperSpark5Pack,
		ExternalTransactionID: "ch_super_likes_1",
	}, "corr_sl_replay")
	if err != nil {
		t.Fatalf("idempotent replay failed: %v", err)
	}
	creditsAfterReplay, _ := svc.GetSuperLikeCredits(ctx, userID)
	if creditsAfterReplay != 5 {
		t.Fatalf("replay must not grant duplicate credits, expected 5, got %d", creditsAfterReplay)
	}

	// 5. Consume 1 Super Like credit
	remCredits, err := svc.ConsumeSuperLikeCredit(ctx, userID)
	if err != nil || remCredits != 4 {
		t.Fatalf("expected 4 remaining credits after 1 consumption, got %d", remCredits)
	}

	// 6. Test Profile Boost default parameters: 60 mins, 5.0x multiplier, 160 miles radius
	_, _ = repo.AddBoostCredits(ctx, userID, 1)
	boostRes, err := svc.ActivateBoost(ctx, userID, 0) // duration <= 0 uses default
	if err != nil {
		t.Fatalf("boost activation failed: %v", err)
	}
	if boostRes.Boost.DurationMinutes != 60 {
		t.Errorf("expected 60 minutes default duration, got %d", boostRes.Boost.DurationMinutes)
	}
	if boostRes.Boost.Multiplier != 5.0 {
		t.Errorf("expected 5.0 multiplier, got %f", boostRes.Boost.Multiplier)
	}
	if boostRes.Boost.RadiusMiles != 160.0 || boostRes.Boost.MaxRadiusKm != 257.5 {
		t.Errorf("expected 160 miles / 257.5 km radius, got miles=%f km=%f", boostRes.Boost.RadiusMiles, boostRes.Boost.MaxRadiusKm)
	}

	// 7. Passport entitlement test
	hasEnt, err := svc.HasPassportEntitlement(ctx, userID)
	if err != nil || hasEnt {
		t.Errorf("user without subscription should not have passport entitlement, got: %v", hasEnt)
	}

	// Grant Aura Plus subscription
	_, _ = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderStripe,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "ch_plus_passport_ent",
	}, "corr_plus_ent")

	hasEntAfterSub, err := svc.HasPassportEntitlement(ctx, userID)
	if err != nil || !hasEntAfterSub {
		t.Errorf("user with active Aura Plus subscription MUST have passport entitlement, got: %v", hasEntAfterSub)
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

func generateTestPKI(t *testing.T) (*x509.Certificate, *ecdsa.PrivateKey, *x509.Certificate, *ecdsa.PrivateKey, *x509.CertPool) {
	t.Helper()
	rootKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate root key: %v", err)
	}
	rootTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName:   "Test Apple Root CA",
			Organization: []string{"Apple Inc."},
		},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
	}
	rootDER, err := x509.CreateCertificate(rand.Reader, rootTemplate, rootTemplate, &rootKey.PublicKey, rootKey)
	if err != nil {
		t.Fatalf("failed to create root cert: %v", err)
	}
	rootCert, _ := x509.ParseCertificate(rootDER)

	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate leaf key: %v", err)
	}
	leafTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject: pkix.Name{
			CommonName:   "Test App Store Signing",
			Organization: []string{"Apple Inc."},
		},
		NotBefore: time.Now().Add(-1 * time.Hour),
		NotAfter:  time.Now().Add(24 * time.Hour),
		KeyUsage:  x509.KeyUsageDigitalSignature,
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTemplate, rootCert, &leafKey.PublicKey, rootKey)
	if err != nil {
		t.Fatalf("failed to create leaf cert: %v", err)
	}
	leafCert, _ := x509.ParseCertificate(leafDER)

	pool := x509.NewCertPool()
	pool.AddCert(rootCert)

	return rootCert, rootKey, leafCert, leafKey, pool
}

func buildTestAppleJWS(t *testing.T, leafCert, rootCert *x509.Certificate, leafKey *ecdsa.PrivateKey, payload billing.AppleTransactionPayload) string {
	t.Helper()
	header := map[string]any{
		"alg": "ES256",
		"x5c": []string{
			base64.StdEncoding.EncodeToString(leafCert.Raw),
			base64.StdEncoding.EncodeToString(rootCert.Raw),
		},
	}
	hBytes, _ := json.Marshal(header)
	pBytes, _ := json.Marshal(payload)

	signingInput := base64.RawURLEncoding.EncodeToString(hBytes) + "." + base64.RawURLEncoding.EncodeToString(pBytes)
	h := sha256.Sum256([]byte(signingInput))
	r, s, err := ecdsa.Sign(rand.Reader, leafKey, h[:])
	if err != nil {
		t.Fatalf("failed to sign JWS: %v", err)
	}
	rBytes := r.Bytes()
	sBytes := s.Bytes()
	sig := make([]byte, 64)
	copy(sig[32-len(rBytes):32], rBytes)
	copy(sig[64-len(sBytes):], sBytes)

	return signingInput + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func TestStoreReceiptVerification_Apple(t *testing.T) {
	rootCert, _, leafCert, leafKey, testPool := generateTestPKI(t)
	appleAdapter := billing.NewAppleAppStoreAdapter("apple_secret", "com.aura.dating")
	appleAdapter.SetRootCertificates(testPool)

	repo := billing.NewMemoryRepository()
	reg := billing.NewProviderRegistry(appleAdapter)
	svc := billing.NewService(repo, reg, nil)
	ctx := context.Background()
	userID := "usr_apple_test"

	// 1. Missing receipt data must fail with ErrInvalidReceiptData
	_, err := svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "",
		ReceiptData:           "",
	}, "corr_apple_1")
	if !errors.Is(err, billing.ErrInvalidReceiptData) {
		t.Errorf("expected ErrInvalidReceiptData for empty receipt, got %v", err)
	}

	// 2. Valid Apple JWS signed with trusted leaf cert verifies cleanly
	validPayload := billing.AppleTransactionPayload{
		TransactionID:         "100000099887766",
		OriginalTransactionID: "100000099887766",
		BundleID:              "com.aura.dating",
		ProductID:             billing.PlanAuraPlusMonthly,
		PurchaseDate:          time.Now().UnixMilli(),
		ExpiresDate:           time.Now().Add(30 * 24 * time.Hour).UnixMilli(),
		Type:                  "Auto-Renewable Subscription",
		Environment:           "Sandbox",
		AppAccountToken:       userID,
	}
	validJWS := buildTestAppleJWS(t, leafCert, rootCert, leafKey, validPayload)

	verified, err := svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "100000099887766",
		ReceiptData:           validJWS,
	}, "corr_apple_2")
	if err != nil {
		t.Fatalf("expected valid JWS to verify successfully: %v", err)
	}
	if verified.ExternalChargeID != "100000099887766" {
		t.Errorf("expected external charge ID 100000099887766, got %s", verified.ExternalChargeID)
	}

	// Entitlement must be granted after successful verification
	hasUnlimited, _ := repo.HasEntitlement(ctx, userID, billing.EntitlementUnlimitedSwipes)
	if !hasUnlimited {
		t.Errorf("expected UNLIMITED_SWIPES entitlement granted after verified purchase")
	}

	// 3. Tampered JWS signature must be rejected
	parts := strings.Split(validJWS, ".")
	tamperedPayload := `{"bundleId":"com.aura.dating","productId":"AURA_PLUS_MONTHLY","tampered":true}`
	tamperedJWS := parts[0] + "." + base64.RawURLEncoding.EncodeToString([]byte(tamperedPayload)) + "." + parts[2]
	_, err = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_tampered",
		ReceiptData:           tamperedJWS,
	}, "corr_apple_3")
	if !errors.Is(err, billing.ErrReceiptValidationFailed) {
		t.Errorf("expected ErrReceiptValidationFailed for tampered JWS signature, got %v", err)
	}

	// 4. Untrusted root CA / invalid certificate chain rejected
	_, otherKey, otherLeaf, _, _ := generateTestPKI(t)
	untrustedJWS := buildTestAppleJWS(t, otherLeaf, rootCert, otherKey, validPayload)
	_, err = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_untrusted",
		ReceiptData:           untrustedJWS,
	}, "corr_apple_4")
	if !errors.Is(err, billing.ErrReceiptValidationFailed) {
		t.Errorf("expected ErrReceiptValidationFailed for untrusted cert chain, got %v", err)
	}

	// 5. Bundle ID mismatch rejected
	badBundlePayload := validPayload
	badBundlePayload.TransactionID = "tx_bad_bundle"
	badBundlePayload.BundleID = "com.fraudulent.dating"
	badBundleJWS := buildTestAppleJWS(t, leafCert, rootCert, leafKey, badBundlePayload)
	_, err = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_bad_bundle",
		ReceiptData:           badBundleJWS,
	}, "corr_apple_5")
	if !errors.Is(err, billing.ErrReceiptValidationFailed) {
		t.Errorf("expected ErrReceiptValidationFailed for bundle ID mismatch, got %v", err)
	}

	// 6. Product ID mismatch rejected
	badProdPayload := validPayload
	badProdPayload.TransactionID = "tx_bad_prod"
	badProdPayload.ProductID = "WRONG_PLAN_CODE"
	badProdJWS := buildTestAppleJWS(t, leafCert, rootCert, leafKey, badProdPayload)
	_, err = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_bad_prod",
		ReceiptData:           badProdJWS,
	}, "corr_apple_6")
	if !errors.Is(err, billing.ErrReceiptValidationFailed) {
		t.Errorf("expected ErrReceiptValidationFailed for product ID mismatch, got %v", err)
	}

	// 7. Revoked / refunded transaction rejected
	revokedPayload := validPayload
	revokedPayload.TransactionID = "tx_revoked"
	revokedPayload.RevocationDate = time.Now().Add(-1 * time.Hour).UnixMilli()
	revokedPayload.RevocationReason = 1
	revokedJWS := buildTestAppleJWS(t, leafCert, rootCert, leafKey, revokedPayload)
	_, err = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_revoked",
		ReceiptData:           revokedJWS,
	}, "corr_apple_7")
	if !errors.Is(err, billing.ErrReceiptValidationFailed) {
		t.Errorf("expected ErrReceiptValidationFailed for revoked transaction, got %v", err)
	}

	// 8. Expired subscription rejected
	expiredPayload := validPayload
	expiredPayload.TransactionID = "tx_expired"
	expiredPayload.ExpiresDate = time.Now().Add(-2 * time.Hour).UnixMilli()
	expiredJWS := buildTestAppleJWS(t, leafCert, rootCert, leafKey, expiredPayload)
	_, err = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_expired",
		ReceiptData:           expiredJWS,
	}, "corr_apple_8")
	if !errors.Is(err, billing.ErrReceiptValidationFailed) {
		t.Errorf("expected ErrReceiptValidationFailed for expired subscription, got %v", err)
	}

	// 9. Account mismatch (appAccountToken bound to another user) rejected
	mismatchPayload := validPayload
	mismatchPayload.TransactionID = "tx_mismatch"
	mismatchPayload.AppAccountToken = "usr_different_account_999"
	mismatchJWS := buildTestAppleJWS(t, leafCert, rootCert, leafKey, mismatchPayload)
	_, err = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_mismatch",
		ReceiptData:           mismatchJWS,
	}, "corr_apple_9")
	if !errors.Is(err, billing.ErrPurchaseUserMismatch) {
		t.Errorf("expected ErrPurchaseUserMismatch for account mismatch, got %v", err)
	}

	// 10. App Store Server API server-to-server HTTP query
	serverECKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	serverPayload := validPayload
	serverPayload.TransactionID = "tx_server_to_server_123"
	serverJWS := buildTestAppleJWS(t, leafCert, rootCert, leafKey, serverPayload)

	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/inApps/v1/transactions/tx_server_to_server_123") {
			auth := r.Header.Get("Authorization")
			if !strings.HasPrefix(auth, "Bearer ") {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{
				"signedTransactionInfo": serverJWS,
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer mockServer.Close()

	appleAdapter.SetBaseURL(mockServer.URL)
	appleAdapter.SetCredentials("KEY12345", "57246542-96fe-1a63-e053-0824d011072a", serverECKey, "sandbox")

	serverVerified, err := svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_server_to_server_123",
	}, "corr_apple_10")
	if err != nil {
		t.Fatalf("expected server-to-server query to verify successfully: %v", err)
	}
	if serverVerified.ExternalChargeID != "tx_server_to_server_123" {
		t.Errorf("unexpected charge id from server API: %s", serverVerified.ExternalChargeID)
	}
}

func TestStoreReceiptVerification_GooglePlay(t *testing.T) {
	ctx := context.Background()
	userID := "usr_google_test"
	repo := billing.NewMemoryRepository()

	var subAcknowledged bool
	var prodConsumed bool
	var mu sync.Mutex

	mockGoogleServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		mu.Lock()
		defer mu.Unlock()

		switch {
		case strings.Contains(r.URL.Path, "/purchases/subscriptionsv2/tokens/tok_active_sub"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"subscriptionState": "SUBSCRIPTION_STATE_ACTIVE",
				"lineItems": []map[string]any{
					{
						"productId":               billing.PlanAuraPlusMonthly,
						"expiryTime":              time.Now().Add(30 * 24 * time.Hour).Format(time.RFC3339),
						"latestSuccessfulOrderId": "GPA.1234-5678-90123",
					},
				},
				"externalAccountIdentifiers": map[string]string{
					"obfuscatedExternalAccountId": userID,
				},
			})
		case strings.Contains(r.URL.Path, "/purchases/subscriptionsv2/tokens/tok_pending_sub"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"subscriptionState": "SUBSCRIPTION_STATE_PENDING",
				"lineItems": []map[string]any{
					{
						"productId":  billing.PlanAuraPlusMonthly,
						"expiryTime": time.Now().Add(30 * 24 * time.Hour).Format(time.RFC3339),
					},
				},
			})
		case strings.Contains(r.URL.Path, "/purchases/subscriptionsv2/tokens/tok_expired_sub"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"subscriptionState": "SUBSCRIPTION_STATE_EXPIRED",
				"lineItems": []map[string]any{
					{
						"productId":  billing.PlanAuraPlusMonthly,
						"expiryTime": time.Now().Add(-2 * time.Hour).Format(time.RFC3339),
					},
				},
			})
		case strings.Contains(r.URL.Path, "/purchases/subscriptionsv2/tokens/tok_wrong_prod"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"subscriptionState": "SUBSCRIPTION_STATE_ACTIVE",
				"lineItems": []map[string]any{
					{
						"productId":  "WRONG_PRODUCT_ID",
						"expiryTime": time.Now().Add(30 * 24 * time.Hour).Format(time.RFC3339),
					},
				},
			})
		case strings.Contains(r.URL.Path, "/purchases/subscriptionsv2/tokens/tok_mismatch_sub"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"subscriptionState": "SUBSCRIPTION_STATE_ACTIVE",
				"lineItems": []map[string]any{
					{
						"productId":  billing.PlanAuraPlusMonthly,
						"expiryTime": time.Now().Add(30 * 24 * time.Hour).Format(time.RFC3339),
					},
				},
				"externalAccountIdentifiers": map[string]string{
					"obfuscatedExternalAccountId": "usr_another_account",
				},
			})
		case strings.Contains(r.URL.Path, ":acknowledge"):
			subAcknowledged = true
			w.WriteHeader(http.StatusNoContent)
		case strings.Contains(r.URL.Path, "/purchases/productsv2/tokens/tok_valid_consumable"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"orderId": "GPA.9999-8888-77777",
				"purchaseStateContext": map[string]string{
					"purchaseState": "PURCHASED",
				},
				"productLineItem": []map[string]any{
					{
						"productId": billing.PlanBoostSingle,
					},
				},
				"obfuscatedExternalAccountId": userID,
			})
		case strings.Contains(r.URL.Path, "/purchases/productsv2/tokens/tok_pending_consumable"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"purchaseStateContext": map[string]string{
					"purchaseState": "PENDING",
				},
				"productLineItem": []map[string]any{
					{
						"productId": billing.PlanBoostSingle,
					},
				},
			})
		case strings.Contains(r.URL.Path, ":consume") || strings.Contains(r.URL.Path, "/consume"):
			prodConsumed = true
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer mockGoogleServer.Close()

	googleSvc, err := androidpublisher.NewService(ctx,
		option.WithEndpoint(mockGoogleServer.URL),
		option.WithHTTPClient(mockGoogleServer.Client()),
		option.WithoutAuthentication(),
	)
	if err != nil {
		t.Fatalf("failed to create mock androidpublisher service: %v", err)
	}

	googleAdapter := billing.NewGooglePlayAdapter(`{"project_id":"aura-dev"}`, "com.aura.dating")
	googleAdapter.SetService(googleSvc)

	reg := billing.NewProviderRegistry(googleAdapter)
	svc := billing.NewService(repo, reg, nil)

	// 1. Valid subscription purchase verified via purchases.subscriptionsv2.get
	verified, err := svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderGooglePlay,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "GPA.1234-5678-90123",
		ReceiptData:           "tok_active_sub",
	}, "corr_gplay_1")
	if err != nil {
		t.Fatalf("expected valid Google Play subscription to verify: %v", err)
	}
	if verified.ExternalChargeID != "GPA.1234-5678-90123" {
		t.Errorf("unexpected charge ID: %s", verified.ExternalChargeID)
	}

	mu.Lock()
	if !subAcknowledged {
		t.Errorf("expected subscription to be durably acknowledged via Google Play API")
	}
	mu.Unlock()

	// 2. Pending purchase state rejected
	_, err = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderGooglePlay,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_pending",
		ReceiptData:           "tok_pending_sub",
	}, "corr_gplay_2")
	if !errors.Is(err, billing.ErrReceiptValidationFailed) {
		t.Errorf("expected ErrReceiptValidationFailed for pending subscription, got %v", err)
	}

	// 3. Expired purchase state rejected
	_, err = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderGooglePlay,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_expired",
		ReceiptData:           "tok_expired_sub",
	}, "corr_gplay_3")
	if !errors.Is(err, billing.ErrReceiptValidationFailed) {
		t.Errorf("expected ErrReceiptValidationFailed for expired subscription, got %v", err)
	}

	// 4. Product ID mismatch rejected
	_, err = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderGooglePlay,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_wrong_prod",
		ReceiptData:           "tok_wrong_prod",
	}, "corr_gplay_4")
	if !errors.Is(err, billing.ErrReceiptValidationFailed) {
		t.Errorf("expected ErrReceiptValidationFailed for product mismatch, got %v", err)
	}

	// 5. Package name mismatch in receipt JSON rejected
	badPkgReceipt := `{"packageName":"com.other.app","purchaseToken":"tok_active_sub"}`
	_, err = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderGooglePlay,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_bad_pkg",
		ReceiptData:           badPkgReceipt,
	}, "corr_gplay_5")
	if !errors.Is(err, billing.ErrReceiptValidationFailed) {
		t.Errorf("expected ErrReceiptValidationFailed for package mismatch, got %v", err)
	}

	// 6. Account mismatch rejected
	_, err = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderGooglePlay,
		PlanCode:              billing.PlanAuraPlusMonthly,
		ExternalTransactionID: "tx_mismatch",
		ReceiptData:           "tok_mismatch_sub",
	}, "corr_gplay_6")
	if !errors.Is(err, billing.ErrPurchaseUserMismatch) {
		t.Errorf("expected ErrPurchaseUserMismatch for account mismatch, got %v", err)
	}

	// 7. Consumable purchase (BOOST_SINGLE) verified via purchases.productsv2.getproductpurchasev2 and consumed
	initialCredits, _ := repo.GetBoostCredits(ctx, userID)
	consumableVerified, err := svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderGooglePlay,
		PlanCode:              billing.PlanBoostSingle,
		ExternalTransactionID: "GPA.9999-8888-77777",
		ReceiptData:           "tok_valid_consumable",
	}, "corr_gplay_7")
	if err != nil {
		t.Fatalf("expected valid consumable purchase to verify: %v", err)
	}
	if consumableVerified.TransactionType != billing.TxBoostPurchase {
		t.Errorf("expected BOOST_PURCHASE transaction type, got %s", consumableVerified.TransactionType)
	}

	// Boost credit granted
	afterCredits, _ := repo.GetBoostCredits(ctx, userID)
	if afterCredits != initialCredits+1 {
		t.Errorf("expected boost credit incremented by 1 (initial=%d, after=%d)", initialCredits, afterCredits)
	}

	mu.Lock()
	if !prodConsumed {
		t.Errorf("expected consumable purchase to be consumed via Google Play API")
	}
	mu.Unlock()

	// 8. Pending consumable purchase rejected
	_, err = svc.VerifyPurchase(ctx, userID, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderGooglePlay,
		PlanCode:              billing.PlanBoostSingle,
		ExternalTransactionID: "tx_pending_cons",
		ReceiptData:           "tok_pending_consumable",
	}, "corr_gplay_8")
	if !errors.Is(err, billing.ErrReceiptValidationFailed) {
		t.Errorf("expected ErrReceiptValidationFailed for pending consumable, got %v", err)
	}
}

func TestStoreReceiptVerification_ReplayProtection(t *testing.T) {
	rootCert, _, leafCert, leafKey, testPool := generateTestPKI(t)
	appleAdapter := billing.NewAppleAppStoreAdapter("apple_secret", "com.aura.dating")
	appleAdapter.SetRootCertificates(testPool)

	repo := billing.NewMemoryRepository()
	reg := billing.NewProviderRegistry(appleAdapter)
	svc := billing.NewService(repo, reg, nil)
	ctx := context.Background()

	userA := "usr_alice"
	userB := "usr_bob"

	payload := billing.AppleTransactionPayload{
		TransactionID:         "tx_unique_charge_555",
		OriginalTransactionID: "tx_unique_charge_555",
		BundleID:              "com.aura.dating",
		ProductID:             billing.PlanBoostSingle,
		PurchaseDate:          time.Now().UnixMilli(),
		Type:                  "Consumable",
		Environment:           "Sandbox",
	}
	jws := buildTestAppleJWS(t, leafCert, rootCert, leafKey, payload)

	// 1. Initial purchase by userA succeeds and grants 1 boost credit
	_, err := svc.VerifyPurchase(ctx, userA, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanBoostSingle,
		ExternalTransactionID: "tx_unique_charge_555",
		ReceiptData:           jws,
	}, "corr_replay_1")
	if err != nil {
		t.Fatalf("initial purchase failed: %v", err)
	}

	creditsAfterFirst, _ := repo.GetBoostCredits(ctx, userA)
	if creditsAfterFirst != 1 {
		t.Fatalf("expected exactly 1 boost credit granted, got %d", creditsAfterFirst)
	}

	// 2. Replay attempt by SAME user returns existing verified transaction idempotently WITHOUT granting duplicate credit
	_, err = svc.VerifyPurchase(ctx, userA, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanBoostSingle,
		ExternalTransactionID: "tx_unique_charge_555",
		ReceiptData:           jws,
	}, "corr_replay_2")
	if err != nil {
		t.Fatalf("expected idempotent success for same user replay, got err=%v", err)
	}

	creditsAfterReplay, _ := repo.GetBoostCredits(ctx, userA)
	if creditsAfterReplay != 1 {
		t.Errorf("replay granted duplicate credit! expected 1, got %d", creditsAfterReplay)
	}

	// 3. Replay attempt by DIFFERENT user (userB) must be REJECTED with ErrDuplicateTransaction
	_, err = svc.VerifyPurchase(ctx, userB, billing.VerifyPurchaseRequest{
		Provider:              billing.ProviderAppleAppStore,
		PlanCode:              billing.PlanBoostSingle,
		ExternalTransactionID: "tx_unique_charge_555",
		ReceiptData:           jws,
	}, "corr_replay_3")
	if !errors.Is(err, billing.ErrDuplicateTransaction) {
		t.Errorf("expected ErrDuplicateTransaction when different user attempts replay, got %v", err)
	}

	userBCredits, _ := repo.GetBoostCredits(ctx, userB)
	if userBCredits != 0 {
		t.Errorf("attacker userB was granted credit! expected 0, got %d", userBCredits)
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
