package affiliate_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/affiliate"
	"github.com/auradating/platform/backend/internal/events"
)

func setupTestAffiliateService(t *testing.T) (*affiliate.Service, *affiliate.MemoryRepository) {
	t.Helper()
	repo := affiliate.NewMemoryRepository()
	stripePayout := affiliate.NewStripeConnectPayoutAdapter("sk_test_123")
	cryptoPayout := affiliate.NewCryptoPayoutAdapter(false, "")
	reg := affiliate.NewPayoutRegistry(stripePayout, cryptoPayout)
	svc := affiliate.NewService(repo, reg, nil)
	return svc, repo
}

func TestAffiliateRegistrationAndCampaigns(t *testing.T) {
	svc, repo := setupTestAffiliateService(t)
	ctx := context.Background()
	userID := "usr_partner_1"

	// 1. Must accept terms
	_, err := svc.RegisterAffiliate(ctx, userID, affiliate.RegisterAffiliateRequest{
		TermsAccepted: false,
	})
	if err == nil {
		t.Fatalf("expected error when terms are not accepted")
	}

	// 2. Successful registration
	aff, err := svc.RegisterAffiliate(ctx, userID, affiliate.RegisterAffiliateRequest{
		PartnerCode:   "QUEER_CREATOR",
		TermsAccepted: true,
	})
	if err != nil {
		t.Fatalf("failed to register affiliate: %v", err)
	}
	if aff.PartnerCode != "QUEER_CREATOR" {
		t.Errorf("expected partner code QUEER_CREATOR, got %s", aff.PartnerCode)
	}
	if aff.Status != affiliate.StatusActive {
		t.Errorf("expected status ACTIVE, got %s", aff.Status)
	}

	// 3. Prevent duplicate registration
	_, err = svc.RegisterAffiliate(ctx, userID, affiliate.RegisterAffiliateRequest{
		TermsAccepted: true,
	})
	if err != affiliate.ErrAffiliateAlreadyExists {
		t.Errorf("expected ErrAffiliateAlreadyExists, got %v", err)
	}

	// 4. Create campaign and track click
	camp := &affiliate.AffiliateCampaign{
		AffiliateID:    aff.ID,
		CampaignSlug:   "summer-pride",
		Name:           "Summer Pride 2026",
		DestinationURL: "https://auradating.com/pride",
		IsActive:       true,
	}
	if err := repo.CreateCampaign(ctx, camp); err != nil {
		t.Fatalf("failed to create campaign: %v", err)
	}

	clickResp, err := svc.TrackClick(ctx, affiliate.TrackClickRequest{
		PartnerCode:  "QUEER_CREATOR",
		CampaignSlug: "summer-pride",
		LandingURL:   "https://auradating.com/r/QUEER_CREATOR?campaign=summer-pride",
		ClientIP:     "198.51.100.42",
		UserAgent:    "Mozilla/5.0 TestBrowser",
	})
	if err != nil {
		t.Fatalf("failed to track click: %v", err)
	}
	if clickResp.ClickToken == "" {
		t.Errorf("expected non-empty click token")
	}
	if clickResp.DestinationURL != "https://auradating.com/pride" {
		t.Errorf("expected custom destination URL, got %s", clickResp.DestinationURL)
	}
}

func TestReferralAttributionAndAntiFraud(t *testing.T) {
	svc, _ := setupTestAffiliateService(t)
	ctx := context.Background()

	aff, _ := svc.RegisterAffiliate(ctx, "usr_affiliate_boss", affiliate.RegisterAffiliateRequest{
		PartnerCode:   "PRIDE_AMBASSADOR",
		TermsAccepted: true,
	})

	// 1. Self-referral block: affiliate cannot attribute their own account
	_, err := svc.AttributeRegistration(ctx, "usr_affiliate_boss", "PRIDE_AMBASSADOR", "default")
	if err != affiliate.ErrSelfReferralBlocked {
		t.Errorf("expected ErrSelfReferralBlocked, got %v", err)
	}

	// 2. Successful attribution of new user
	attr, err := svc.AttributeRegistration(ctx, "usr_new_dating_member", "PRIDE_AMBASSADOR", "instagram_story")
	if err != nil {
		t.Fatalf("failed to attribute registration: %v", err)
	}
	if attr.AffiliateID != aff.ID {
		t.Errorf("expected affiliate ID %s, got %s", aff.ID, attr.AffiliateID)
	}
}

