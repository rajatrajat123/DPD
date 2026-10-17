package configmgr_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/auradating/platform/backend/internal/configmgr"
)

func TestConfigManager_GetAndSet(t *testing.T) {
	ctx := context.Background()
	repo := configmgr.NewMemoryRepository()
	svc := configmgr.NewService(repo)

	// Retrieve default likes_reveals config
	val, err := svc.GetConfig(ctx, "likes_reveals")
	if err != nil {
		t.Fatalf("expected likes_reveals to be seeded, got error: %v", err)
	}

	var likesCfg configmgr.LikesRevealConfig
	if err := json.Unmarshal(val, &likesCfg); err != nil {
		t.Fatalf("failed to unmarshal likes reveal config: %v", err)
	}
	if likesCfg.RevealsPerAd != 2 {
		t.Errorf("expected default 2 reveals per ad, got %d", likesCfg.RevealsPerAd)
	}
	if likesCfg.CooldownHours != 4 {
		t.Errorf("expected default 4 hours cooldown, got %d", likesCfg.CooldownHours)
	}

	// Update advertising config
	newAdCfg := configmgr.AdvertisingConfig{
		SwipeFeedAdInterval:  12,
		RewardedAdEnabled:    true,
		BannerEnabled:        false,
		AdFrequencyCapHourly: 5,
	}
	newBytes, _ := json.Marshal(newAdCfg)
	adminID := "superadmin-1"

	err = svc.UpdateConfig(ctx, "advertising", newBytes, &adminID)
	if err != nil {
		t.Fatalf("failed to update advertising config: %v", err)
	}

	// Verify updated value
	updatedVal, err := svc.GetConfig(ctx, "advertising")
	if err != nil {
		t.Fatalf("failed to get updated advertising config: %v", err)
	}

	var parsedAd configmgr.AdvertisingConfig
	if err := json.Unmarshal(updatedVal, &parsedAd); err != nil {
		t.Fatalf("failed to unmarshal updated config: %v", err)
	}
	if parsedAd.SwipeFeedAdInterval != 12 {
		t.Errorf("expected interval 12, got %d", parsedAd.SwipeFeedAdInterval)
	}

	// Verify GetAllConfigs includes all categories
	all, err := svc.GetAllConfigs(ctx)
	if err != nil {
		t.Fatalf("failed to get all configs: %v", err)
	}
	if len(all) < 6 {
		t.Errorf("expected at least 6 platform configurations, got %d", len(all))
	}
}
