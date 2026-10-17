package database

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"log/slog"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/auradating/platform/backend/internal/config"
	"github.com/auradating/platform/backend/internal/media"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// Exactly 5,000 synthetic profiles for local development testing
	TotalSeedProfiles = 5000
	SeedEmailDomain   = "example.test"
	SeedMarkerTag     = "seed-profile-aura-dev"
)

// SeedStats tracks the outcome of the seed operation
type SeedStats struct {
	TargetCount    int   `json:"target_count"`
	ExistingCount  int   `json:"existing_count"`
	CreatedCount   int   `json:"created_count"`
	ReusedCount    int   `json:"reused_count"`
	SkippedCount   int   `json:"skipped_count"`
	EligibleCount  int   `json:"eligible_count"`
	NonSeedCount   int   `json:"non_seed_count"`
	DurationMs     int64 `json:"duration_ms"`
}

// Valid tiny 1x1 WebP binary fixture (lossless, transparent 1x1 WebP)
// Base64: UklGRkAAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAIAAAAAAFZQOCAYAAAAMAEAnQEqAQABAA/A/iWAA/AAE+21gAA=
var tinyWebPBytes, _ = base64.StdEncoding.DecodeString("UklGRkAAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAIAAAAAAFZQOCAYAAAAMAEAnQEqAQABAA/A/iWAA/AAE+21gAA=")

// ValidateDevEnvironment guards against running seed operations outside local development
func ValidateDevEnvironment(cfg *config.Config) error {
	if cfg == nil {
		return fmt.Errorf("config cannot be nil")
	}
	if cfg.Environment != config.EnvDevelopment {
		return fmt.Errorf("SAFETY BLOCKER: seeder refused to run in non-development environment: %q", cfg.Environment)
	}

	parsed, err := url.Parse(cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("invalid DATABASE_URL: %w", err)
	}

	host := strings.ToLower(parsed.Hostname())
	isLocal := host == "localhost" || host == "127.0.0.1" || host == "::1" || host == ""
	if !isLocal {
		return fmt.Errorf("SAFETY BLOCKER: seeder refused: database host %q is not local development", host)
	}

	dbName := strings.TrimPrefix(parsed.Path, "/")
	if !strings.Contains(dbName, "aura") && !strings.Contains(dbName, "test") && !strings.Contains(dbName, "dev") {
		return fmt.Errorf("SAFETY BLOCKER: seeder refused: database name %q does not match dev/test criteria", dbName)
	}

	return nil
}

// EnsureSeedFixturesOnDisk creates the physical WebP fixture files so streaming endpoints return 200 OK with valid portrait visuals.
func EnsureSeedFixturesOnDisk(mediaStorageDir string) error {
	resolvedDir := mediaStorageDir
	if strings.TrimSpace(resolvedDir) == "" {
		resolvedDir = "data/media"
	}

	// Make sure resolvedDir is absolute
	if !filepath.IsAbs(resolvedDir) {
		abs, err := filepath.Abs(resolvedDir)
		if err == nil {
			resolvedDir = abs
		}
	}

	fixturesDir := filepath.Join(resolvedDir, "derivatives", "aura-media-approved", "seed_fixtures")
	if err := os.MkdirAll(fixturesDir, 0755); err != nil {
		return fmt.Errorf("failed to create seed fixtures directory: %w", err)
	}

	fixtures := map[string][]byte{
		"thumb_webp.webp": media.GenerateTestWebP(160, 160),
		"card_webp.webp":  media.GenerateTestWebP(640, 800),
		"full_webp.webp":  media.GenerateTestWebP(640, 800),
	}

	for name, data := range fixtures {
		targetPath := filepath.Join(fixturesDir, name)
		stat, err := os.Stat(targetPath)
		if os.IsNotExist(err) || (err == nil && stat.Size() < 500) {
			if err := os.WriteFile(targetPath, data, 0644); err != nil {
				return fmt.Errorf("failed to write seed fixture %s: %w", targetPath, err)
			}
		}
	}

	return nil
}

// Deterministic UUID generators
func SeedUserID(index int) string {
	return fmt.Sprintf("00000000-0000-4000-8000-%012d", index)
}

