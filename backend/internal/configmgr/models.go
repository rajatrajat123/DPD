package configmgr

import (
	"encoding/json"
	"time"
)

type PlatformConfig struct {
	ID          string          `json:"id"`
	ConfigKey   string          `json:"config_key"`
	ConfigValue json.RawMessage `json:"config_value"`
	Description string          `json:"description,omitempty"`
	UpdatedBy   *string         `json:"updated_by,omitempty"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

type AdvertisingConfig struct {
	SwipeFeedAdInterval  int  `json:"swipe_feed_ad_interval"` // e.g. 10-12
	RewardedAdEnabled    bool `json:"rewarded_ad_enabled"`
	BannerEnabled        bool `json:"banner_enabled"`
	AdFrequencyCapHourly int  `json:"ad_frequency_cap_hourly"`
}

type LikesRevealConfig struct {
	FreeRevealsCount int  `json:"free_reveals_count"` // e.g. 1
	RevealsPerAd     int  `json:"reveals_per_ad"`     // e.g. 2
	CooldownHours    int  `json:"cooldown_hours"`    // e.g. 4
	DailyRevealLimit int  `json:"daily_reveal_limit"` // e.g. 10
	PremiumUnlimited bool `json:"premium_unlimited"`
}

type BoostConfig struct {
	PriceCents      int64   `json:"price_cents"`      // e.g. 500 = $5.00
	DurationMinutes int     `json:"duration_minutes"` // e.g. 60
	MaxRadiusKm     int     `json:"max_radius_km"`     // e.g. 200
	Multiplier      float64 `json:"multiplier"`        // e.g. 2.5
	IsActive        bool    `json:"is_active"`
}

type AffiliateConfig struct {
	Mode                   string `json:"mode"` // "REVSHARE_PERCENT" or "CPA_FIXED"
	DefaultCPACents        int64  `json:"default_cpa_cents"`
	DefaultRevshareBps     int    `json:"default_revshare_bps"`
	MinimumPayoutCents     int64  `json:"minimum_payout_cents"`
	ManualApprovalRequired bool   `json:"manual_approval_required"`
	FirstPaymentOnly       bool   `json:"first_payment_only"`
	MaxQualifyingRenewals  int    `json:"max_qualifying_renewals"`
	EscrowHoldDays         int    `json:"escrow_hold_days"`
}

type SupportRoutingConfig struct {
	DefaultStrategy string `json:"default_strategy"` // "WORKLOAD" or "ROUND_ROBIN"
	AutoAssign      bool   `json:"auto_assign"`
	EscalationHours int    `json:"escalation_hours"`
}

type CountrySettings struct {
	SupportedCountries  []string `json:"supported_countries"`
	RestrictedCountries []string `json:"restricted_countries"`
	DefaultCurrency     string   `json:"default_currency"`
}
