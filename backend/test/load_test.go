package test

import (
	"context"
	"fmt"
	"math/rand"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/billing"
	"github.com/auradating/platform/backend/internal/discovery"
	"github.com/auradating/platform/backend/internal/events"
	"github.com/auradating/platform/backend/internal/identity"
)

// calculateLatencyMetrics returns p50, p95, and p99 from a slice of durations.
func calculateLatencyMetrics(durations []time.Duration) (p50, p95, p99, max time.Duration) {
	if len(durations) == 0 {
		return 0, 0, 0, 0
	}
	sorted := make([]time.Duration, len(durations))
	copy(sorted, durations)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })

	p50 = sorted[int(float64(len(sorted))*0.50)]
	p95 = sorted[int(float64(len(sorted))*0.95)]
	p99 = sorted[int(float64(len(sorted))*0.99)]
	max = sorted[len(sorted)-1]
	return
}

func setupBenchmarkEnvironment() (*discovery.Service, *discovery.MemoryRepository, *identity.MemoryRepository) {
	identRepo := identity.NewMemoryRepository()
	discoRepo := discovery.NewMemoryRepository(identRepo)
	discoSvc := discovery.NewService(discoRepo, identRepo, nil, nil)

	ctx := context.Background()

	// Seed 100 synthetic profiles across gender spectrum
	genders := [][]string{
		{"GAY", "QUEER"},
		{"LESBIAN"},
		{"BISEXUAL", "NON_BINARY"},
		{"TRANSGENDER", "QUEER"},
	}

	for i := 1; i <= 100; i++ {
		uid := fmt.Sprintf("bench_user_%03d", i)
		g := genders[i%len(genders)]
		_ = identRepo.UpsertProfile(ctx, &identity.Profile{
			UserID:                uid,
			DisplayName:           fmt.Sprintf("Member %03d", i),
			Birthdate:             time.Now().UTC().AddDate(-25, 0, 0),
			GenderIdentities:      g,
			RelationshipStructure: identity.StructureMonogamous,
			SmokingHabit:          identity.SmokingNonSmoker,
			IsPhotoVerified:       true,
		})
		_ = identRepo.UpsertPreferences(ctx, &identity.DatingPreferences{
			UserID:           uid,
			MinAge:           20,
			MaxAge:           35,
			MaxDistanceKm:    50,
			PreferredGenders: g,
			Dealbreakers: identity.LifestyleDealbreakers{
				NonSmokerOnly:     true,
				RequireMonogamous: true,
				RequireVerified:   true,
			},
		})
		_ = identRepo.UpsertLocation(ctx, &identity.ProfileLocation{
			UserID:      uid,
			Latitude:    40.7128 + (rand.Float64()-0.5)*0.1,
			Longitude:   -74.0060 + (rand.Float64()-0.5)*0.1,
			CityName:    "New York",
			CountryCode: "US",
			UpdatedAt:   time.Now().UTC(),
		})
	}

	return discoSvc, discoRepo, identRepo
}

func TestLoad_ConcurrentDiscoveryFeed(t *testing.T) {
	discoSvc, _, _ := setupBenchmarkEnvironment()
	ctx := context.Background()

	const concurrency = 20
	const iterationsPerWorker = 50
	totalRequests := concurrency * iterationsPerWorker

	var wg sync.WaitGroup
	durations := make([]time.Duration, totalRequests)
	var errCount int64

	start := time.Now()

	for workerID := 0; workerID < concurrency; workerID++ {
		wg.Add(1)
		go func(wID int) {
			defer wg.Done()
			actorID := fmt.Sprintf("bench_user_%03d", (wID%20)+1)

			for iter := 0; iter < iterationsPerWorker; iter++ {
				idx := wID*iterationsPerWorker + iter
				reqStart := time.Now()

				resp, err := discoSvc.GetDiscoveryFeed(ctx, actorID, "", 20)
				durations[idx] = time.Since(reqStart)

				if err != nil || resp == nil {
					atomic.AddInt64(&errCount, 1)
				}
			}
		}(workerID)
	}

	wg.Wait()
	elapsed := time.Since(start)

	p50, p95, p99, maxDur := calculateLatencyMetrics(durations)
	rps := float64(totalRequests) / elapsed.Seconds()

	t.Logf("=== Load Test: Discovery Feed (%d requests, concurrency %d) ===", totalRequests, concurrency)
	t.Logf("Elapsed: %v | RPS: %.2f req/sec", elapsed, rps)
	t.Logf("Latency: p50=%v | p95=%v | p99=%v | max=%v", p50, p95, p99, maxDur)
	t.Logf("Error Rate: %.2f%% (%d failed)", float64(errCount)/float64(totalRequests)*100, errCount)

	if errCount > 0 {
		t.Fatalf("expected 0 errors under load, got %d", errCount)
	}
	if p95 > 50*time.Millisecond {
		t.Errorf("p95 latency threshold exceeded: %v > 50ms", p95)
	}
}