func SeedMediaAssetID(userIndex, photoIndex int) string {
	return fmt.Sprintf("00000000-0001-4000-8000-%012d", (userIndex*10)+photoIndex)
}

func SeedMediaDerivativeID(userIndex, photoIndex, variantIndex int) string {
	return fmt.Sprintf("00000000-0002-4000-8000-%012d", (userIndex*100)+(photoIndex*10)+variantIndex)
}

func SeedEmail(index int) string {
	return fmt.Sprintf("seed_%05d@%s", index, SeedEmailDomain)
}

// SeedDevProfiles idempotently creates exactly 5,000 synthetic eligible profiles
func SeedDevProfiles(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, logger *slog.Logger) (*SeedStats, error) {
	startTime := time.Now()

	// 1. Safety check
	if err := ValidateDevEnvironment(cfg); err != nil {
		return nil, err
	}

	// 2. Ensure physical fixtures exist on disk for local media serving
	if err := EnsureSeedFixturesOnDisk(cfg.MediaStorageDir); err != nil {
		if logger != nil {
			logger.Warn("could_not_write_seed_fixtures_on_disk", slog.String("error", err.Error()))
		}
	}

	stats := &SeedStats{
		TargetCount: TotalSeedProfiles,
	}

	// 3. Count non-seed accounts to ensure they are preserved
	var nonSeedCount int
	err := pool.QueryRow(ctx, "SELECT COUNT(*) FROM users WHERE email NOT LIKE '%@"+SeedEmailDomain+"'").Scan(&nonSeedCount)
	if err != nil {
		return nil, fmt.Errorf("failed to count non-seed users: %w", err)
	}
	stats.NonSeedCount = nonSeedCount

	// 4. Count existing seed profiles
	var existingSeedCount int
	err = pool.QueryRow(ctx, "SELECT COUNT(*) FROM users WHERE email LIKE '%@"+SeedEmailDomain+"'").Scan(&existingSeedCount)
	if err != nil {
		return nil, fmt.Errorf("failed to count existing seed users: %w", err)
	}
	stats.ExistingCount = existingSeedCount

	// If exactly 5,000 seed profiles already exist, verify media and eligibility without duplicating
	if existingSeedCount >= TotalSeedProfiles {
		stats.ReusedCount = existingSeedCount
		stats.CreatedCount = 0

		// Verify eligibility count
		var eligibleCount int
		elQuery := `
			SELECT COUNT(DISTINCT u.id)
			FROM users u
			JOIN profiles p ON p.user_id = u.id
			WHERE u.email LIKE '%@` + SeedEmailDomain + `'
			  AND u.status = 'ACTIVE'
			  AND p.incognito_enabled = FALSE
			  AND EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate)) >= 18
			  AND (
				  SELECT COUNT(*) FROM media_assets ma 
				  WHERE ma.owner_user_id = u.id 
				    AND ma.purpose = 'PROFILE_GALLERY' 
				    AND ma.status = 'READY' 
				    AND ma.moderation_verdict = 'APPROVED'
			  ) >= 3;
		`
		_ = pool.QueryRow(ctx, elQuery).Scan(&eligibleCount)
		stats.EligibleCount = eligibleCount
		stats.DurationMs = time.Since(startTime).Milliseconds()
		return stats, nil
	}

	// 5. Seed synthetic records in batches of 500 for high performance
	batchSize := 500
	totalBatches := (TotalSeedProfiles + batchSize - 1) / batchSize

	firstNames := []string{
		"River", "Jordan", "Alex", "Sam", "Taylor", "Morgan", "Casey", "Riley",
		"Robin", "Avery", "Jamie", "Skyler", "Dakota", "Quinn", "Reese", "Harper",
		"Finley", "Rowan", "Sawyer", "Hayden", "Kai", "Sage", "Charlie", "Eden",
		"Elliott", "Phoenix", "Jesse", "Emerson", "Kendall", "Shiloh", "Ari",
		"Cameron", "Drew", "Frankie", "Logan", "Micah", "Nico", "Peyton", "Remy",
	}

	lastNames := []string{
		"Chen", "Martinez", "Lee", "Patel", "Diaz", "Kim", "Brooks", "Washington",
		"Garcia", "Vance", "Ross", "Harper", "Bennett", "Ellis", "Taylor", "Miller",
		"Davis", "Wilson", "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin",
	}

	genderTaxonomies := [][]string{
		{"non_binary"},
		{"cisgender_woman"},
		{"transgender_woman"},
		{"cisgender_man"},
		{"transgender_man"},
		{"genderqueer"},
		{"non_binary", "genderqueer"},
		{"two_spirit"},
		{"agender"},
	}

	sexualOrientations := [][]string{
		{"queer"},
		{"lesbian"},
		{"gay"},
		{"pansexual"},
		{"bisexual"},
		{"asexual"},
	}

	relationshipIntents := [][]string{
		{"long_term"},
		{"dating"},
		{"friendship"},
		{"casual"},
		{"long_term", "dating"},
	}

	structures := []string{"MONOGAMOUS", "MONOGAMOUS", "MONOGAMOUS", "ENM", "POLYAMOROUS", "OPEN", "EXPLORING"}
	smokingHabits := []string{"NON_SMOKER", "NON_SMOKER", "NON_SMOKER", "NON_SMOKER", "SOCIAL_SMOKER"}
	drinkingHabits := []string{"SOCIALLY", "SOCIALLY", "NEVER", "SOBER"}

	// Metro anchor coordinates (New York, Berlin, San Francisco, London, Chicago, Austin)
	metroHubs := [][2]float64{
		{40.7128, -74.0060}, // New York
		{52.5200, 13.4050},  // Berlin
		{37.7749, -122.4194},// San Francisco
		{51.5074, -0.1278},  // London
		{41.8781, -87.6298}, // Chicago
		{30.2672, -97.7431}, // Austin
	}

	// Universal bcrypt hash for test password: 'Password123!Secure'
	defaultPasswordHash := "$2a$12$e80gS7vE71.jPqg8oV6B.uW8yZf/1N0.fVwWkZzV7jG7rK7uK8qO6"

	createdUsers := 0

	for b := 0; b < totalBatches; b++ {
		startIdx := (b * batchSize) + 1
		endIdx := (b + 1) * batchSize
		if endIdx > TotalSeedProfiles {
			endIdx = TotalSeedProfiles
		}

		tx, err := pool.Begin(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to begin tx for batch %d: %w", b, err)
		}

		for i := startIdx; i <= endIdx; i++ {
			userID := SeedUserID(i)
			email := SeedEmail(i)
			name := fmt.Sprintf("%s %s", firstNames[i%len(firstNames)], lastNames[(i*7)%len(lastNames)])

			// 1. Insert user
			userQuery := `
				INSERT INTO users (id, email, password_hash, status, role, email_verified_at, created_at, updated_at)
				VALUES ($1, $2, $3, 'ACTIVE', 'MEMBER', NOW(), NOW() - INTERVAL '10 days', NOW())
				ON CONFLICT (id) DO NOTHING;
			`
			tag, err := tx.Exec(ctx, userQuery, userID, email, defaultPasswordHash)
			if err != nil {
				_ = tx.Rollback(ctx)
				return nil, fmt.Errorf("insert user %s: %w", userID, err)
			}
			if tag.RowsAffected() > 0 {
				createdUsers++
			}

			// 2. Insert profile
			age := 18 + (i % 34) // 18 to 51
			birthdate := time.Now().UTC().AddDate(-age, -((i*3)%12), -((i*5)%28))
			genders := genderTaxonomies[i%len(genderTaxonomies)]
			orientations := sexualOrientations[(i*3)%len(sexualOrientations)]
			intents := relationshipIntents[(i*5)%len(relationshipIntents)]
			structure := structures[i%len(structures)]
			smoking := smokingHabits[i%len(smokingHabits)]
			drinking := drinkingHabits[i%len(drinkingHabits)]
			isPhotoVerified := (i%2 == 0)

			bio := fmt.Sprintf("Hi, I'm %s. Queer creative exploring local coffee, community art, and good conversation. (%s)", name, SeedMarkerTag)
			heightCm := 155 + (i % 40)
			weightKg := 50 + (i % 45)

			profileQuery := `
				INSERT INTO profiles (
					user_id, display_name, birthdate, bio, pronouns, gender_identities,
					sexual_orientations, relationship_intents, relationship_structure,
					visibility_settings, is_photo_verified, discrete_mode_enabled,
					incognito_enabled, smoking_habit, drinking_habit, height_cm, weight_kg, created_at, updated_at
				) VALUES (
					$1, $2, $3, $4, $5, $6,
					$7, $8, $9,
					'{"pronouns":"PUBLIC","gender_identity":"PUBLIC","sexual_orientation":"PUBLIC","height":"PUBLIC","weight":"PUBLIC"}',
					$10, FALSE, FALSE, $11, $12, $13, $14, NOW(), NOW()
				)
				ON CONFLICT (user_id) DO UPDATE SET
					display_name = EXCLUDED.display_name,
					bio = EXCLUDED.bio,
					is_photo_verified = EXCLUDED.is_photo_verified,
					smoking_habit = EXCLUDED.smoking_habit,
					drinking_habit = EXCLUDED.drinking_habit,
					height_cm = EXCLUDED.height_cm,
					weight_kg = EXCLUDED.weight_kg;
			`
			_, err = tx.Exec(ctx, profileQuery,
				userID, name, birthdate, bio, []string{"they/them"}, genders,
				orientations, intents, structure, isPhotoVerified, smoking, drinking,
				heightCm, weightKg,
			)
			if err != nil {
				_ = tx.Rollback(ctx)
				return nil, fmt.Errorf("insert profile %s: %w", userID, err)
			}

			// 3. Insert profile location
			metro := metroHubs[i%len(metroHubs)]
			// Add deterministic jitter within ~1-30km
			latJitter := (math.Sin(float64(i)) * 0.15)
			lonJitter := (math.Cos(float64(i)) * 0.15)
			lat := metro[0] + latJitter
			lon := metro[1] + lonJitter

			locQuery := `
				INSERT INTO profile_locations (user_id, coordinates, city_name, country_code, updated_at)
				VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 'Metro Area', 'US', NOW())
				ON CONFLICT (user_id) DO UPDATE SET
					coordinates = EXCLUDED.coordinates,
					updated_at = NOW();
			`
			_, err = tx.Exec(ctx, locQuery, userID, lon, lat)
			if err != nil {
				_ = tx.Rollback(ctx)
				return nil, fmt.Errorf("insert location %s: %w", userID, err)
			}

			// 4. Insert dating preferences (inclusive reciprocal filtering)
			prefQuery := `
				INSERT INTO dating_preferences (
					user_id, min_age, max_age, max_distance_km, preferred_genders,
					preferred_intents, verified_profiles_only, dealbreakers, updated_at
				) VALUES (
					$1, 18, 99, 100,
					ARRAY['non_binary','cisgender_woman','transgender_woman','cisgender_man','transgender_man','genderqueer','all','everyone'],
					ARRAY['long_term','dating','friendship','casual'],
					FALSE,
					'{"non_smoker_only":false,"require_verified":false,"require_monogamous":false}',
					NOW()
				)
				ON CONFLICT (user_id) DO UPDATE SET
					preferred_genders = EXCLUDED.preferred_genders,
					dealbreakers = EXCLUDED.dealbreakers;
			`
			_, err = tx.Exec(ctx, prefQuery, userID)
			if err != nil {
				_ = tx.Rollback(ctx)
				return nil, fmt.Errorf("insert preferences %s: %w", userID, err)
			}

			// 5. Insert exactly 3 approved public media assets + derivatives per user (satisfying Discovery threshold >= 3)
			for photoIdx := 0; photoIdx < 3; photoIdx++ {
				assetID := SeedMediaAssetID(i, photoIdx)
				idemKey := fmt.Sprintf("seed-asset-%05d-%d", i, photoIdx)
				hash := fmt.Sprintf("%x", sha256.Sum256([]byte(idemKey)))

				assetQuery := `
					INSERT INTO media_assets (
						id, owner_user_id, media_type, purpose, status, quarantine_bucket,
						quarantine_key, original_sha256, original_mime, original_size_bytes,
						width_px, height_px, exif_stripped, moderation_verdict, display_order,
						idempotency_key, created_at, updated_at
					) VALUES (
						$1, $2, 'IMAGE', 'PROFILE_GALLERY', 'READY', 'aura-quarantine',
						$3, $4, 'image/webp', 30, 100, 100, TRUE, 'APPROVED', $5,
						$6, NOW(), NOW()
					)
					ON CONFLICT (idempotency_key) DO UPDATE SET
						status = 'READY',
						moderation_verdict = 'APPROVED';
				`
				_, err = tx.Exec(ctx, assetQuery,
					assetID, userID, "seed_quarantine/"+assetID, hash, photoIdx, idemKey,
				)
				if err != nil {
					_ = tx.Rollback(ctx)
					return nil, fmt.Errorf("insert media asset %s: %w", assetID, err)
				}

				// Derivatives: THUMB_WEBP, CARD_WEBP, FULL_WEBP
				variants := []struct {
					code string
					file string
					idx  int
				}{
					{"THUMB_WEBP", "seed_fixtures/thumb_webp.webp", 1},
					{"CARD_WEBP", "seed_fixtures/card_webp.webp", 2},
					{"FULL_WEBP", "seed_fixtures/full_webp.webp", 3},
				}

				for _, v := range variants {
					derivID := SeedMediaDerivativeID(i, photoIdx, v.idx)
					derivQuery := `
						INSERT INTO media_derivatives (
							id, media_asset_id, variant, storage_bucket, storage_key,
							mime_type, size_bytes, width_px, height_px, created_at
						) VALUES (
							$1, $2, $3, 'aura-media-approved', $4,
							'image/webp', 30, 100, 100, NOW()
						)
						ON CONFLICT (media_asset_id, variant) DO UPDATE SET
							storage_key = EXCLUDED.storage_key;
					`
					_, err = tx.Exec(ctx, derivQuery, derivID, assetID, v.code, v.file)
					if err != nil {
						_ = tx.Rollback(ctx)
						return nil, fmt.Errorf("insert derivative %s: %w", derivID, err)
					}
				}
			}

			// 6. If verified, create an approved age assurance record
			if isPhotoVerified {
				sessionID := fmt.Sprintf("00000000-0003-4000-8000-%012d", i)
				provSessionID := fmt.Sprintf("seed-prov-session-%05d", i)
				sessionQuery := `
					INSERT INTO age_assurances (
						id, user_id, provider, provider_session_id, status, verified_at, created_at, updated_at
					) VALUES (
						$1, $2, 'STRIPE_IDENTITY', $3, 'VERIFIED', NOW(), NOW(), NOW()
					)
					ON CONFLICT (user_id) DO NOTHING;
				`
				if _, err := tx.Exec(ctx, sessionQuery, sessionID, userID, provSessionID); err != nil {
					_ = tx.Rollback(ctx)
					return nil, fmt.Errorf("insert age assurance %s: %w", sessionID, err)
				}
			}
		}

		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("failed to commit batch %d: %w", b, err)
		}

		if logger != nil && (b+1)%2 == 0 {
			logger.Info("seeding_progress",
				slog.Int("completed_profiles", endIdx),
				slog.Int("total_target", TotalSeedProfiles),
				slog.Int("batch", b+1),
				slog.Int("total_batches", totalBatches),
			)
		}
	}

	// 6. Compute final counts
	var finalSeedCount int
	_ = pool.QueryRow(ctx, "SELECT COUNT(*) FROM users WHERE email LIKE '%@"+SeedEmailDomain+"'").Scan(&finalSeedCount)
	stats.ReusedCount = existingSeedCount
	stats.CreatedCount = finalSeedCount - existingSeedCount

	var eligibleCount int
	elQuery := `
		SELECT COUNT(DISTINCT u.id)
		FROM users u
		JOIN profiles p ON p.user_id = u.id
		WHERE u.email LIKE '%@` + SeedEmailDomain + `'
		  AND u.status = 'ACTIVE'
		  AND p.incognito_enabled = FALSE
		  AND EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate)) >= 18
		  AND (
			  SELECT COUNT(*) FROM media_assets ma 
			  WHERE ma.owner_user_id = u.id 
			    AND ma.purpose = 'PROFILE_GALLERY' 
			    AND ma.status = 'READY' 
			    AND ma.moderation_verdict = 'APPROVED'
		  ) >= 3;
	`
	_ = pool.QueryRow(ctx, elQuery).Scan(&eligibleCount)
	stats.EligibleCount = eligibleCount
	stats.DurationMs = time.Since(startTime).Milliseconds()

	return stats, nil
}
