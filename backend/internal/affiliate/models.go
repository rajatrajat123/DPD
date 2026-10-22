package affiliate

import (
	"errors"
	"time"
)

var (
	ErrAffiliateNotFound        = errors.New("affiliate account not found")
	ErrAffiliateAlreadyExists   = errors.New("user already has an affiliate account")
	ErrAffiliateNotActive       = errors.New("affiliate account is not active")
	ErrSelfReferralBlocked      = errors.New("self-referral is prohibited")
	ErrInvalidPartnerCode       = errors.New("invalid or nonexistent referral partner code")
	ErrCampaignNotFound         = errors.New("affiliate campaign not found")
	ErrCommissionRuleNotFound   = errors.New("commission rule not found for tier")
	ErrDuplicateCommission      = errors.New("commission for transaction already processed")
	ErrInsufficientPayable      = errors.New("insufficient payable balance for payout")
	ErrPayoutBelowMinimum       = errors.New("payout amount is below the minimum threshold")
	ErrTaxFormUnverified        = errors.New("payout requires a verified tax form")
	ErrPayoutBatchNotFound      = errors.New("payout batch not found")
	ErrPayoutAlreadyProcessed   = errors.New("payout batch has already been processed")
	ErrLedgerUnbalanced         = errors.New("double-entry journal debits and credits do not balance")
	ErrUnsupportedCryptoAsset   = errors.New("unsupported crypto asset or network combination")
	ErrCryptoPayoutDisabled     = errors.New("crypto payouts are currently disabled pending provider configuration")
	ErrInvalidWalletAddress     = errors.New("invalid crypto wallet address format")
	ErrDuplicateAttribution     = errors.New("user has already been attributed to an affiliate")
)

const (
	StatusPendingApproval = "PENDING_APPROVAL"
	StatusActive          = "ACTIVE"
	StatusSuspended       = "SUSPENDED"
	StatusTerminated      = "TERMINATED"
)

const (
	TierStandard = "STANDARD"
	TierVIP      = "VIP"
	TierCPAOnly  = "CPA_ONLY"
)

const (
	ModelCPAFixed        = "CPA_FIXED"
	ModelRevsharePercent = "REVSHARE_PERCENT"
	ModelHybrid          = "HYBRID"
)

const (
	CommissionPendingClearance = "PENDING_CLEARANCE"
	CommissionApproved         = "APPROVED"
	CommissionMatured          = "MATURED"
	CommissionPaid             = "PAID"
	CommissionClawedBack       = "CLAWED_BACK"
)

const (
	PayoutMethodStripeConnect = "STRIPE_CONNECT"
	PayoutMethodCrypto        = "CRYPTO"
)

const (
	PayoutPendingApproval = "PENDING_APPROVAL"
	PayoutProcessing      = "PROCESSING"
	PayoutPaid            = "PAID"
	PayoutFailed          = "FAILED"
	PayoutCancelled       = "CANCELLED"
)

const (
	AccountTypeAsset     = "ASSET"
	AccountTypeLiability = "LIABILITY"
	AccountTypeRevenue   = "REVENUE"
	AccountTypeExpense   = "EXPENSE"
)

const (
	JournalCommissionAccrual = "COMMISSION_ACCRUAL"
	JournalEscrowMaturation  = "ESCROW_MATURATION"
	JournalRefundClawback    = "REFUND_CLAWBACK"
	JournalPayoutSettlement  = "PAYOUT_SETTLEMENT"
)

const (
	EntryDebit  = "DEBIT"
	EntryCredit = "CREDIT"
)

// Standard Chart of Accounts Codes
const (
	AccountCodeCommissionExpense = "5000_COMMISSION_EXPENSE"
	AccountCodePlatformCash      = "1010_PLATFORM_CASH"
)

