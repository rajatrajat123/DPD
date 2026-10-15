package database

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var migrationFileRegex = regexp.MustCompile(`^(\d{6})_([a-z0-9_]+)\.(up|down)\.sql$`)

type Migration struct {
	Version  int
	Name     string
	UpSQL    string
	DownSQL  string
	Checksum string
}

type AppliedMigration struct {
	Version   int
	Name      string
	Checksum  string
	AppliedAt time.Time
}

type MigrationStatus struct {
	Version   int
	Name      string
	Applied   bool
	Checksum  string
	AppliedAt *time.Time
}

// MigrationStore abstracts the database operations required by the migration runner.
// Production uses PgxMigrationStore (*pgxpool.Pool).
type MigrationStore interface {
	EnsureTable(ctx context.Context) error
	ListApplied(ctx context.Context) (map[int]AppliedMigration, error)
	ApplyUp(ctx context.Context, m Migration) error
	ApplyDown(ctx context.Context, m Migration) error
}

type Migrator struct {
	store      MigrationStore
	migrations []Migration
}

func NewMigrator(fsys fs.FS, store MigrationStore) (*Migrator, error) {
	migrations, err := LoadAndValidateMigrations(fsys)
	if err != nil {
		return nil, err
	}
	return &Migrator{
		store:      store,
		migrations: migrations,
	}, nil
}

// LoadAndValidateMigrations reads all *.up.sql and *.down.sql files from the
// provided filesystem, verifies sequential numbering, non-empty SQL, and matching
// up/down pairs, and calculates SHA-256 checksums.
func LoadAndValidateMigrations(fsys fs.FS) ([]Migration, error) {
	entries, err := fs.ReadDir(fsys, ".")
	if err != nil {
		return nil, fmt.Errorf("read migration directory: %w", err)
	}

	byVersion := make(map[int]*Migration)

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}

		matches := migrationFileRegex.FindStringSubmatch(entry.Name())
		if matches == nil {
			return nil, fmt.Errorf("invalid migration filename %q: must match NNNNNN_name.(up|down).sql", entry.Name())
		}

		version, _ := strconv.Atoi(matches[1])
		name := matches[2]
		direction := matches[3]

		rawBytes, err := fs.ReadFile(fsys, entry.Name())
		if err != nil {
			return nil, fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}
		sqlContent := strings.TrimSpace(string(rawBytes))
		if sqlContent == "" {
			return nil, fmt.Errorf("migration file %s is empty", entry.Name())
		}

		m, exists := byVersion[version]
		if !exists {
			m = &Migration{Version: version, Name: name}
			byVersion[version] = m
		} else if m.Name != name {
			return nil, fmt.Errorf("version %06d has mismatched names: %q vs %q", version, m.Name, name)
		}

		if direction == "up" {
			m.UpSQL = sqlContent
			sum := sha256.Sum256([]byte(sqlContent))
			m.Checksum = hex.EncodeToString(sum[:])
		} else {
			m.DownSQL = sqlContent
		}
	}

	if len(byVersion) == 0 {
		return nil, errors.New("no SQL migrations found")
	}

	versions := make([]int, 0, len(byVersion))
	for v := range byVersion {
		versions = append(versions, v)
	}
	sort.Ints(versions)

	result := make([]Migration, 0, len(versions))
	for idx, v := range versions {
		expectedVersion := idx + 1
		if v != expectedVersion {
			return nil, fmt.Errorf("migration sequence gap: expected version %06d, found %06d", expectedVersion, v)
		}
		m := byVersion[v]
		if m.UpSQL == "" {
			return nil, fmt.Errorf("migration %06d_%s is missing .up.sql", m.Version, m.Name)
		}
		if m.DownSQL == "" {
			return nil, fmt.Errorf("migration %06d_%s is missing .down.sql", m.Version, m.Name)
		}
		result = append(result, *m)
	}

	return result, nil
}

