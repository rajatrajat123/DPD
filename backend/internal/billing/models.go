package billing

import (
	"errors"
	"time"
)

var (
	ErrProductNotFound       = errors.New("billing product not found")
	ErrInvalidPlanCode       = errors.New("invalid or unsupported plan_code")
	ErrInvalidProvider       = errors.New("unsupported billing provider")
	ErrSubscriptionNotFound  = errors.New("subscription not found")
	ErrActiveSubscriptionExists = errors.New("user already has an active subscription")
	ErrInsufficientBoostCredits = errors.New("insufficient boost credits remaining")
	ErrActiveBoostRunning    = errors.New("a profile boost is already active")
	ErrInvalidWebhookSignature = errors.New("invalid webhook signature")
	ErrDuplicateWebhookEvent     = errors.New("duplicate webhook event already processed")
	ErrTransactionNotFound       = errors.New("payment transaction not found")
	ErrProviderNotConfigured     = errors.New("payment provider credentials not configured (BLOCKED)")
	ErrTermsConsentRequired      = errors.New("explicit acceptance of subscription terms and auto-renewal is required")
	ErrInvalidReceiptData        = errors.New("valid signed store receipt_data is required for purchase verification")
	ErrReceiptValidationFailed   = errors.New("store receipt validation failed")
	ErrIndiaMandateNotCompliant  = errors.New("India recurring e-mandate requires verified pre-debit notification sink (BLOCKED)")
	ErrDuplicateTransaction      = errors.New("duplicate payment transaction already processed or claimed by another user")
	ErrPurchaseUserMismatch      = errors.New("store purchase is bound to a different user account")
)

const (
	PlanAuraPlusMonthly   = "AURA_PLUS_MONTHLY"
	PlanAuraPlusAnnual    = "AURA_PLUS_ANNUAL"
	PlanAuraBlackMonthly  = "AURA_BLACK_MONTHLY"
	PlanAuraBlackAnnual   = "AURA_BLACK_ANNUAL"
	PlanBoostSingle       = "BOOST_SINGLE"
	PlanBoost5Pack        = "BOOST_5PACK"
	PlanSuperSpark5Pack   = "SUPERSPARK_5PACK"
)

const (
	ProductTypeSubscription = "SUBSCRIPTION"
	ProductTypeConsumable   = "CONSUMABLE"
)

const (
	BillingPeriodMonthly = "MONTHLY"
	BillingPeriodAnnual  = "ANNUAL"
	BillingPeriodNone    = "NONE"
)

const (
	TierFree       = "FREE"
	TierPlus       = "PLUS"
	TierBlack      = "BLACK"
	TierConsumable = "CONSUMABLE"
)

const (
	StatusTrialing    = "TRIALING"
	StatusActive      = "ACTIVE"
	StatusPastDue     = "PAST_DUE"
	StatusGracePeriod = "GRACE_PERIOD"
	StatusCanceled    = "CANCELED"
	StatusExpired     = "EXPIRED"
	StatusRefunded    = "REFUNDED"
	StatusChargeback  = "CHARGEBACK"
)

const (
	ProviderStripe        = "STRIPE"
	ProviderAppleAppStore = "APPLE_APP_STORE"
	ProviderGooglePlay    = "GOOGLE_PLAY"
)

const (
	TxInitialPurchase = "INITIAL_PURCHASE"
	TxRenewal         = "RENEWAL"
	TxBoostPurchase   = "BOOST_PURCHASE"
	TxRefund          = "REFUND"
	TxChargeback      = "CHARGEBACK"
)

const (
	EntitlementUnlimitedSwipes    = "UNLIMITED_SWIPES"
	EntitlementSeeWhoLikedYou     = "SEE_WHO_LIKED_YOU"
	EntitlementRewind             = "REWIND"
	EntitlementTravelMode         = "TRAVEL_MODE"
	EntitlementReadReceipts       = "READ_RECEIPTS"
	EntitlementPriorityLikes      = "PRIORITY_LIKES"
	EntitlementIncognitoBrowsing  = "INCOGNITO_BROWSING"
	EntitlementSuperSpark         = "SUPER_SPARK"
)

const (
	BoostStatusActive    = "ACTIVE"
	BoostStatusExpired   = "EXPIRED"
	BoostStatusCancelled = "CANCELLED"
)