func TestCommissionCalculationAndLedgerIntegrity(t *testing.T) {
	svc, repo := setupTestAffiliateService(t)
	ctx := context.Background()

	aff, _ := svc.RegisterAffiliate(ctx, "usr_affiliate_vip", affiliate.RegisterAffiliateRequest{
		PartnerCode:   "VIP_PARTNER",
		TermsAccepted: true,
	})
	// Upgrade to VIP tier (Hybrid: $15 CPA + 30% RevShare)
	_ = repo.UpdateAffiliateStatus(ctx, aff.ID, affiliate.StatusActive, affiliate.TierVIP, nil)

	// Attribute user
	referredUser := "usr_subscriber_vip"
	_, _ = svc.AttributeRegistration(ctx, referredUser, "VIP_PARTNER", "pride_campaign")

	// 1. Initial purchase: $119.88 (11988 cents) net
	// Expected commission: $15.00 CPA (1500c) + 30% of 11988c (3596c) = 5096 cents ($50.96)
	comm1, err := svc.ProcessVerifiedTransaction(ctx, "tx_1001", referredUser, 11988, "USD", 1)
	if err != nil {
		t.Fatalf("failed to process verified transaction: %v", err)
	}
	if comm1 == nil {
		t.Fatalf("expected non-nil commission")
	}
	if comm1.CommissionAmountCents != 5096 {
		t.Errorf("expected commission 5096 cents, got %d", comm1.CommissionAmountCents)
	}
	if comm1.Status != affiliate.CommissionPendingClearance {
		t.Errorf("expected status PENDING_CLEARANCE, got %s", comm1.Status)
	}

	// 2. Check double-entry balances:
	// Pending Escrow should be 5096 cents; Payable should be 0 (in 30-day hold)
	escrow, payable, _, err := repo.GetAffiliateBalances(ctx, aff.ID)
	if err != nil {
		t.Fatalf("failed to get balances: %v", err)
	}
	if escrow != 5096 {
		t.Errorf("expected pending escrow 5096 cents, got %d", escrow)
	}
	if payable != 0 {
		t.Errorf("expected payable 0 cents before hold, got %d", payable)
	}

	// 3. Duplicate transaction must be ignored idempotently without extra accrual
	dupComm, err := svc.ProcessVerifiedTransaction(ctx, "tx_1001", referredUser, 11988, "USD", 1)
	if err != nil || dupComm.ID != comm1.ID {
		t.Errorf("expected duplicate to return existing commission cleanly")
	}
	escrowAfterDup, _, _, _ := repo.GetAffiliateBalances(ctx, aff.ID)
	if escrowAfterDup != 5096 {
		t.Errorf("expected escrow to remain unchanged at 5096 cents, got %d", escrowAfterDup)
	}

	// 4. Second cycle renewal (Cycle 2): 30% of $119.88 = 3596 cents (CPA not paid on renewal)
	comm2, err := svc.ProcessVerifiedTransaction(ctx, "tx_1002", referredUser, 11988, "USD", 2)
	if err != nil || comm2 == nil {
		t.Fatalf("failed to process cycle 2 renewal: %v", err)
	}
	if comm2.CommissionAmountCents != 3596 {
		t.Errorf("expected renewal commission 3596 cents, got %d", comm2.CommissionAmountCents)
	}

	totalEscrow, _, _, _ := repo.GetAffiliateBalances(ctx, aff.ID)
	if totalEscrow != 5096+3596 {
		t.Errorf("expected total escrow 8692 cents, got %d", totalEscrow)
	}
}

func TestRefundClawbackCompensatingReversal(t *testing.T) {
	svc, repo := setupTestAffiliateService(t)
	ctx := context.Background()

	aff, _ := svc.RegisterAffiliate(ctx, "usr_aff_clawback", affiliate.RegisterAffiliateRequest{
		PartnerCode:   "CLAW_PARTNER",
		TermsAccepted: true,
	})
	referredUser := "usr_claw_customer"
	_, _ = svc.AttributeRegistration(ctx, referredUser, "CLAW_PARTNER", "default")

	// Accrue commission on $19.99 (1999 cents) Standard tier (25% = 499 cents)
	comm, _ := svc.ProcessVerifiedTransaction(ctx, "tx_refund_me", referredUser, 1999, "USD", 1)
	if comm == nil || comm.CommissionAmountCents != 499 {
		t.Fatalf("expected 499 cents commission")
	}

	escrowBefore, _, _, _ := repo.GetAffiliateBalances(ctx, aff.ID)
	if escrowBefore != 499 {
		t.Fatalf("expected 499 cents in escrow")
	}

	// Process refund clawback
	err := svc.ProcessTransactionRefund(ctx, "tx_refund_me")
	if err != nil {
		t.Fatalf("failed to process refund: %v", err)
	}

	// Escrow balance should be cleanly reduced back to 0
	escrowAfter, _, _, _ := repo.GetAffiliateBalances(ctx, aff.ID)
	if escrowAfter != 0 {
		t.Errorf("expected escrow balance 0 after clawback, got %d", escrowAfter)
	}

	updatedComm, _ := repo.GetCommissionByTransactionID(ctx, "tx_refund_me")
	if updatedComm.Status != affiliate.CommissionClawedBack {
		t.Errorf("expected status CLAWED_BACK, got %s", updatedComm.Status)
	}
}

