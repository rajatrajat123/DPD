package configmgr

import (
	"context"
	"encoding/json"
	"fmt"
)

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) GetConfig(ctx context.Context, key string) (json.RawMessage, error) {
	return s.repo.Get(ctx, key)
}

func (s *Service) GetAllConfigs(ctx context.Context) (map[string]json.RawMessage, error) {
	return s.repo.GetAll(ctx)
}

func (s *Service) UpdateConfig(ctx context.Context, key string, val json.RawMessage, updatedBy *string) error {
	// Validate JSON syntax
	var js any
	if err := json.Unmarshal(val, &js); err != nil {
		return fmt.Errorf("invalid json payload: %w", err)
	}

	// Key-specific validation
	switch key {
	case "advertising":
		var cfg AdvertisingConfig
		if err := json.Unmarshal(val, &cfg); err != nil {
			return fmt.Errorf("invalid advertising config schema: %w", err)
		}
		if cfg.SwipeFeedAdInterval < 1 {
			return fmt.Errorf("swipe_feed_ad_interval must be at least 1")
		}
	case "likes_reveals":
		var cfg LikesRevealConfig
		if err := json.Unmarshal(val, &cfg); err != nil {
			return fmt.Errorf("invalid likes_reveals config schema: %w", err)
		}
		if cfg.RevealsPerAd < 1 {
			return fmt.Errorf("reveals_per_ad must be at least 1")
		}
		if cfg.CooldownHours < 0 {
			return fmt.Errorf("cooldown_hours cannot be negative")
		}
	case "boost_config":
		var cfg BoostConfig
		if err := json.Unmarshal(val, &cfg); err != nil {
			return fmt.Errorf("invalid boost_config schema: %w", err)
		}
		if cfg.PriceCents < 0 || cfg.DurationMinutes < 1 || cfg.MaxRadiusKm < 1 {
			return fmt.Errorf("invalid boost parameter bounds")
		}
	case "affiliate_config":
		var cfg AffiliateConfig
		if err := json.Unmarshal(val, &cfg); err != nil {
			return fmt.Errorf("invalid affiliate_config schema: %w", err)
		}
		if cfg.Mode != "REVSHARE_PERCENT" && cfg.Mode != "CPA_FIXED" {
			return fmt.Errorf("affiliate mode must be REVSHARE_PERCENT or CPA_FIXED")
		}
	}

	return s.repo.Set(ctx, key, val, updatedBy)
}

func (s *Service) GetAdvertisingConfig(ctx context.Context) (*AdvertisingConfig, error) {
	raw, err := s.repo.Get(ctx, "advertising")
	if err != nil {
		return &AdvertisingConfig{
			SwipeFeedAdInterval:  11,
			RewardedAdEnabled:    true,
			BannerEnabled:        true,
			AdFrequencyCapHourly: 6,
		}, nil
	}
	var cfg AdvertisingConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (s *Service) GetLikesRevealConfig(ctx context.Context) (*LikesRevealConfig, error) {
	raw, err := s.repo.Get(ctx, "likes_reveals")
	if err != nil {
		return &LikesRevealConfig{
			FreeRevealsCount: 1,
			RevealsPerAd:     2,
			CooldownHours:    4,
			DailyRevealLimit: 10,
			PremiumUnlimited: true,
		}, nil
	}
	var cfg LikesRevealConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (s *Service) GetBoostConfig(ctx context.Context) (*BoostConfig, error) {
	raw, err := s.repo.Get(ctx, "boost_config")
	if err != nil {
		return &BoostConfig{
			PriceCents:      500,
			DurationMinutes: 60,
			MaxRadiusKm:     200,
			Multiplier:      2.5,
			IsActive:        true,
		}, nil
	}
	var cfg BoostConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (s *Service) GetAffiliateConfig(ctx context.Context) (*AffiliateConfig, error) {
	raw, err := s.repo.Get(ctx, "affiliate_config")
	if err != nil {
		return &AffiliateConfig{
			Mode:                   "REVSHARE_PERCENT",
			DefaultCPACents:        3500,
			DefaultRevshareBps:     2500,
			MinimumPayoutCents:     5000,
			ManualApprovalRequired: true,
			FirstPaymentOnly:       false,
			MaxQualifyingRenewals:  12,
			EscrowHoldDays:         30,
		}, nil
	}
	var cfg AffiliateConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (s *Service) GetSupportRoutingConfig(ctx context.Context) (*SupportRoutingConfig, error) {
	raw, err := s.repo.Get(ctx, "support_routing")
	if err != nil {
		return &SupportRoutingConfig{
			DefaultStrategy: "WORKLOAD",
			AutoAssign:      true,
			EscalationHours: 24,
		}, nil
	}
	var cfg SupportRoutingConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