type Affiliate struct {
	ID                     string     `json:"id"`
	UserID                 string     `json:"user_id"`
	PartnerCode            string     `json:"partner_code"`
	Status                 string     `json:"status"`
	Tier                   string     `json:"tier"`
	PayoutCurrency         string     `json:"payout_currency"`
	StripeConnectAccountID *string    `json:"stripe_connect_account_id,omitempty"`
	TaxFormVerified        bool       `json:"tax_form_verified"`
	TermsAcceptedAt        *time.Time `json:"terms_accepted_at,omitempty"`
	TermsVersion           string     `json:"terms_version"`
	PayoutMethod           string     `json:"payout_method"`
	CryptoWalletAddress    *string    `json:"crypto_wallet_address,omitempty"`
	CryptoAsset            string     `json:"crypto_asset"`
	CryptoNetwork          string     `json:"crypto_network"`
	MinimumPayoutCents     int64      `json:"minimum_payout_cents"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
}

type AffiliateCampaign struct {
	ID               string    `json:"id"`
	AffiliateID      string    `json:"affiliate_id"`
	CampaignSlug     string    `json:"campaign_slug"`
	Name             string    `json:"name"`
	DestinationURL   string    `json:"destination_url"`
	ClicksCount      int64     `json:"clicks_count"`
	ConversionsCount int64     `json:"conversions_count"`
	IsActive         bool      `json:"is_active"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type ReferralClick struct {
	ID            string    `json:"id"`
	AffiliateID   string    `json:"affiliate_id"`
	PartnerCode   string    `json:"partner_code"`
	CampaignSlug  *string   `json:"campaign_slug,omitempty"`
	ClickToken    string    `json:"click_token"`
	IPHash        string    `json:"ip_hash"`
	UserAgentHash *string   `json:"user_agent_hash,omitempty"`
	LandingURL    string    `json:"landing_url"`
	ClickedAt     time.Time `json:"clicked_at"`
}

type ReferralAttribution struct {
	ID             string    `json:"id"`
	ReferredUserID string    `json:"referred_user_id"`
	AffiliateID    string    `json:"affiliate_id"`
	PartnerCode    string    `json:"partner_code"`
	SubCampaign    *string   `json:"sub_campaign,omitempty"`
	AttributedAt   time.Time `json:"attributed_at"`
}

type CommissionRule struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	AffiliateTier      string    `json:"affiliate_tier"`
	Model              string    `json:"model"`
	CPAAmountCents     int64     `json:"cpa_amount_cents"`
	RevshareBps        int       `json:"revshare_bps"`
	RecurringEnabled   bool      `json:"recurring_enabled"`
	MaxRecurringMonths int       `json:"max_recurring_months"`
	EscrowHoldDays     int       `json:"escrow_hold_days"`
	CreatedAt          time.Time `json:"created_at"`
}

type AffiliateCommission struct {
	ID                    string         `json:"id"`
	AffiliateID           string         `json:"affiliate_id"`
	TransactionID         string         `json:"transaction_id"`
	ReferredUserID        string         `json:"referred_user_id"`
	RuleSnapshot          map[string]any `json:"rule_snapshot"`
	GrossAmountCents      int64          `json:"gross_amount_cents"`
	CommissionAmountCents int64          `json:"commission_amount_cents"`
	Currency              string         `json:"currency"`
	BillingCycleIndex     int            `json:"billing_cycle_index"`
	Status                string         `json:"status"`
	MaturesAt             time.Time      `json:"matures_at"`
	JournalID             *string        `json:"journal_id,omitempty"`
	CreatedAt             time.Time      `json:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at"`
}