func TestLoad_AtomicSwipeQuotaUnderLoad(t *testing.T) {
	discoSvc, discoRepo, _ := setupBenchmarkEnvironment()
	ctx := context.Background()

	actorID := "load_actor_quota_tester"
	discoRepo.SetDailyLikeQuota(10)

	const totalAttempts = 50
	var wg sync.WaitGroup
	var successLikes int64
	var quotaRejections int64
	var otherErrors int64

	for i := 0; i < totalAttempts; i++ {
		wg.Add(1)
		targetID := fmt.Sprintf("target_user_%03d", i+1)

		go func(tID string) {
			defer wg.Done()
			_, err := discoSvc.Swipe(ctx, actorID, discovery.SwipeRequest{
				TargetUserID: tID,
				Direction:    "LIKE",
			}, fmt.Sprintf("corr-%s", tID))

			if err == nil {
				atomic.AddInt64(&successLikes, 1)
			} else if err == discovery.ErrSwipeLimitReached {
				atomic.AddInt64(&quotaRejections, 1)
			} else {
				atomic.AddInt64(&otherErrors, 1)
			}
		}(targetID)
	}

	wg.Wait()

	t.Logf("=== Load Test: Atomic Swipe Quota Concurrency (50 parallel likes) ===")
	t.Logf("Successful Likes: %d / 10 | Quota Rejections: %d / 40 | Other Errors: %d", successLikes, quotaRejections, otherErrors)

	if successLikes != 10 {
		t.Fatalf("CRITICAL RACE CONDITION: expected exactly 10 successful likes, got %d", successLikes)
	}
	if quotaRejections != 40 {
		t.Fatalf("expected exactly 40 rejected likes, got %d", quotaRejections)
	}
	if otherErrors > 0 {
		t.Fatalf("unexpected errors occurred: %d", otherErrors)
	}

	// Verify that PASS action remains unlimited even after 40 rejections
	passResp, err := discoSvc.Swipe(ctx, actorID, discovery.SwipeRequest{
		TargetUserID: "pass_candidate_999",
		Direction:    "PASS",
	}, "corr-pass-unlimited")

	if err != nil || passResp == nil {
		t.Fatalf("PASS swipe must remain permitted even when quota is exhausted: %v", err)
	}
	t.Log("Verified: PASS swipe succeeded without consuming like quota.")
}

func TestLoad_WebhookIdempotencyUnderLoad(t *testing.T) {
	repo := billing.NewMemoryRepository()
	ctx := context.Background()

	const concurrentDeliveries = 50
	duplicateEventID := "evt_concurrent_charge_refunded_1001"
	eventPayload := []byte(fmt.Sprintf(`{"id":%q,"type":"charge.refunded","data":{"object":{"id":"ch_123","customer":"cus_123"}}}`, duplicateEventID))

	var wg sync.WaitGroup
	var processedCount int64
	var duplicateCount int64

	for i := 0; i < concurrentDeliveries; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			isDuplicate, err := repo.RecordWebhookEvent(ctx, duplicateEventID, billing.ProviderStripe, "charge.refunded", eventPayload)
			if err != nil {
				return
			}
			if !isDuplicate {
				atomic.AddInt64(&processedCount, 1)
			} else {
				atomic.AddInt64(&duplicateCount, 1)
			}
		}()
	}

	wg.Wait()

	t.Logf("=== Resilience Test: Webhook Idempotency (50 concurrent deliveries) ===")
	t.Logf("Processed: %d | Ignored Duplicates: %d", processedCount, duplicateCount)

	if processedCount != 1 {
		t.Fatalf("expected exactly 1 webhook processing event, got %d", processedCount)
	}
	if duplicateCount != 49 {
		t.Fatalf("expected exactly 49 duplicate rejections, got %d", duplicateCount)
	}
}

