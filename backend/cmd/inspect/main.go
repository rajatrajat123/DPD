package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/auradating/platform/backend/internal/config"
	"github.com/auradating/platform/backend/internal/database"
	"github.com/auradating/platform/backend/internal/identity"
)

func main() {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	// 1. Verify Local Database
	parsed, err := url.Parse(cfg.DatabaseURL)
	if err != nil {
		fmt.Printf("Invalid DATABASE_URL: %v\n", err)
		os.Exit(1)
	}
	host := parsed.Hostname()
	if host != "localhost" && host != "127.0.0.1" {
		fmt.Printf("REFUSING to run: Database host %q is not local!\n", host)
		os.Exit(1)
	}
	fmt.Printf("[1] Database Confirmed Local: host=%s, db=%s\n", host, parsed.Path)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	pg, err := database.NewPostgres(ctx, cfg)
	if err != nil {
		fmt.Printf("Error connecting to postgres: %v\n", err)
		os.Exit(1)
	}
	defer pg.Close()

	// 2. Query exact counts
	var seedUsers, nonSeedUsers, totalProfiles, totalPrefs int
	var totalMedia, readyApprovedMedia, totalDerivatives int

	_ = pg.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM users WHERE email LIKE '%@example.test'").Scan(&seedUsers)
	_ = pg.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM users WHERE email NOT LIKE '%@example.test'").Scan(&nonSeedUsers)
	_ = pg.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM profiles").Scan(&totalProfiles)
	_ = pg.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM dating_preferences").Scan(&totalPrefs)
	_ = pg.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM media_assets WHERE purpose = 'PROFILE_GALLERY'").Scan(&totalMedia)
	_ = pg.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM media_assets WHERE purpose = 'PROFILE_GALLERY' AND status = 'READY' AND moderation_verdict = 'APPROVED'").Scan(&readyApprovedMedia)
	_ = pg.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM media_derivatives").Scan(&totalDerivatives)

	fmt.Println("\n=== [2] DATABASE COUNTS ===")
	fmt.Printf("Seed-owned Users:            %d\n", seedUsers)
	fmt.Printf("Non-seed Users:              %d\n", nonSeedUsers)
	fmt.Printf("Total Profiles:              %d\n", totalProfiles)
	fmt.Printf("Total Dating Preferences:    %d\n", totalPrefs)
	fmt.Printf("Total Gallery Media Assets:  %d\n", totalMedia)
	fmt.Printf("READY/APPROVED Gallery Media: %d\n", readyApprovedMedia)
	fmt.Printf("Total Media Derivatives:     %d\n", totalDerivatives)

	// 3. Inspect recent non-seed users to identify the phone user
	fmt.Println("\n=== [3] RECENT NON-SEED ACCOUNTS ===")
	rows, err := pg.Pool.Query(ctx, `
		SELECT u.id, u.email, u.status, u.role, u.created_at,
		       p.display_name, p.birthdate, p.incognito_enabled, p.is_photo_verified,
		       COALESCE(ST_Y(pl.coordinates::geometry), 0) AS lat,
		       COALESCE(ST_X(pl.coordinates::geometry), 0) AS lon,
		       COALESCE(dp.min_age, 18), COALESCE(dp.max_age, 100), COALESCE(dp.max_distance_km, 100),
		       COALESCE((SELECT COUNT(*) FROM swipes s WHERE s.actor_user_id = u.id), 0) AS swipe_count
		FROM users u
		LEFT JOIN profiles p ON p.user_id = u.id
		LEFT JOIN profile_locations pl ON pl.user_id = u.id
		LEFT JOIN dating_preferences dp ON dp.user_id = u.id
		WHERE u.email NOT LIKE '%@example.test'
		ORDER BY u.created_at DESC
		LIMIT 10;
	`)
	if err != nil {
		fmt.Printf("Error querying non-seed users: %v\n", err)
		return
	}
	defer rows.Close()

	type NonSeedUser struct {
		ID            string
		Email         string
		Status        string
		Role          string
		CreatedAt     time.Time
		DisplayName   *string
		Birthdate     *time.Time
		Incognito     *bool
		PhotoVerified *bool
		Lat, Lon      float64
		MinAge        int
		MaxAge        int
		MaxDistKm     int
		SwipeCount    int
	}

	var nonSeedList []NonSeedUser
	for rows.Next() {
		var u NonSeedUser
		if err := rows.Scan(
			&u.ID, &u.Email, &u.Status, &u.Role, &u.CreatedAt,
			&u.DisplayName, &u.Birthdate, &u.Incognito, &u.PhotoVerified,
			&u.Lat, &u.Lon, &u.MinAge, &u.MaxAge, &u.MaxDistKm, &u.SwipeCount,
		); err != nil {
			fmt.Printf("Error scanning row: %v\n", err)
			continue
		}
		nonSeedList = append(nonSeedList, u)
		name := "<none>"
		if u.DisplayName != nil {
			name = *u.DisplayName
		}
		// Mask email for privacy (e.g. j***n@domain.com)
		maskedEmail := u.Email
		if len(u.Email) > 4 {
			maskedEmail = u.Email[:2] + "***" + u.Email[len(u.Email)-4:]
		}
		fmt.Printf("- User ID: %s | Masked: %s | Name: %s | Created: %s | Lat: %.4f, Lon: %.4f | DistKm: %d | Swipes: %d\n",
			u.ID, maskedEmail, name, u.CreatedAt.Format("2006-01-02 15:04"), u.Lat, u.Lon, u.MaxDistKm, u.SwipeCount)
	}

	// 4. Inspect the target phone user (c3a4f70a-b403-459a-8fcf-09ca1ff6e05f)
	if len(nonSeedList) > 0 {
		target := nonSeedList[0]
		for _, u := range nonSeedList {
			if u.ID == "c3a4f70a-b403-459a-8fcf-09ca1ff6e05f" {
				target = u
				break
			}
		}
		fmt.Printf("\n=== [4] ELIGIBILITY BREAKDOWN FOR USER %s (%s, Lat: %.4f, Lon: %.4f, MaxDist: %d km) ===\n",
			target.ID, target.Email, target.Lat, target.Lon, target.MaxDistKm)
		var minAge, maxAge, maxDist int
		var genders []string
		var dealbreakers []byte
		var verifiedOnly bool
		_ = pg.Pool.QueryRow(ctx, "SELECT min_age, max_age, max_distance_km, preferred_genders, dealbreakers, verified_profiles_only FROM dating_preferences WHERE user_id = $1", target.ID).Scan(&minAge, &maxAge, &maxDist, &genders, &dealbreakers, &verifiedOnly)
		fmt.Printf("User Preferences in DB: minAge=%d, maxAge=%d, maxDist=%d, genders=%v, dealbreakers=%s, verifiedOnly=%v\n", minAge, maxAge, maxDist, genders, string(dealbreakers), verifiedOnly)

			// Total seed profiles
			var countTotalSeed int
			_ = pg.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM users WHERE email LIKE '%@example.test'").Scan(&countTotalSeed)

			// Exclusion 1: Photos >= 3
			var countWithPhotos int
			_ = pg.Pool.QueryRow(ctx, `
				SELECT COUNT(DISTINCT u.id) FROM users u
				JOIN profiles p ON p.user_id = u.id
				WHERE u.email LIKE '%@example.test'
				  AND (SELECT COUNT(*) FROM media_assets ma WHERE ma.owner_user_id = u.id AND ma.purpose = 'PROFILE_GALLERY' AND ma.status = 'READY' AND ma.moderation_verdict = 'APPROVED') >= 3
			`).Scan(&countWithPhotos)

			// Exclusion 2: Age within actor bounds
			var countAgeMatch int
			_ = pg.Pool.QueryRow(ctx, `
				SELECT COUNT(DISTINCT u.id) FROM users u
				JOIN profiles p ON p.user_id = u.id
				LEFT JOIN dating_preferences dp ON dp.user_id = u.id
				WHERE u.email LIKE '%@example.test'
				  AND EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate)) BETWEEN $1 AND $2
				  AND (SELECT EXTRACT(YEAR FROM age(CURRENT_DATE, birthdate))::INT FROM profiles WHERE user_id = $3) BETWEEN COALESCE(dp.min_age, 18) AND COALESCE(dp.max_age, 100)
			`, target.MinAge, target.MaxAge, target.ID).Scan(&countAgeMatch)

			// Exclusion 3: Distance within actor's max_distance_km
			var countDistanceMatch int
			_ = pg.Pool.QueryRow(ctx, `
				WITH actor_loc AS (
					SELECT coordinates FROM profile_locations WHERE user_id = $1
				)
				SELECT COUNT(DISTINCT u.id) FROM users u
				JOIN profile_locations pl ON pl.user_id = u.id
				CROSS JOIN actor_loc al
				WHERE u.email LIKE '%@example.test'
				  AND (al.coordinates IS NULL OR pl.coordinates IS NULL OR ST_DWithin(al.coordinates, pl.coordinates, $2 * 1000.0))
			`, target.ID, target.MaxDistKm).Scan(&countDistanceMatch)

			// Exclusion 4: Swipes (already swiped)
			var countSwiped int
			_ = pg.Pool.QueryRow(ctx, `
				SELECT COUNT(*) FROM swipes s
				JOIN users u ON u.id = s.target_user_id
				WHERE s.actor_user_id = $1 AND u.email LIKE '%@example.test' AND s.undone_at IS NULL
			`, target.ID).Scan(&countSwiped)

			// Combined Discovery Query: exact match
			var countEligible int
			elQuery := `
				WITH actor_info AS (
					SELECT
						p.user_id,
						p.birthdate,
						EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate))::INT AS age,
						p.gender_identities,
						p.sexual_orientations,
						p.relationship_intents,
						p.relationship_structure,
						p.smoking_habit,
						p.drinking_habit,
						COALESCE(dp.min_age, 18) AS min_age,
						COALESCE(dp.max_age, 100) AS max_age,
						COALESCE(dp.max_distance_km, 100) AS max_distance_km,
						dp.preferred_genders,
						COALESCE(dp.verified_profiles_only, false) AS verified_profiles_only,
						COALESCE((dp.dealbreakers->>'non_smoker_only')::boolean, false) AS non_smoker_only,
						COALESCE((dp.dealbreakers->>'require_verified')::boolean, false) AS require_verified,
						COALESCE((dp.dealbreakers->>'require_monogamous')::boolean, false) AS require_monogamous,
						pl.coordinates AS actor_coords
					FROM profiles p
					LEFT JOIN dating_preferences dp ON dp.user_id = p.user_id
					LEFT JOIN profile_locations pl ON pl.user_id = p.user_id
					WHERE p.user_id = $1
				)
				SELECT COUNT(DISTINCT u.id)
				FROM users u
				JOIN profiles p ON p.user_id = u.id
				LEFT JOIN dating_preferences dp ON dp.user_id = u.id
				LEFT JOIN profile_locations pl ON pl.user_id = u.id
				CROSS JOIN actor_info a
				WHERE u.id <> a.user_id
				  AND u.status = 'ACTIVE'
				  AND p.incognito_enabled = FALSE
				  AND (
					  SELECT COUNT(*)
					  FROM media_assets ma
					  WHERE ma.owner_user_id = u.id
						AND ma.purpose = 'PROFILE_GALLERY'
						AND ma.status = 'READY'
						AND ma.moderation_verdict = 'APPROVED'
				  ) >= 3
				  AND EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate)) >= 18
				  AND EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate)) BETWEEN a.min_age AND a.max_age
				  AND a.age BETWEEN COALESCE(dp.min_age, 18) AND COALESCE(dp.max_age, 100)
				  AND (a.actor_coords IS NULL OR pl.coordinates IS NULL OR ST_DWithin(a.actor_coords, pl.coordinates, a.max_distance_km * 1000.0))
				  AND NOT EXISTS (
					  SELECT 1 FROM swipes s
					  WHERE s.actor_user_id = a.user_id AND s.target_user_id = u.id AND s.undone_at IS NULL
				  )
				  AND NOT EXISTS (
					  SELECT 1 FROM user_blocks b
					  WHERE (b.blocker_user_id = a.user_id AND b.blocked_user_id = u.id)
						 OR (b.blocker_user_id = u.id AND b.blocked_user_id = a.user_id)
				  )
				  AND (
					  ((a.verified_profiles_only = FALSE AND a.require_verified = FALSE) OR p.is_photo_verified = TRUE)
					  AND
					  ((COALESCE(dp.verified_profiles_only, false) = FALSE AND COALESCE((dp.dealbreakers->>'require_verified')::boolean, false) = FALSE) OR (SELECT is_photo_verified FROM profiles WHERE user_id = a.user_id) = TRUE)
				  )
				  AND (
					  (a.non_smoker_only = FALSE OR p.smoking_habit = 'NON_SMOKER' OR p.smoking_habit = '')
					  AND
					  (COALESCE((dp.dealbreakers->>'non_smoker_only')::boolean, false) = FALSE OR a.smoking_habit = 'NON_SMOKER' OR a.smoking_habit = '')
				  )
				  AND (
					  (a.require_monogamous = FALSE OR p.relationship_structure = 'MONOGAMOUS' OR p.relationship_structure = '')
					  AND
					  (COALESCE((dp.dealbreakers->>'require_monogamous')::boolean, false) = FALSE OR a.relationship_structure = 'MONOGAMOUS' OR a.relationship_structure = '')
				  );
			`
			_ = pg.Pool.QueryRow(ctx, elQuery, target.ID).Scan(&countEligible)

			fmt.Printf("Seed Profiles Total:                   %d\n", countTotalSeed)
			fmt.Printf("Passes Photos Criteria (>=3):          %d\n", countWithPhotos)
			fmt.Printf("Passes Age Reciprocity:                %d\n", countAgeMatch)
			fmt.Printf("Passes Distance Radius (<= %d km):      %d\n", target.MaxDistKm, countDistanceMatch)
			fmt.Printf("Already Swiped (Excluded):             %d\n", countSwiped)
			fmt.Printf("FINAL ELIGIBLE CANDIDATES IN FEED:     %d\n", countEligible)

			// Check the 16 swipes
			fmt.Println("\nSwipes made by user c3a4f70a-b403-459a-8fcf-09ca1ff6e05f:")
			sRows, _ := pg.Pool.Query(ctx, `
				SELECT s.target_user_id, s.direction, s.created_at, u.email, p.display_name
				FROM swipes s
				LEFT JOIN users u ON u.id = s.target_user_id
				LEFT JOIN profiles p ON p.user_id = s.target_user_id
				WHERE s.actor_user_id = $1 AND s.undone_at IS NULL
				ORDER BY s.created_at DESC;
			`, target.ID)
			for sRows.Next() {
				var tid, dir, em, dn string
				var cat time.Time
				_ = sRows.Scan(&tid, &dir, &cat, &em, &dn)
				fmt.Printf("  Swiped %s on: %s (%s, %s)\n", dir, dn, em, tid)
			}
			sRows.Close()

			// 5. Test Live HTTP API call for user c3a4f70a-b403-459a-8fcf-09ca1ff6e05f
			identUser := &identity.User{
				ID:     target.ID,
				Email:  target.Email,
				Status: identity.UserStatus(target.Status),
				Role:   identity.UserRole(target.Role),
			}
			token, err := identity.GenerateAccessToken(cfg.JWTSigningSecret, identUser, 1*time.Hour)
			if err != nil {
				fmt.Printf("Error generating token: %v\n", err)
				return
			}
			fmt.Printf("\nGenerated Token for phone user %s: %s...\n", target.ID, token[:15])

			// Call GET /api/v1/discovery/feed
			req, _ := http.NewRequestWithContext(ctx, "GET", "http://127.0.0.1:8080/api/v1/discovery/feed", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				fmt.Printf("HTTP GET /api/v1/discovery/feed failed: %v\n", err)
				return
			}
			defer resp.Body.Close()

			var feedResp struct {
				Candidates []struct {
					UserID      string `json:"user_id"`
					DisplayName string `json:"display_name"`
					Photos      []any  `json:"photos"`
				} `json:"candidates"`
				EmptyReason string `json:"empty_state_reason"`
				Count       int    `json:"count"`
				NextCursor  string `json:"next_cursor"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&feedResp); err != nil {
				fmt.Printf("Failed to decode feed response: %v\n", err)
				return
			}
			fmt.Printf("\n=== [5] LIVE HTTP API FEED RESPONSE (BATCH 1) ===\n")
			fmt.Printf("HTTP Status: %d\n", resp.StatusCode)
			fmt.Printf("Candidates Count: %d, NextCursor: %s, EmptyReason: %q\n", len(feedResp.Candidates), feedResp.NextCursor, feedResp.EmptyReason)
			for idx, c := range feedResp.Candidates {
				fmt.Printf("  [%d] %s (%s), Photos: %d\n", idx+1, c.DisplayName, c.UserID, len(c.Photos))
			}

			// Batch 2 testing
			if feedResp.NextCursor != "" {
				fmt.Printf("\n=== [5B] FETCHING BATCH 2 WITH CURSOR ===\n")
				b2Req, _ := http.NewRequestWithContext(ctx, "GET", "http://127.0.0.1:8080/api/v1/discovery/feed?limit=20&cursor="+url.QueryEscape(feedResp.NextCursor), nil)
				b2Req.Header.Set("Authorization", "Bearer "+token)
				b2Resp, err := http.DefaultClient.Do(b2Req)
				if err != nil {
					fmt.Printf("Batch 2 request failed: %v\n", err)
				} else {
					var feedResp2 struct {
						Candidates []struct {
							UserID      string `json:"user_id"`
							DisplayName string `json:"display_name"`
							Photos      []any  `json:"photos"`
						} `json:"candidates"`
						NextCursor string `json:"next_cursor"`
					}
					_ = json.NewDecoder(b2Resp.Body).Decode(&feedResp2)
					b2Resp.Body.Close()
					fmt.Printf("Batch 2 Status: %d, Count: %d, NextCursor: %s\n", b2Resp.StatusCode, len(feedResp2.Candidates), feedResp2.NextCursor)
					if len(feedResp2.Candidates) > 0 {
						fmt.Printf("  Batch 2 First: %s (%s)\n", feedResp2.Candidates[0].DisplayName, feedResp2.Candidates[0].UserID)
						fmt.Printf("  Batch 2 Last:  %s (%s)\n", feedResp2.Candidates[len(feedResp2.Candidates)-1].DisplayName, feedResp2.Candidates[len(feedResp2.Candidates)-1].UserID)
					}

					// Batch 3 testing
					if feedResp2.NextCursor != "" {
						fmt.Printf("\n=== [5C] FETCHING BATCH 3 WITH CURSOR ===\n")
						b3Req, _ := http.NewRequestWithContext(ctx, "GET", "http://127.0.0.1:8080/api/v1/discovery/feed?limit=20&cursor="+url.QueryEscape(feedResp2.NextCursor), nil)
						b3Req.Header.Set("Authorization", "Bearer "+token)
						b3Resp, err := http.DefaultClient.Do(b3Req)
						if err != nil {
							fmt.Printf("Batch 3 request failed: %v\n", err)
						} else {
							var feedResp3 struct {
								Candidates []struct {
									UserID      string `json:"user_id"`
									DisplayName string `json:"display_name"`
									Photos      []any  `json:"photos"`
								} `json:"candidates"`
								NextCursor string `json:"next_cursor"`
							}
							_ = json.NewDecoder(b3Resp.Body).Decode(&feedResp3)
							b3Resp.Body.Close()
							fmt.Printf("Batch 3 Status: %d, Count: %d, NextCursor: %s\n", b3Resp.StatusCode, len(feedResp3.Candidates), feedResp3.NextCursor)
							if len(feedResp3.Candidates) > 0 {
								fmt.Printf("  Batch 3 First: %s (%s)\n", feedResp3.Candidates[0].DisplayName, feedResp3.Candidates[0].UserID)
								fmt.Printf("  Batch 3 Last:  %s (%s)\n", feedResp3.Candidates[len(feedResp3.Candidates)-1].DisplayName, feedResp3.Candidates[len(feedResp3.Candidates)-1].UserID)
							}
						}
					}
				}
			}

			// 6. Test GET /api/v1/profiles/{id} endpoint
			if len(feedResp.Candidates) > 0 {
				firstCand := feedResp.Candidates[0]
				fmt.Printf("\n=== [6] TESTING GET /api/v1/profiles/%s ===\n", firstCand.UserID)
				profReq, _ := http.NewRequestWithContext(ctx, "GET", "http://127.0.0.1:8080/api/v1/profiles/"+firstCand.UserID, nil)
				profReq.Header.Set("Authorization", "Bearer "+token)
				profResp, err := http.DefaultClient.Do(profReq)
				if err != nil {
					fmt.Printf("GetPublicProfile request failed: %v\n", err)
				} else {
					fmt.Printf("GetPublicProfile HTTP Status: %d\n", profResp.StatusCode)
					var pData map[string]any
					_ = json.NewDecoder(profResp.Body).Decode(&pData)
					profResp.Body.Close()
					fmt.Printf("  Display Name: %v\n", pData["display_name"])
					fmt.Printf("  Age:          %v\n", pData["age"])
					fmt.Printf("  Bio:          %v\n", pData["bio"])
					fmt.Printf("  Verified:     %v\n", pData["is_photo_verified"])
					fmt.Printf("  Distance Km:  %v\n", pData["approximate_distance_km"])
					if photos, ok := pData["photos"].([]any); ok {
						fmt.Printf("  Photos Count: %d\n", len(photos))
					}
					// Ensure private fields are NOT present
					if _, hasEmail := pData["email"]; hasEmail {
						fmt.Printf("  ERROR: email field leaked in public profile!\n")
					} else {
						fmt.Printf("  Privacy: email NOT exposed (Clean)\n")
					}
					if _, hasPhone := pData["phone"]; hasPhone {
						fmt.Printf("  ERROR: phone field leaked in public profile!\n")
					} else {
						fmt.Printf("  Privacy: phone NOT exposed (Clean)\n")
					}
				}
			}
	}
}
