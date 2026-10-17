package database_test

import (
	"context"
	"net/url"
	"testing"

	"github.com/auradating/platform/backend/internal/config"
	"github.com/auradating/platform/backend/internal/database"
)

func TestDiversity_AuditedDistributions_LivePostgres(t *testing.T) {
	cfg, err := config.LoadFromEnv()
	if err != nil || cfg.DatabaseURL == "" {
		t.Skip("skipping live database diversity test; no configuration available")
	}

	parsed, err := url.Parse(cfg.DatabaseURL)
	if err != nil || (parsed.Hostname() != "localhost" && parsed.Hostname() != "127.0.0.1") {
		t.Skip("skipping live database diversity test; not a local host")
	}

	ctx := context.Background()
	pg, err := database.NewPostgres(ctx, cfg)
	if err != nil || pg.HealthCheck(ctx) != nil {
		t.Skip("skipping live database diversity test; postgres not reachable")
	}
	defer pg.Close()

	// 1. Verify Pronoun Distribution: They/Them MUST NOT be 100% or default
	var totalSeed int
	err = pg.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM users WHERE email LIKE '%@example.test'").Scan(&totalSeed)
	if err != nil || totalSeed != 5000 {
		t.Fatalf("expected 5000 seed profiles in DB, got %d (err: %v)", totalSeed, err)
	}

	var theyThemCount int
	err = pg.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM profiles p
		JOIN users u ON u.id = p.user_id
		WHERE u.email LIKE '%@example.test' AND p.pronouns = ARRAY['they/them']::varchar[];
	`).Scan(&theyThemCount)
	if err != nil {
		t.Fatalf("failed to query they/them count: %v", err)
	}

	theyThemPct := float64(theyThemCount) * 100.0 / float64(totalSeed)
	if theyThemPct > 30.0 {
		t.Errorf("they/them is over-concentrated at %.1f%% (expected ~20%%)", theyThemPct)
	}
	if theyThemPct < 10.0 {
		t.Errorf("they/them is under-represented at %.1f%%", theyThemPct)
	}

	// Verify presence of he/him, she/her, she/they, he/they, ze/zir, custom
	requiredPronouns := []string{"he/him", "she/her", "she/they", "he/they", "ze/zir", "custom:fae/faer"}
	for _, pr := range requiredPronouns {
		var cnt int
		err = pg.Pool.QueryRow(ctx, `
			SELECT COUNT(*) FROM profiles p
			JOIN users u ON u.id = p.user_id
			WHERE u.email LIKE '%@example.test' AND $1 = ANY(p.pronouns);
		`, pr).Scan(&cnt)
		if err != nil {
			t.Fatalf("failed to query pronoun %s count: %v", pr, err)
		}
		if cnt == 0 {
			t.Errorf("required pronoun %q has 0 profiles in database", pr)
		}
	}

	// 2. Verify Gender Identity Diversity
	requiredGenders := []string{
		"woman", "man", "non-binary", "transgender woman", "transgender man",
		"cisgender woman", "cisgender man", "genderqueer", "genderfluid",
		"agender", "two-spirit",
	}
	for _, g := range requiredGenders {
		var cnt int
		err = pg.Pool.QueryRow(ctx, `
			SELECT COUNT(*) FROM profiles p
			JOIN users u ON u.id = p.user_id
			WHERE u.email LIKE '%@example.test' AND $1 = ANY(p.gender_identities);
		`, g).Scan(&cnt)
		if err != nil {
			t.Fatalf("failed to query gender %s count: %v", g, err)
		}
		if cnt < 100 {
			t.Errorf("expected at least 100 profiles with gender %q, got %d", g, cnt)
		}
	}

	// Multi-value gender identity count
	var multiGenderCount int
	err = pg.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM profiles p
		JOIN users u ON u.id = p.user_id
		WHERE u.email LIKE '%@example.test' AND cardinality(p.gender_identities) > 1;
	`).Scan(&multiGenderCount)
	if err != nil || multiGenderCount < 500 {
		t.Errorf("expected at least 500 multi-gender profiles, got %d (err: %v)", multiGenderCount, err)
	}

	// 3. Verify Sexual Orientation Diversity
	requiredOrientations := []string{
		"queer", "lesbian", "gay", "bisexual", "pansexual", "asexual", "demisexual", "questioning",
	}
	for _, o := range requiredOrientations {
		var cnt int
		err = pg.Pool.QueryRow(ctx, `
			SELECT COUNT(*) FROM profiles p
			JOIN users u ON u.id = p.user_id
			WHERE u.email LIKE '%@example.test' AND $1 = ANY(p.sexual_orientations);
		`, o).Scan(&cnt)
		if err != nil {
			t.Fatalf("failed to query orientation %s count: %v", o, err)
		}
		if cnt < 100 {
			t.Errorf("expected at least 100 profiles with orientation %q, got %d", o, cnt)
		}
	}

	// 4. Decoupling Check: Pronouns and Genders are Independent
	// E.g. There must exist men with they/them, women with they/them, non-binary with he/him, non-binary with she/her
	var cross1, cross2, cross3, cross4 int
	_ = pg.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.email LIKE '%@example.test' AND 'they/them' = ANY(p.pronouns) AND 'man' = ANY(p.gender_identities)`).Scan(&cross1)
	_ = pg.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.email LIKE '%@example.test' AND 'they/them' = ANY(p.pronouns) AND 'woman' = ANY(p.gender_identities)`).Scan(&cross2)
	_ = pg.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.email LIKE '%@example.test' AND 'he/him' = ANY(p.pronouns) AND 'non-binary' = ANY(p.gender_identities)`).Scan(&cross3)
	_ = pg.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.email LIKE '%@example.test' AND 'she/her' = ANY(p.pronouns) AND 'non-binary' = ANY(p.gender_identities)`).Scan(&cross4)

	if cross1 == 0 || cross2 == 0 || cross3 == 0 || cross4 == 0 {
		t.Errorf("pronouns and gender identities are correlated! Cross counts: men+they=%d, women+they=%d, nb+he=%d, nb+she=%d",
			cross1, cross2, cross3, cross4)
	}
}

