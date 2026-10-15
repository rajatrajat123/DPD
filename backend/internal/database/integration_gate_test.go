package database_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/config"
	"github.com/auradating/platform/backend/internal/database"
	"github.com/auradating/platform/backend/migrations"
	"github.com/jackc/pgx/v5/pgtype"
)

func getTestDatabaseURL() string {
	_, _ = config.LoadFromEnv()
	if url := os.Getenv("TEST_DATABASE_URL"); url != "" {
		return url
	}
	return os.Getenv("DATABASE_URL")
}

func TestPostgres_IntegrationGate(t *testing.T) {
	dbURL := getTestDatabaseURL()
	if dbURL == "" {
		t.Skip("Skipping PostgreSQL integration gate test: Neither TEST_DATABASE_URL nor DATABASE_URL is configured.")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	cfg, err := config.Load(func(k string) string {
		switch k {
		case "DATABASE_URL":
			return dbURL
		case "APP_ENV":
			return "development"
		case "JWT_SIGNING_SECRET":
			return "local-dev-only-jwt-signing-secret-must-be-changed-32b"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatalf("failed to create test config: %v", err)
	}

	// 1. Establish connection pool
	pg, err := database.NewPostgres(ctx, cfg)
	if err != nil {
		t.Fatalf("failed to initialize postgres pool: %v", err)
	}
	defer pg.Close()

	if err := pg.HealthCheck(ctx); err != nil {
		t.Fatalf("database healthcheck failed: %v", err)
	}

	// 2. Validate real PostGIS is present and functional
	pgVersion, err := pg.CheckPostGIS(ctx)
	if err != nil {
		t.Fatalf("PostGIS verification failed: %v", err)
	}
	t.Logf("PostGIS verified successfully on live PostgreSQL: %s", pgVersion)

	// 3. Apply all embedded migrations (000001 through 000012)
	store := database.NewPgxMigrationStore(pg.Pool)
	migrator, err := database.NewMigrator(migrations.FS, store)
	if err != nil {
		t.Fatalf("failed to create migrator: %v", err)
	}

	appliedCount, err := migrator.Up(ctx)
	if err != nil {
		t.Fatalf("migrator.Up failed: %v", err)
	}
	t.Logf("Migrations successfully applied: %d", appliedCount)

	// 4. Verify all migrations report APPLIED status
	statuses, err := migrator.Status(ctx)
	if err != nil {
		t.Fatalf("failed to retrieve migration status: %v", err)
	}
	if len(statuses) != 12 {
		t.Fatalf("expected 12 migration status records, got %d", len(statuses))
	}
	for _, st := range statuses {
		if !st.Applied || st.AppliedAt == nil {
			t.Fatalf("expected migration %06d_%s to be APPLIED, got unapplied", st.Version, st.Name)
		}
		t.Logf("Verified migration %06d_%s: APPLIED at %s", st.Version, st.Name, st.AppliedAt.Format(time.RFC3339))
	}

	// 5. Representative integration flow with synthetic test accounts
	testRunID := time.Now().UnixNano()
	userAEmail := fmt.Sprintf("test_user_a_%d@auratest.internal", testRunID)
	userBEmail := fmt.Sprintf("test_user_b_%d@auratest.internal", testRunID)

	// 5a. Insert synthetic test accounts
	var userAID, userBID pgtype.UUID
	err = pg.Pool.QueryRow(ctx, `
		INSERT INTO users (email, role, status)
		VALUES ($1, 'MEMBER', 'ACTIVE')
		RETURNING id
	`, userAEmail).Scan(&userAID)
	if err != nil {
		t.Fatalf("failed to insert test user A: %v", err)
	}

	err = pg.Pool.QueryRow(ctx, `
		INSERT INTO users (email, role, status)
		VALUES ($1, 'MEMBER', 'ACTIVE')
		RETURNING id
	`, userBEmail).Scan(&userBID)
	if err != nil {
		t.Fatalf("failed to insert test user B: %v", err)
	}

	// 5b. Insert session
	var sessionID pgtype.UUID
	fakeHash := []byte(fmt.Sprintf("test_token_hash_%d", testRunID))
	err = pg.Pool.QueryRow(ctx, `
		INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at)
		VALUES ($1, $2, NOW() + INTERVAL '7 days')
		RETURNING id
	`, userAID, fakeHash).Scan(&sessionID)
	if err != nil {
		t.Fatalf("failed to insert user session: %v", err)
	}

	// 5c. Insert profiles & dating preferences
	_, err = pg.Pool.Exec(ctx, `
		INSERT INTO profiles (
			user_id, display_name, birthdate, bio, pronouns,
			gender_identities, sexual_orientations, relationship_intents, relationship_structure
		) VALUES (
			$1, 'Alex', '1995-06-15', 'Queer software engineer in SF', ARRAY['they/them'],
			ARRAY['NON_BINARY'], ARRAY['QUEER'], ARRAY['LONG_TERM'], 'MONOGAMOUS'
		)
	`, userAID)
	if err != nil {
		t.Fatalf("failed to insert profile for user A: %v", err)
	}

	_, err = pg.Pool.Exec(ctx, `
		INSERT INTO dating_preferences (
			user_id, min_age, max_age, max_distance_km, preferred_genders, preferred_intents
		) VALUES (
			$1, 21, 38, 50, ARRAY['NON_BINARY', 'TRANSGENDER', 'QUEER'], ARRAY['LONG_TERM']
		)
	`, userAID)
	if err != nil {
		t.Fatalf("failed to insert dating preferences for user A: %v", err)
	}

	_, err = pg.Pool.Exec(ctx, `
		INSERT INTO profiles (
			user_id, display_name, birthdate, bio, pronouns,
			gender_identities, sexual_orientations, relationship_intents, relationship_structure
		) VALUES (
			$1, 'Jordan', '1994-08-20', 'Artist and designer', ARRAY['she/her'],
			ARRAY['TRANSGENDER', 'WOMAN'], ARRAY['LESBIAN'], ARRAY['LONG_TERM'], 'MONOGAMOUS'
		)
	`, userBID)
	if err != nil {
		t.Fatalf("failed to insert profile for user B: %v", err)
	}

	// 5d. Insert PostGIS locations & query distance
	_, err = pg.Pool.Exec(ctx, `
		INSERT INTO profile_locations (user_id, coordinates, city_name, country_code)
		VALUES ($1, ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326), 'San Francisco', 'US')
	`, userAID)
	if err != nil {
		t.Fatalf("failed to insert location for user A: %v", err)
	}

	_, err = pg.Pool.Exec(ctx, `
		INSERT INTO profile_locations (user_id, coordinates, city_name, country_code)
		VALUES ($1, ST_SetSRID(ST_MakePoint(-122.4090, 37.7850), 4326), 'San Francisco', 'US')
	`, userBID)
	if err != nil {
		t.Fatalf("failed to insert location for user B: %v", err)
	}

	var distanceMeters float64
	err = pg.Pool.QueryRow(ctx, `
		SELECT ST_Distance(l1.coordinates, l2.coordinates)
		FROM profile_locations l1, profile_locations l2
		WHERE l1.user_id = $1 AND l2.user_id = $2
	`, userAID, userBID).Scan(&distanceMeters)
	if err != nil {
		t.Fatalf("failed to compute PostGIS distance: %v", err)
	}
	t.Logf("PostGIS calculated distance between test users: %.2f meters", distanceMeters)

	// 5e. Insert mutual swipe and match
	_, err = pg.Pool.Exec(ctx, `
		INSERT INTO swipes (actor_user_id, target_user_id, direction)
		VALUES ($1, $2, 'LIKE')
	`, userAID, userBID)
	if err != nil {
		t.Fatalf("failed to insert swipe A->B: %v", err)
	}

	_, err = pg.Pool.Exec(ctx, `
		INSERT INTO swipes (actor_user_id, target_user_id, direction)
		VALUES ($1, $2, 'LIKE')
	`, userBID, userAID)
	if err != nil {
		t.Fatalf("failed to insert swipe B->A: %v", err)
	}

	var matchID pgtype.UUID
	err = pg.Pool.QueryRow(ctx, `
		INSERT INTO matches (user_low_id, user_high_id, status)
		VALUES (
			LEAST($1::uuid, $2::uuid),
			GREATEST($1::uuid, $2::uuid),
			'ACTIVE'
		)
		RETURNING id
	`, userAID, userBID).Scan(&matchID)
	if err != nil {
		t.Fatalf("failed to insert mutual match: %v", err)
	}

	// 5f. Transactional outbox event
	var outboxID pgtype.UUID
	err = pg.Pool.QueryRow(ctx, `
		INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, status)
		VALUES ('MATCH', $1, 'match.created.v1', '{"notified": true}'::jsonb, 'PENDING')
		RETURNING id
	`, matchID).Scan(&outboxID)
	if err != nil {
		t.Fatalf("failed to write to transactional outbox: %v", err)
	}

	// 5g. Conversation and message
	var convID pgtype.UUID
	err = pg.Pool.QueryRow(ctx, `
		INSERT INTO conversations (match_id)
		VALUES ($1)
		RETURNING id
	`, matchID).Scan(&convID)
	if err != nil {
		t.Fatalf("failed to insert conversation: %v", err)
	}

	var messageID pgtype.UUID
	err = pg.Pool.QueryRow(ctx, `
		INSERT INTO messages (conversation_id, sender_user_id, client_message_id, body)
		VALUES ($1, $2, gen_random_uuid(), 'Hi! Nice to match with you.')
		RETURNING id
	`, convID, userAID).Scan(&messageID)
	if err != nil {
		t.Fatalf("failed to insert message: %v", err)
	}

	// 5h. Notification log
	var notifID pgtype.UUID
	err = pg.Pool.QueryRow(ctx, `
		INSERT INTO notification_logs (user_id, notification_type, channel, title, body_preview, status)
		VALUES ($1, 'NEW_MESSAGE', 'IN_APP', 'New Message', 'Hi! Nice to match with you.', 'DELIVERED')
		RETURNING id
	`, userBID).Scan(&notifID)
	if err != nil {
		t.Fatalf("failed to insert notification log: %v", err)
	}

	// 5i. Affiliate ledger entry
	var ledgerAccID, ledgerJournID, ledgerID pgtype.UUID
	err = pg.Pool.QueryRow(ctx, `
		INSERT INTO ledger_accounts (account_code, account_type, currency)
		VALUES ($1, 'ASSET', 'USD')
		RETURNING id
	`, fmt.Sprintf("acc_%d", testRunID)).Scan(&ledgerAccID)
	if err != nil {
		t.Fatalf("failed to insert ledger account: %v", err)
	}

	err = pg.Pool.QueryRow(ctx, `
		INSERT INTO ledger_journals (reference_type, reference_id, description, currency)
		VALUES ('COMMISSION_ACCRUAL', gen_random_uuid(), 'Integration test accrual', 'USD')
		RETURNING id
	`).Scan(&ledgerJournID)
	if err != nil {
		t.Fatalf("failed to insert ledger journal: %v", err)
	}

	err = pg.Pool.QueryRow(ctx, `
		INSERT INTO ledger_entries (journal_id, account_id, direction, amount_cents)
		VALUES ($1, $2, 'DEBIT', 1000)
		RETURNING id
	`, ledgerJournID, ledgerAccID).Scan(&ledgerID)
	if err != nil {
		t.Fatalf("failed to insert ledger entry: %v", err)
	}

	// 5j. CMS content entry
	cmsID := fmt.Sprintf("cms_int_%d", testRunID)
	_, err = pg.Pool.Exec(ctx, `
		INSERT INTO cms_content_items (id, content_type, slug, title, status)
		VALUES ($1, 'HOMEPAGE_HERO', $2, 'Aura Staging Hero', 'PUBLISHED')
		ON CONFLICT (slug) DO NOTHING
	`, cmsID, fmt.Sprintf("test-hero-%d", testRunID))
	if err != nil {
		t.Fatalf("failed to insert cms content: %v", err)
	}

	// 5k. Ad reward transaction with replay protection check
	var adRewardID pgtype.UUID
	txUnique := fmt.Sprintf("tx_intgate_%d", time.Now().UnixNano())
	err = pg.Pool.QueryRow(ctx, `
		INSERT INTO ad_reward_transactions (user_id, ad_network, transaction_id, reward_item, reward_amount)
		VALUES ($1, 'ADMOB', $2, 'LIKES', 1)
		RETURNING id
	`, userAID, txUnique).Scan(&adRewardID)
	if err != nil {
		t.Fatalf("failed to insert ad reward transaction: %v", err)
	}

	// Duplicate transaction must be rejected by unique constraint
	_, err = pg.Pool.Exec(ctx, `
		INSERT INTO ad_reward_transactions (user_id, ad_network, transaction_id, reward_item, reward_amount)
		VALUES ($1, 'ADMOB', $2, 'LIKES', 1)
	`, userAID, txUnique)
	if err == nil {
		t.Fatalf("expected unique constraint violation on duplicate ad reward transaction_id, got nil")
	}

	// 6. SIMULATED PROCESS RESTART:
	// Explicitly close the initial pool, create a completely fresh pool,
	// and verify that data was durably persisted in PostgreSQL (zero in-memory fallback).
	pg.Close()

	restartPG, err := database.NewPostgres(ctx, cfg)
	if err != nil {
		t.Fatalf("failed to recreate connection pool after simulated process restart: %v", err)
	}
	defer restartPG.Close()

	if err := restartPG.HealthCheck(ctx); err != nil {
		t.Fatalf("healthcheck failed on restarted pool: %v", err)
	}

	var readBackEmail string
	err = restartPG.Pool.QueryRow(ctx, `
		SELECT email FROM users WHERE id = $1
	`, userAID).Scan(&readBackEmail)
	if err != nil {
		t.Fatalf("failed to read back user A after restart: %v", err)
	}
	if readBackEmail != userAEmail {
		t.Fatalf("read back email mismatch: expected %s, got %s", userAEmail, readBackEmail)
	}

	var readBackMessageContent string
	err = restartPG.Pool.QueryRow(ctx, `
		SELECT body FROM messages WHERE id = $1
	`, messageID).Scan(&readBackMessageContent)
	if err != nil {
		t.Fatalf("failed to read back message after restart: %v", err)
	}
	if readBackMessageContent != "Hi! Nice to match with you." {
		t.Fatalf("read back message mismatch: got %q", readBackMessageContent)
	}

	var readBackOutboxStatus string
	err = restartPG.Pool.QueryRow(ctx, `
		SELECT status FROM outbox_events WHERE id = $1
	`, outboxID).Scan(&readBackOutboxStatus)
	if err != nil {
		t.Fatalf("failed to read back outbox event after restart: %v", err)
	}
	if readBackOutboxStatus != "PENDING" {
		t.Fatalf("read back outbox status mismatch: got %s", readBackOutboxStatus)
	}

	t.Log("Successfully verified durable data persistence across process restart with real PostgreSQL!")
}