type Product struct {
	ID            string    `json:"id"`
	PlanCode      string    `json:"plan_code"`
	Name          string    `json:"name"`
	Description   string    `json:"description"`
	ProductType   string    `json:"product_type"`
	Tier          string    `json:"tier"`
	BillingPeriod string    `json:"billing_period"`
	PriceCents    int64     `json:"price_cents"`
	Currency      string    `json:"currency"`
	Entitlements  []string  `json:"entitlements"`
	BoostCredits  int       `json:"boost_credits"`
	IsActive      bool      `json:"is_active"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type Subscription struct {
	ID                     string    `json:"id"`
	UserID                 string    `json:"user_id"`
	PlanCode               string    `json:"plan_code"`
	Provider               string    `json:"provider"`
	ExternalSubscriptionID string    `json:"external_subscription_id"`
	Status                 string    `json:"status"`
	Currency               string    `json:"currency"`
	PriceCents             int64     `json:"price_cents"`
	CurrentPeriodStart     time.Time `json:"current_period_start"`
	CurrentPeriodEnd       time.Time `json:"current_period_end"`
	CancelAtPeriodEnd      bool      `json:"cancel_at_period_end"`
	CreatedAt              time.Time `json:"created_at"`
	UpdatedAt              time.Time `json:"updated_at"`
}

func (s *Subscription) IsActive() bool {
	if s == nil {
		return false
	}
	now := time.Now().UTC()
	// ACTIVE, TRIALING, and GRACE_PERIOD grant service access
	switch s.Status {
	case StatusActive, StatusTrialing, StatusGracePeriod:
		return s.CurrentPeriodEnd.After(now)
	case StatusCanceled:
		// If user canceled but period has not ended, benefits remain active until period end
		return s.CurrentPeriodEnd.After(now)
	default:
		return false
	}
}

type PaymentTransaction struct {
	ID                string    `json:"id"`
	UserID            string    `json:"user_id"`
	SubscriptionID    *string   `json:"subscription_id,omitempty"`
	Provider          string    `json:"provider"`
	ExternalChargeID  string    `json:"external_charge_id"`
	TransactionType   string    `json:"transaction_type"`
	GrossAmountCents  int64     `json:"gross_amount_cents"`
	ProviderFeeCents  int64     `json:"provider_fee_cents"`
	TaxAmountCents    int64     `json:"tax_amount_cents"`
	NetAmountCents    int64     `json:"net_amount_cents"`
	Currency          string    `json:"currency"`
	BillingCycleIndex int       `json:"billing_cycle_index"`
	OccurredAt        time.Time `json:"occurred_at"`
}

type UserBoostCredits struct {
	UserID           string    `json:"user_id"`
	CreditsRemaining int       `json:"credits_remaining"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type ProfileBoost struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	DurationMinutes int       `json:"duration_minutes"`
	Multiplier      float64   `json:"multiplier"`
	ActivatedAt     time.Time `json:"activated_at"`
	ExpiresAt       time.Time `json:"expires_at"`
	Status          string    `json:"status"`
}

func (b *ProfileBoost) IsActive() bool {
	if b == nil {
		return false
	}
	return b.Status == BoostStatusActive && b.ExpiresAt.After(time.Now().UTC())
}

type UserEntitlement struct {
	ID              string         `json:"id"`
	UserID          string         `json:"user_id"`
	EntitlementCode string         `json:"entitlement_code"`
	Source          string         `json:"source"`
	GrantedAt       time.Time      `json:"granted_at"`
	ExpiresAt       time.Time      `json:"expires_at"`
	Metadata        map[string]any `json:"metadata,omitempty"`
}

func (e *UserEntitlement) IsActive() bool {
	if e == nil {
		return false
	}
	return e.ExpiresAt.After(time.Now().UTC())
}

type SubscriptionConsentRecord struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	PlanCode        string    `json:"plan_code"`
	PriceCents      int64     `json:"price_cents"`
	Currency        string    `json:"currency"`
	BillingInterval string    `json:"billing_interval"`
	TermsVersion    string    `json:"terms_version"`
	ConsentGiven    bool      `json:"consent_given"`
	IPAddress       string    `json:"ip_address,omitempty"`
	UserAgent       string    `json:"user_agent,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

type PreDebitNotice struct {
	UserID          string    `json:"user_id"`
	SubscriptionID  string    `json:"subscription_id"`
	ExternalSubID   string    `json:"external_sub_id"`
	AmountCents     int64     `json:"amount_cents"`
	Currency        string    `json:"currency"`
	ScheduledDate   time.Time `json:"scheduled_date"`
	MandateID       string    `json:"mandate_id"`
	CancellationURL string    `json:"cancellation_url"`
}

// Request and Response DTOs
type CheckoutRequest struct {
	PlanCode      string `json:"plan_code"`
	Provider      string `json:"provider"`
	SuccessURL    string `json:"success_url"`
	CancelURL     string `json:"cancel_url"`
	TermsAccepted bool   `json:"terms_accepted"`
	TermsVersion  string `json:"terms_version,omitempty"`
	Storefront    string `json:"storefront,omitempty"`
}

type CheckoutSession struct {
	SessionID   string `json:"session_id"`
	Provider    string `json:"provider"`
	PlanCode    string `json:"plan_code"`
	CheckoutURL string `json:"checkout_url"`
	AmountCents int64  `json:"amount_cents"`
	Currency    string `json:"currency"`
}

type VerifyPurchaseRequest struct {
	Provider              string `json:"provider"`
	PlanCode              string `json:"plan_code"`
	ExternalTransactionID string `json:"external_transaction_id"`
	ReceiptData           string `json:"receipt_data,omitempty"`
	UserID                string `json:"user_id,omitempty"`
}

type SubscriptionStatusResponse struct {
	HasActiveSubscription bool          `json:"has_active_subscription"`
	Tier                  string        `json:"tier"`
	Subscription          *Subscription `json:"subscription,omitempty"`
	Entitlements          []string      `json:"entitlements"`
	BoostCreditsRemaining int           `json:"boost_credits_remaining"`
	ActiveBoost           *ProfileBoost `json:"active_boost,omitempty"`
}

type ActivateBoostRequest struct {
	DurationMinutes int `json:"duration_minutes,omitempty"`
}

type ActivateBoostResponse struct {
	Boost            *ProfileBoost `json:"boost"`
	CreditsRemaining int           `json:"credits_remaining"`
}

type BoostStatusResponse struct {
	CreditsRemaining int           `json:"credits_remaining"`
	ActiveBoost      *ProfileBoost `json:"active_boost,omitempty"`
}