func TestEscrowMaturationAndPayoutSettlement(t *testing.T) {
	svc, repo := setupTestAffiliateService(t)
	ctx := context.Background()

	aff, _ := svc.RegisterAffiliate(ctx, "usr_aff_payout", affiliate.RegisterAffiliateRequest{
		PartnerCode:   "PAYOUT_PARTNER",
		TermsAccepted: true,
	})
	referredUser := "usr_payout_customer"
	_, _ = svc.AttributeRegistration(ctx, referredUser, "PAYOUT_PARTNER", "default")

	// Accrue $60.00 commission
	comm, _ := svc.ProcessVerifiedTransaction(ctx, "tx_big_purchase", referredUser, 24000, "USD", 1) // 25% of 24000 = 6000c ($60)
	if comm.CommissionAmountCents != 6000 {
		t.Fatalf("expected 6000 cents commission")
	}

	// 1. Mature commissions past hold date
	future := time.Now().UTC().Add(35 * 24 * time.Hour)
	count, err := svc.MaturePendingCommissions(ctx, future)
	if err != nil {
		t.Fatalf("maturation failed: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 matured commission, got %d", count)
	}

	escrow, payable, _, _ := repo.GetAffiliateBalances(ctx, aff.ID)
	if escrow != 0 {
		t.Errorf("expected 0 escrow after maturation, got %d", escrow)
	}
	if payable != 6000 {
		t.Errorf("expected 6000 payable cents, got %d", payable)
	}

	// 2. Request payout without tax form verified -> should fail
	_, err = svc.RequestPayout(ctx, aff.ID, affiliate.RequestPayoutRequest{AmountCents: 6000})
	if err != affiliate.ErrTaxFormUnverified {
		t.Errorf("expected ErrTaxFormUnverified, got %v", err)
	}

	// Verify tax form and set Stripe Connect account
	taxVerified := true
	connectID := "acct_123456789"
	_ = repo.UpdateAffiliateStatus(ctx, aff.ID, affiliate.StatusActive, aff.Tier, &taxVerified)
	_ = repo.UpdateAffiliatePayoutSettings(ctx, aff.ID, affiliate.UpdateAffiliatePayoutSettingsRequest{
		PayoutMethod:    affiliate.PayoutMethodStripeConnect,
		StripeConnectID: connectID,
	})

	// 3. Successful payout request
	batch, err := svc.RequestPayout(ctx, aff.ID, affiliate.RequestPayoutRequest{AmountCents: 6000})
	if err != nil {
		t.Fatalf("failed to request payout: %v", err)
	}
	if batch.Status != affiliate.PayoutPendingApproval {
		t.Errorf("expected status PENDING_APPROVAL, got %s", batch.Status)
	}

	// 4. Admin approves and disburses payout
	approvedBatch, err := svc.ApproveAndDisbursePayout(ctx, batch.ID)
	if err != nil {
		t.Fatalf("payout approval failed: %v", err)
	}
	if approvedBatch.Status != affiliate.PayoutPaid {
		t.Errorf("expected status PAID, got %s", approvedBatch.Status)
	}

	// 5. Payable balance is now disbursed (0), lifetime paid is 6000 cents
	_, payableAfter, lifetimePaid, _ := repo.GetAffiliateBalances(ctx, aff.ID)
	if payableAfter != 0 {
		t.Errorf("expected 0 payable after disbursement, got %d", payableAfter)
	}
	if lifetimePaid != 6000 {
		t.Errorf("expected 6000 cents lifetime paid, got %d", lifetimePaid)
	}
}