func TestResilience_TransactionalOutboxDeduplication(t *testing.T) {
	repo := billing.NewMemoryRepository()
	ctx := context.Background()

	const eventCount = 100
	var wg sync.WaitGroup

	for i := 0; i < eventCount; i++ {
		wg.Add(1)
		evtID := fmt.Sprintf("evt_outbox_%04d", i)
		go func(id string) {
			defer wg.Done()
			env, _ := events.NewEnvelope("billing_tx", id, "billing.transaction.created.v1", "corr-123", 1, map[string]string{"id": id})
			_ = repo.PublishOutboxEvent(ctx, env)
		}(evtID)
	}

	wg.Wait()

	eventsList := repo.GetOutboxEvents()

	t.Logf("=== Resilience Test: Outbox Concurrency (100 parallel events) ===")
	t.Logf("Recorded Events: %d / 100", len(eventsList))

	if len(eventsList) != 100 {
		t.Fatalf("expected exactly 100 recorded outbox events, got %d", len(eventsList))
	}
}

func TestLoad_LiveHTTPThroughput(t *testing.T) {
	_, ts, _ := setupTestServer(t)

	transport := &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 100,
		IdleConnTimeout:     90 * time.Second,
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   5 * time.Second,
	}

	const concurrency = 25
	const iterationsPerWorker = 20
	totalRequests := concurrency * iterationsPerWorker

	durations := make([]time.Duration, totalRequests)
	var errCount int64
	var wg sync.WaitGroup

	endpoints := []string{
		ts.URL + "/healthz",
		ts.URL + "/api/v1/billing/plans",
		ts.URL + "/api/v1/billing/policy?platform=web",
	}

	start := time.Now()

	for workerID := 0; workerID < concurrency; workerID++ {
		wg.Add(1)
		go func(wID int) {
			defer wg.Done()
			for iter := 0; iter < iterationsPerWorker; iter++ {
				idx := wID*iterationsPerWorker + iter
				endpoint := endpoints[(wID+iter)%len(endpoints)]

				reqStart := time.Now()
				resp, err := client.Get(endpoint)
				durations[idx] = time.Since(reqStart)

				if err != nil {
					atomic.AddInt64(&errCount, 1)
					continue
				}
				if resp.StatusCode != http.StatusOK {
					atomic.AddInt64(&errCount, 1)
				}
				resp.Body.Close()
			}
		}(workerID)
	}

	wg.Wait()
	elapsed := time.Since(start)

	p50, p95, p99, maxDur := calculateLatencyMetrics(durations)
	rps := float64(totalRequests) / elapsed.Seconds()

	t.Logf("=== Real HTTP Load Test Metrics (Live TCP Loopback) ===")
	t.Logf("Requests: %d | Concurrency: %d | Elapsed: %v", totalRequests, concurrency, elapsed)
	t.Logf("Throughput: %.2f requests/sec (RPS)", rps)
	t.Logf("Latency Distribution: p50=%v | p95=%v | p99=%v | max=%v", p50, p95, p99, maxDur)
	t.Logf("HTTP Errors: %d / %d (%.2f%%)", errCount, totalRequests, float64(errCount)/float64(totalRequests)*100)

	if errCount > 0 {
		t.Fatalf("expected 0 HTTP errors under load, got %d", errCount)
	}
	if p95 > 250*time.Millisecond {
		t.Errorf("HTTP p95 latency threshold exceeded: %v > 250ms", p95)
	}
}