func (m *Migrator) Migrations() []Migration {
	out := make([]Migration, len(m.migrations))
	copy(out, m.migrations)
	return out
}

func (m *Migrator) Up(ctx context.Context) (int, error) {
	if err := m.store.EnsureTable(ctx); err != nil {
		return 0, err
	}
	applied, err := m.store.ListApplied(ctx)
	if err != nil {
		return 0, err
	}

	count := 0
	for _, mig := range m.migrations {
		if prev, ok := applied[mig.Version]; ok {
			if prev.Checksum != mig.Checksum {
				return count, fmt.Errorf(
					"checksum mismatch on applied migration %06d_%s: db=%s file=%s",
					mig.Version, mig.Name, prev.Checksum, mig.Checksum,
				)
			}
			continue
		}
		if err := m.store.ApplyUp(ctx, mig); err != nil {
			return count, fmt.Errorf("apply up %06d_%s: %w", mig.Version, mig.Name, err)
		}
		count++
	}
	return count, nil
}

func (m *Migrator) Down(ctx context.Context, steps int) (int, error) {
	if steps <= 0 {
		return 0, errors.New("down steps must be >= 1")
	}
	if err := m.store.EnsureTable(ctx); err != nil {
		return 0, err
	}
	applied, err := m.store.ListApplied(ctx)
	if err != nil {
		return 0, err
	}

	count := 0
	for i := len(m.migrations) - 1; i >= 0 && count < steps; i-- {
		mig := m.migrations[i]
		if _, ok := applied[mig.Version]; !ok {
			continue
		}
		if err := m.store.ApplyDown(ctx, mig); err != nil {
			return count, fmt.Errorf("apply down %06d_%s: %w", mig.Version, mig.Name, err)
		}
		count++
	}
	return count, nil
}

func (m *Migrator) Status(ctx context.Context) ([]MigrationStatus, error) {
	if err := m.store.EnsureTable(ctx); err != nil {
		return nil, err
	}
	applied, err := m.store.ListApplied(ctx)
	if err != nil {
		return nil, err
	}

	statuses := make([]MigrationStatus, 0, len(m.migrations))
	for _, mig := range m.migrations {
		st := MigrationStatus{
			Version:  mig.Version,
			Name:     mig.Name,
			Checksum: mig.Checksum,
		}
		if app, ok := applied[mig.Version]; ok {
			st.Applied = true
			t := app.AppliedAt
			st.AppliedAt = &t
		}
		statuses = append(statuses, st)
	}
	return statuses, nil
}

// PgxMigrationStore implements MigrationStore using a live PostgreSQL *pgxpool.Pool.
type PgxMigrationStore struct {
	pool *pgxpool.Pool
}

func NewPgxMigrationStore(pool *pgxpool.Pool) *PgxMigrationStore {
	return &PgxMigrationStore{pool: pool}
}

func (s *PgxMigrationStore) EnsureTable(ctx context.Context) error {
	const query = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INT PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`
	_, err := s.pool.Exec(ctx, query)
	return err
}

func (s *PgxMigrationStore) ListApplied(ctx context.Context) (map[int]AppliedMigration, error) {
	rows, err := s.pool.Query(ctx, `SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[int]AppliedMigration)
	for rows.Next() {
		var am AppliedMigration
		if err := rows.Scan(&am.Version, &am.Name, &am.Checksum, &am.AppliedAt); err != nil {
			return nil, err
		}
		out[am.Version] = am
	}
	return out, rows.Err()
}

func (s *PgxMigrationStore) ApplyUp(ctx context.Context, m Migration) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, m.UpSQL); err != nil {
			return err
		}
		_, err := tx.Exec(ctx,
			`INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)`,
			m.Version, m.Name, m.Checksum,
		)
		return err
	})
}

func (s *PgxMigrationStore) ApplyDown(ctx context.Context, m Migration) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, m.DownSQL); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM schema_migrations WHERE version = $1`, m.Version)
		return err
	})
}