type LedgerAccount struct {
	ID           string    `json:"id"`
	AccountCode  string    `json:"account_code"`
	AccountType  string    `json:"account_type"`
	AffiliateID  *string   `json:"affiliate_id,omitempty"`
	Currency     string    `json:"currency"`
	BalanceCents int64     `json:"balance_cents"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type LedgerJournal struct {
	ID            string    `json:"id"`
	ReferenceType string    `json:"reference_type"`
	ReferenceID   string    `json:"reference_id"`
	Description   string    `json:"description"`
	Currency      string    `json:"currency"`
	PostedAt      time.Time `json:"posted_at"`
}

type LedgerEntry struct {
	ID          string    `json:"id"`
	JournalID   string    `json:"journal_id"`
	AccountID   string    `json:"account_id"`
	Direction   string    `json:"direction"`
	AmountCents int64     `json:"amount_cents"`
	CreatedAt   time.Time `json:"created_at"`
}

type PayoutBatch struct {
	ID                   string     `json:"id"`
	AffiliateID          string     `json:"affiliate_id"`
	AmountCents          int64      `json:"amount_cents"`
	Currency             string     `json:"currency"`
	PayoutMethod         string     `json:"payout_method"`
	DestinationReference string     `json:"destination_reference"`
	CryptoAsset          string     `json:"crypto_asset"`
	CryptoNetwork        string     `json:"crypto_network"`
	Status               string     `json:"status"`
	ExternalPayoutID     *string    `json:"external_payout_id,omitempty"`
	FailureReason        *string    `json:"failure_reason,omitempty"`
	JournalID            *string    `json:"journal_id,omitempty"`
	CreatedAt            time.Time  `json:"created_at"`
	ProcessedAt          *time.Time `json:"processed_at,omitempty"`
}

// Request and Response DTOs
type RegisterAffiliateRequest struct {
	PartnerCode        string `json:"partner_code,omitempty"`
	TermsAccepted      bool   `json:"terms_accepted"`
	TermsVersion       string `json:"terms_version,omitempty"`
	PayoutCurrency     string `json:"payout_currency,omitempty"`
	MinimumPayoutCents int64  `json:"minimum_payout_cents,omitempty"`
}

type UpdateAffiliatePayoutSettingsRequest struct {
	PayoutMethod        string `json:"payout_method"`
	StripeConnectID     string `json:"stripe_connect_id,omitempty"`
	CryptoWalletAddress string `json:"crypto_wallet_address,omitempty"`
	CryptoAsset         string `json:"crypto_asset,omitempty"`
	CryptoNetwork       string `json:"crypto_network,omitempty"`
	MinimumPayoutCents  int64  `json:"minimum_payout_cents,omitempty"`
}

type CreateCampaignRequest struct {
	CampaignSlug   string `json:"campaign_slug"`
	Name           string `json:"name"`
	DestinationURL string `json:"destination_url,omitempty"`
}

type TrackClickRequest struct {
	PartnerCode  string `json:"partner_code"`
	CampaignSlug string `json:"campaign_slug,omitempty"`
	LandingURL   string `json:"landing_url"`
	ClientIP     string `json:"client_ip"`
	UserAgent    string `json:"user_agent"`
}

type ClickTrackingResponse struct {
	ClickToken     string `json:"click_token"`
	DestinationURL string `json:"destination_url"`
}

type AffiliateBalanceSummary struct {
	PendingEscrowCents int64  `json:"pending_escrow_cents"`
	PayableCents       int64  `json:"payable_cents"`
	LifetimePaidCents  int64  `json:"lifetime_paid_cents"`
	Currency           string `json:"currency"`
}

type AffiliateDashboardSummary struct {
	Affiliate    Affiliate               `json:"affiliate"`
	Balances     AffiliateBalanceSummary `json:"balances"`
	TotalClicks  int64                   `json:"total_clicks"`
	Conversions  int64                   `json:"total_conversions"`
	Campaigns    []AffiliateCampaign     `json:"campaigns"`
}

type ConversionReportItem struct {
	CommissionID   string    `json:"commission_id"`
	OccurredAt     time.Time `json:"occurred_at"`
	CycleIndex     int       `json:"billing_cycle_index"`
	GrossAmount    int64     `json:"gross_amount_cents"`
	CommissionAmount int64   `json:"commission_amount_cents"`
	Currency       string    `json:"currency"`
	Status         string    `json:"status"`
	MaturesAt      time.Time `json:"matures_at"`
}

type RequestPayoutRequest struct {
	AmountCents int64 `json:"amount_cents,omitempty"` // 0 indicates full available balance
}

type AdminUpdateAffiliateStatusRequest struct {
	Status          string `json:"status"`
	Tier            string `json:"tier,omitempty"`
	TaxFormVerified *bool  `json:"tax_form_verified,omitempty"`
	Reason          string `json:"reason"`
}

type AdminCommissionRuleRequest struct {
	Name               string `json:"name"`
	AffiliateTier      string `json:"affiliate_tier"`
	Model              string `json:"model"`
	CPAAmountCents     int64  `json:"cpa_amount_cents"`
	RevshareBps        int    `json:"revshare_bps"`
	RecurringEnabled   bool   `json:"recurring_enabled"`
	MaxRecurringMonths int    `json:"max_recurring_months"`
	EscrowHoldDays     int    `json:"escrow_hold_days"`
}

// In-App User Referral Rewards Constants
const (
	EntitlementAdSupportedAccess = "AD_SUPPORTED_ACCESS"
	SourceReferralReward         = "REFERRAL_REWARD"
	RewardStatusNone             = "NONE"
	RewardStatusActive           = "ACTIVE"
	RewardStatusExpired          = "EXPIRED"
)

// UserReferralReward stores persisted reward state per user
type UserReferralReward struct {
	ID            string     `json:"id"`
	UserID        string     `json:"user_id"`
	PartnerCode   string     `json:"partner_code"`
	VerifiedCount int        `json:"verified_count"`
	RewardTier    int        `json:"reward_tier"`
	RewardStatus  string     `json:"reward_status"`
	ActivatedAt   *time.Time `json:"activated_at,omitempty"`
	ExpiresAt     *time.Time `json:"expires_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// UserReferralRewardConfig defines the configurable reward thresholds and durations
type UserReferralRewardConfig struct {
	Tier1Threshold  int `json:"tier1_threshold"`  // default: 1 referral
	Tier1RewardDays int `json:"tier1_reward_days"` // default: 30 days
	Tier2Threshold  int `json:"tier2_threshold"`  // default: 3 referrals
	Tier2RewardDays int `json:"tier2_reward_days"` // default: 60 days total
}

func DefaultUserReferralRewardConfig() UserReferralRewardConfig {
	return UserReferralRewardConfig{
		Tier1Threshold:  1,
		Tier1RewardDays: 30,
		Tier2Threshold:  3,
		Tier2RewardDays: 60,
	}
}

// ReferralNextMilestone represents the user's next reward target
type ReferralNextMilestone struct {
	TargetReferrals int    `json:"target_referrals"`
	RemainingNeeded int    `json:"remaining_needed"`
	RewardDays      int    `json:"reward_days"`
	Description     string `json:"description"`
}

// ReferredUserSummary summarizes an attributed user for the referral dashboard
type ReferredUserSummary struct {
	MaskedIdentifier string     `json:"masked_identifier"`
	Status           string     `json:"status"` // "VERIFIED" or "PENDING_VERIFICATION"
	AttributedAt     time.Time  `json:"attributed_at"`
	VerifiedAt       *time.Time `json:"verified_at,omitempty"`
}

// UserReferralStatus represents the complete in-app status returned to the mobile client
type UserReferralStatus struct {
	ReferralCode         string                 `json:"referral_code"`
	InviteURL            string                 `json:"invite_url"`
	VerifiedCount        int                    `json:"verified_count"`
	PendingCount         int                    `json:"pending_count"`
	TotalCount           int                    `json:"total_count"`
	RewardTier           int                    `json:"reward_tier"`           // 0, 1, or 2
	RewardStatus         string                 `json:"reward_status"`         // "NONE", "ACTIVE", "EXPIRED"
	DaysGranted          int                    `json:"days_granted"`          // 0, 30, or 60
	DaysRemaining        int                    `json:"days_remaining"`
	ActivatedAt          *time.Time             `json:"activated_at,omitempty"`
	ExpiresAt            *time.Time             `json:"expires_at,omitempty"`
	HasPaidSubscription  bool                   `json:"has_paid_subscription"`
	PaidSubscriptionTier string                 `json:"paid_subscription_tier,omitempty"`
	NextMilestone        *ReferralNextMilestone `json:"next_milestone,omitempty"`
	RecentReferrals      []ReferredUserSummary  `json:"recent_referrals"`
}