func TestCryptoPayoutValidationAndBoundary(t *testing.T) {
	// EVM address validation
	if err := affiliate.ValidateCryptoAddress("0x71C84940f9227A6aE87550fBEB3f2b4A247c7c8D", "POLYGON"); err != nil {
		t.Errorf("expected valid EVM address, got %v", err)
	}
	if err := affiliate.ValidateCryptoAddress("0xinvalid", "POLYGON"); err == nil {
		t.Errorf("expected error for invalid address length")
	}

	// Solana address validation
	if err := affiliate.ValidateCryptoAddress("4Nd1mBQtrMJVYVfKf2PJy9NZmcCcPHzVQ265jvvL8ypL", "SOLANA"); err != nil {
		t.Errorf("expected valid Solana address, got %v", err)
	}

	// Adapter disabled check
	adapter := affiliate.NewCryptoPayoutAdapter(false, "")
	_, err := adapter.DisbursePayout(context.Background(), &affiliate.PayoutBatch{
		CryptoAsset:          "USDC",
		CryptoNetwork:        "POLYGON",
		DestinationReference: "0x71C84940f9227A6aE87550fBEB3f2b4A247c7c8D",
	})
	if err != affiliate.ErrCryptoPayoutDisabled {
		t.Errorf("expected ErrCryptoPayoutDisabled, got %v", err)
	}
}

func TestBillingEventConsumerIntegration(t *testing.T) {
	svc, repo := setupTestAffiliateService(t)
	ctx := context.Background()

	aff, _ := svc.RegisterAffiliate(ctx, "usr_aff_event", affiliate.RegisterAffiliateRequest{
		PartnerCode:   "EVENT_PARTNER",
		TermsAccepted: true,
	})
	referredUser := "usr_event_subscriber"
	_, _ = svc.AttributeRegistration(ctx, referredUser, "EVENT_PARTNER", "social")

	// Emit verified transaction event from billing
	txPayload, _ := json.Marshal(map[string]any{
		"transaction_id":      "tx_verified_event_1",
		"user_id":             referredUser,
		"gross_amount_cents":  3499,
		"net_amount_cents":    3499,
		"currency":            "USD",
		"billing_cycle_index": 1,
	})
	env := events.Envelope{
		EventType: "billing.transaction_verified.v1",
		Payload:   txPayload,
	}

	if err := svc.HandleBillingEvent(ctx, env); err != nil {
		t.Fatalf("failed to handle billing verified event: %v", err)
	}

	comm, _ := repo.GetCommissionByTransactionID(ctx, "tx_verified_event_1")
	if comm == nil {
		t.Fatalf("expected commission created from billing event")
	}
	if comm.CommissionAmountCents != (3499*2500)/10000 { // 25% of 3499 = 874 cents
		t.Errorf("expected 874 cents, got %d", comm.CommissionAmountCents)
	}

	// Refund event
	refundPayload, _ := json.Marshal(map[string]any{
		"transaction_id": "tx_verified_event_1",
	})
	refundEnv := events.Envelope{
		EventType: "billing.transaction_refunded.v1",
		Payload:   refundPayload,
	}
	if err := svc.HandleBillingEvent(ctx, refundEnv); err != nil {
		t.Fatalf("failed to handle billing refund event: %v", err)
	}

	escrow, _, _, _ := repo.GetAffiliateBalances(ctx, aff.ID)
	if escrow != 0 {
		t.Errorf("expected escrow 0 after refund, got %d", escrow)
	}
}

func TestAffiliateHTTPHandlerAndRedirect(t *testing.T) {
	svc, _ := setupTestAffiliateService(t)
	handler := affiliate.NewHandler(svc, nil)

	// 1. Register partner
	_, _ = svc.RegisterAffiliate(context.Background(), "usr_web_boss", affiliate.RegisterAffiliateRequest{
		PartnerCode:   "WEB_PARTNER",
		TermsAccepted: true,
	})

	// 2. Test GET /r/{partner_code} referral redirect
	req := httptest.NewRequest(http.MethodGet, "/r/WEB_PARTNER", nil)
	rec := httptest.NewRecorder()
	handler.ReferralRedirect(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("expected 302 Found, got %d", rec.Code)
	}

	// Check aura_ref cookie
	cookies := rec.Result().Cookies()
	var foundRef bool
	for _, c := range cookies {
		if c.Name == "aura_ref" {
			foundRef = true
			if c.MaxAge <= 0 {
				t.Errorf("expected positive MaxAge on aura_ref cookie")
			}
		}
	}
	if !foundRef {
		t.Errorf("expected aura_ref cookie to be set")
	}
}
