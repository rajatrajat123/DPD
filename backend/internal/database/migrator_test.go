package database

import (
	"context"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/auradating/platform/backend/internal/config"
	"github.com/auradating/platform/backend/migrations"
)

type memoryMigrationStore struct {
	applied map[int]AppliedMigration
	log     []string
}

func newMemoryMigrationStore() *memoryMigrationStore {
	return &memoryMigrationStore{
		applied: make(map[int]AppliedMigration),
	}
}

func (s *memoryMigrationStore) EnsureTable(context.Context) error {
	return nil
}

func (s *memoryMigrationStore) ListApplied(context.Context) (map[int]AppliedMigration, error) {
	cp := make(map[int]AppliedMigration, len(s.applied))
	for k, v := range s.applied {
		cp[k] = v
	}
	return cp, nil
}

func (s *memoryMigrationStore) ApplyUp(_ context.Context, m Migration) error {
	s.applied[m.Version] = AppliedMigration{
		Version:   m.Version,
		Name:      m.Name,
		Checksum:  m.Checksum,
		AppliedAt: time.Now().UTC(),
	}
	s.log = append(s.log, "UP:"+m.Name)
	return nil
}

func (s *memoryMigrationStore) ApplyDown(_ context.Context, m Migration) error {
	delete(s.applied, m.Version)
	s.log = append(s.log, "DOWN:"+m.Name)
	return nil
}

func TestEmbeddedMigrations_AreValidAndIncludePostGIS(t *testing.T) {
	migs, err := LoadAndValidateMigrations(migrations.FS)
	if err != nil {
		t.Fatalf("embedded migrations failed validation: %v", err)
	}
	if len(migs) < 4 {
		t.Fatalf("expected at least 4 embedded migrations, got %d", len(migs))
	}

	if !strings.Contains(strings.ToLower(migs[0].UpSQL), "postgis") {
		t.Errorf("migration 000001 must enable the postgis extension")
	}
	if !strings.Contains(strings.ToLower(migs[1].UpSQL), "geography(point, 4326)") {
		t.Errorf("migration 000002 must configure PostGIS GEOGRAPHY(Point, 4326)")
	}
	if !strings.Contains(strings.ToLower(migs[2].UpSQL), "media_assets") || !strings.Contains(strings.ToLower(migs[2].UpSQL), "ledger_entries") {
		t.Errorf("migration 000003 must define media_assets and ledger_entries tables")
	}
	if !strings.Contains(strings.ToLower(migs[3].UpSQL), "account_verifications") || !strings.Contains(strings.ToLower(migs[3].UpSQL), "password_resets") {
		t.Errorf("migration 000004 must define account_verifications and password_resets tables")
	}
}

func TestMigrator_UpDownStatusAndChecksumIntegrity(t *testing.T) {
	ctx := context.Background()
	store := newMemoryMigrationStore()

	migrator, err := NewMigrator(migrations.FS, store)
	if err != nil {
		t.Fatalf("failed to create migrator: %v", err)
	}

	// 1. Apply all up migrations
	appliedCount, err := migrator.Up(ctx)
	if err != nil {
		t.Fatalf("Up failed: %v", err)
	}
	if appliedCount != len(migrator.Migrations()) {
		t.Fatalf("expected %d migrations applied, got %d", len(migrator.Migrations()), appliedCount)
	}

	// 2. Second Up is idempotent (0 applied)
	secondCount, err := migrator.Up(ctx)
	if err != nil {
		t.Fatalf("second Up failed: %v", err)
	}
	if secondCount != 0 {
		t.Errorf("expected 0 migrations on second Up, got %d", secondCount)
	}

	// 3. Status shows all applied
	statuses, err := migrator.Status(ctx)
	if err != nil {
		t.Fatalf("Status failed: %v", err)
	}
	for _, st := range statuses {
		if !st.Applied || st.AppliedAt == nil {
			t.Errorf("expected migration %d to be marked applied", st.Version)
		}
	}

	// 4. Rollback 1 step
	downCount, err := migrator.Down(ctx, 1)
	if err != nil {
		t.Fatalf("Down(1) failed: %v", err)
	}
	if downCount != 1 {
		t.Errorf("expected 1 migration rolled back, got %d", downCount)
	}

	// 5. Tampered checksum detection
	am := store.applied[1]
	am.Checksum = "tampered_checksum_value"
	store.applied[1] = am
	if _, err := migrator.Up(ctx); err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("expected checksum mismatch error on tampered migration, got: %v", err)
	}
}

func TestLoadAndValidateMigrations_DetectsSequenceGap(t *testing.T) {
	badFS := fstest.MapFS{
		"000001_init.up.sql":   {Data: []byte("CREATE TABLE t1 (id int);")},
		"000001_init.down.sql": {Data: []byte("DROP TABLE t1;")},
		"000003_gap.up.sql":    {Data: []byte("CREATE TABLE t3 (id int);")},
		"000003_gap.down.sql":  {Data: []byte("DROP TABLE t3;")},
	}

	_, err := LoadAndValidateMigrations(badFS)
	if err == nil || !strings.Contains(err.Error(), "sequence gap") {
		t.Fatalf("expected sequence gap error, got: %v", err)
	}
}

func TestPostgresIntegration_LiveDatabaseMigrations(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("Skipping live PostgreSQL migration integration test: TEST_DATABASE_URL is not set (Docker/PostgreSQL not running in this environment)")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	cfg, err := config.Load(func(k string) string {
		if k == "DATABASE_URL" {
			return dbURL
		}
		return ""
	})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	pg, err := NewPostgres(ctx, cfg)
	if err != nil {
		t.Fatalf("connect postgres: %v", err)
	}
	defer pg.Close()

	store := NewPgxMigrationStore(pg.Pool)
	migrator, err := NewMigrator(migrations.FS, store)
	if err != nil {
		t.Fatalf("new migrator: %v", err)
	}

	if _, err := migrator.Up(ctx); err != nil {
		t.Fatalf("live migration Up failed: %v", err)
	}
}