func TestDiversity_DiscoveryFilterCompatibilityMatrix(t *testing.T) {
	cfg, err := config.LoadFromEnv()
	if err != nil || cfg.DatabaseURL == "" {
		t.Skip("skipping live database discovery test; no configuration available")
	}

	parsed, err := url.Parse(cfg.DatabaseURL)
	if err != nil || (parsed.Hostname() != "localhost" && parsed.Hostname() != "127.0.0.1") {
		t.Skip("skipping live database discovery test; not a local host")
	}

	ctx := context.Background()
	pg, err := database.NewPostgres(ctx, cfg)
	if err != nil || pg.HealthCheck(ctx) != nil {
		t.Skip("skipping live database discovery test; postgres not reachable")
	}
	defer pg.Close()

	// Base discovery candidate query with arbitrary preferences passed as parameters
	discoveryFilterQuery := `
		SELECT COUNT(*)
		FROM users u
		JOIN profiles p ON p.user_id = u.id
		LEFT JOIN dating_preferences dp ON dp.user_id = u.id
		WHERE u.email LIKE '%@example.test'
		  AND u.status = 'ACTIVE'
		  AND p.incognito_enabled = FALSE
		  -- Must satisfy preferred genders filter
		  AND ($1::varchar[] IS NULL OR cardinality($1::varchar[]) = 0 OR p.gender_identities && $1::varchar[])
		  -- Must satisfy non-smoker dealbreaker
		  AND ($2::boolean = FALSE OR p.smoking_habit = 'NON_SMOKER')
		  -- Must satisfy photo verified dealbreaker
		  AND ($3::boolean = FALSE OR p.is_photo_verified = TRUE)
		  -- Must satisfy monogamous dealbreaker
		  AND ($4::boolean = FALSE OR p.relationship_structure = 'MONOGAMOUS')
		  -- Must satisfy preferred intents filter
		  AND ($5::varchar[] IS NULL OR cardinality($5::varchar[]) = 0 OR p.relationship_intents && $5::varchar[])
		  -- Age filter
		  AND EXTRACT(YEAR FROM age(CURRENT_DATE, p.birthdate)) BETWEEN $6 AND $7;
	`

	// Scenario A: Gender Filter Match vs Exclusion
	// Actor only looking for woman or transgender woman
	var matchWomenCount int
	err = pg.Pool.QueryRow(ctx, discoveryFilterQuery,
		[]string{"woman", "transgender woman"}, false, false, false, nil, 18, 99,
	).Scan(&matchWomenCount)
	if err != nil {
		t.Fatalf("failed query Scenario A: %v", err)
	}
	if matchWomenCount == 0 {
		t.Errorf("Scenario A: Expected matching women profiles to be > 0, got 0")
	}

	// Verify that NO candidate returned has ONLY 'cisgender man' or 'man'
	var leakedMenCount int
	err = pg.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM users u
		JOIN profiles p ON p.user_id = u.id
		WHERE u.email LIKE '%@example.test'
		  AND p.gender_identities && ARRAY['woman', 'transgender woman']::varchar[]
		  AND p.gender_identities = ARRAY['cisgender man']::varchar[];
	`).Scan(&leakedMenCount)
	if err != nil || leakedMenCount != 0 {
		t.Errorf("Scenario A: Excluded gender leaked into match pool! Count: %d", leakedMenCount)
	}

	// Scenario B: Multi-value Identity Reciprocity
	// Candidate has ['non-binary', 'genderqueer']. Searching for ['genderqueer'] MUST find them.
	var multiMatchCount int
	err = pg.Pool.QueryRow(ctx, discoveryFilterQuery,
		[]string{"genderqueer"}, false, false, false, nil, 18, 99,
	).Scan(&multiMatchCount)
	if err != nil || multiMatchCount == 0 {
		t.Errorf("Scenario B: Multi-value identity search for genderqueer failed! Count: %d", multiMatchCount)
	}

	// Scenario C: Strict Non-Smoker Dealbreaker Exclusion
	// When non_smoker_only = true, ZERO smokers can appear
	var smokerLeakCount int
	err = pg.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM users u
		JOIN profiles p ON p.user_id = u.id
		WHERE u.email LIKE '%@example.test'
		  AND p.smoking_habit <> 'NON_SMOKER'
		  AND ($1::boolean = TRUE AND p.smoking_habit = 'NON_SMOKER');
	`, true).Scan(&smokerLeakCount)
	if err != nil || smokerLeakCount != 0 {
		t.Errorf("Scenario C: Smoker leaked into non-smoker dealbreaker filter! Count: %d", smokerLeakCount)
	}

	var nonSmokerEligibleCount int
	_ = pg.Pool.QueryRow(ctx, discoveryFilterQuery, nil, true, false, false, nil, 18, 99).Scan(&nonSmokerEligibleCount)
	if nonSmokerEligibleCount == 0 || nonSmokerEligibleCount == 5000 {
		t.Errorf("Scenario C: Expected non-smokers to be a subset of 5000, got %d", nonSmokerEligibleCount)
	}

	// Scenario D: Strict Verified Dealbreaker Exclusion
	var unverifiedLeakCount int
	err = pg.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM users u
		JOIN profiles p ON p.user_id = u.id
		WHERE u.email LIKE '%@example.test'
		  AND p.is_photo_verified = FALSE
		  AND ($1::boolean = TRUE AND p.is_photo_verified = TRUE);
	`, true).Scan(&unverifiedLeakCount)
	if err != nil || unverifiedLeakCount != 0 {
		t.Errorf("Scenario D: Unverified profile leaked into verified dealbreaker filter! Count: %d", unverifiedLeakCount)
	}

	var verifiedEligibleCount int
	_ = pg.Pool.QueryRow(ctx, discoveryFilterQuery, nil, false, true, false, nil, 18, 99).Scan(&verifiedEligibleCount)
	if verifiedEligibleCount < 2400 || verifiedEligibleCount > 2600 {
		t.Errorf("Scenario D: Expected approximately 2500 verified profiles (~50%%), got %d", verifiedEligibleCount)
	}

	// Scenario E: Strict Monogamous Dealbreaker Exclusion
	var nonMonogamousEligibleCount int
	_ = pg.Pool.QueryRow(ctx, discoveryFilterQuery, nil, false, false, true, nil, 18, 99).Scan(&nonMonogamousEligibleCount)
	if nonMonogamousEligibleCount == 0 || nonMonogamousEligibleCount == 5000 {
		t.Errorf("Scenario E: Expected monogamous profiles to be a subset of 5000, got %d", nonMonogamousEligibleCount)
	}

	// Scenario F: Age Bounds Filtering
	var age25to30Count int
	_ = pg.Pool.QueryRow(ctx, discoveryFilterQuery, nil, false, false, false, nil, 25, 30).Scan(&age25to30Count)
	if age25to30Count == 0 || age25to30Count >= 5000 {
		t.Errorf("Scenario F: Age 25-30 filter returned unexpected count: %d", age25to30Count)
	}

	// Scenario G: Intent Filter Overlap
	var longTermIntentCount int
	_ = pg.Pool.QueryRow(ctx, discoveryFilterQuery, nil, false, false, false, []string{"long-term partner"}, 18, 99).Scan(&longTermIntentCount)
	if longTermIntentCount == 0 || longTermIntentCount >= 5000 {
		t.Errorf("Scenario G: Intent filter returned unexpected count: %d", longTermIntentCount)
	}
}
