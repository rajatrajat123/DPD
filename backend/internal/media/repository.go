package media

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrAssetNotFound      = errors.New("media asset not found")
	ErrDerivativeNotFound = errors.New("media derivative not found")
	ErrUnauthorizedMedia  = errors.New("not authorized to access or modify this media asset")
)

type Repository interface {
	CreateAsset(ctx context.Context, asset *MediaAsset) error
	GetAssetByID(ctx context.Context, id string) (*MediaAsset, error)
	GetAssetByIdempotencyKey(ctx context.Context, key string) (*MediaAsset, error)
	UpdateAsset(ctx context.Context, asset *MediaAsset) error
	SaveDerivative(ctx context.Context, d *MediaDerivative) error
	GetDerivativesByAssetID(ctx context.Context, assetID string) ([]MediaDerivative, error)
	GetDerivativeByVariant(ctx context.Context, assetID string, variant DerivativeVariant) (*MediaDerivative, error)
	ListUserAssets(ctx context.Context, ownerUserID string, purpose *MediaPurpose, readyOnly bool) ([]MediaAsset, error)
	DeleteAsset(ctx context.Context, id string, ownerUserID string) error
	ReorderAssets(ctx context.Context, ownerUserID string, assetIDs []string) error
}

// MemoryMediaRepository provides thread-safe in-memory persistence for offline mode and tests.
type MemoryMediaRepository struct {
	mu          sync.RWMutex
	assets      map[string]*MediaAsset
	byKey       map[string]string            // idempotency_key -> id
	derivatives map[string][]MediaDerivative // asset_id -> []MediaDerivative
}

func NewMemoryRepository() *MemoryMediaRepository {
	return &MemoryMediaRepository{
		assets:      make(map[string]*MediaAsset),
		byKey:       make(map[string]string),
		derivatives: make(map[string][]MediaDerivative),
	}
}

func (m *MemoryMediaRepository) CreateAsset(ctx context.Context, asset *MediaAsset) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if asset.ID == "" {
		asset.ID = fmt.Sprintf("asset-%d", time.Now().UnixNano())
	}
	if asset.CreatedAt.IsZero() {
		asset.CreatedAt = time.Now().UTC()
	}
	asset.UpdatedAt = asset.CreatedAt

	if asset.IdempotencyKey != "" {
		if existingID, ok := m.byKey[asset.IdempotencyKey]; ok {
			*asset = *m.assets[existingID]
			return nil
		}
		m.byKey[asset.IdempotencyKey] = asset.ID
	}

	clone := *asset
	m.assets[asset.ID] = &clone
	return nil
}

func (m *MemoryMediaRepository) GetAssetByID(ctx context.Context, id string) (*MediaAsset, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	asset, ok := m.assets[id]
	if !ok || asset.Status == StatusPurged {
		return nil, ErrAssetNotFound
	}
	clone := *asset
	return &clone, nil
}

func (m *MemoryMediaRepository) GetAssetByIdempotencyKey(ctx context.Context, key string) (*MediaAsset, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	id, ok := m.byKey[key]
	if !ok {
		return nil, ErrAssetNotFound
	}
	return m.GetAssetByID(ctx, id)
}

func (m *MemoryMediaRepository) UpdateAsset(ctx context.Context, asset *MediaAsset) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	existing, ok := m.assets[asset.ID]
	if !ok {
		return ErrAssetNotFound
	}
	asset.UpdatedAt = time.Now().UTC()
	*existing = *asset
	return nil
}

func (m *MemoryMediaRepository) SaveDerivative(ctx context.Context, d *MediaDerivative) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if d.ID == "" {
		d.ID = fmt.Sprintf("deriv-%d", time.Now().UnixNano())
	}
	if d.CreatedAt.IsZero() {
		d.CreatedAt = time.Now().UTC()
	}

	list := m.derivatives[d.MediaAssetID]
	// Replace if exists
	found := false
	for i, item := range list {
		if item.Variant == d.Variant {
			list[i] = *d
			found = true
			break
		}
	}
	if !found {
		list = append(list, *d)
	}
	m.derivatives[d.MediaAssetID] = list
	return nil
}

func (m *MemoryMediaRepository) GetDerivativesByAssetID(ctx context.Context, assetID string) ([]MediaDerivative, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	list, ok := m.derivatives[assetID]
	if !ok {
		return []MediaDerivative{}, nil
	}
	res := make([]MediaDerivative, len(list))
	copy(res, list)
	return res, nil
}

func (m *MemoryMediaRepository) GetDerivativeByVariant(ctx context.Context, assetID string, variant DerivativeVariant) (*MediaDerivative, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	list := m.derivatives[assetID]
	for _, d := range list {
		if d.Variant == variant {
			clone := d
			return &clone, nil
		}
	}
	return nil, ErrDerivativeNotFound
}

func (m *MemoryMediaRepository) ListUserAssets(ctx context.Context, ownerUserID string, purpose *MediaPurpose, readyOnly bool) ([]MediaAsset, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []MediaAsset
	for _, a := range m.assets {
		if a.OwnerUserID != ownerUserID || a.Status == StatusPurged {
			continue
		}
		if purpose != nil && a.Purpose != *purpose {
			continue
		}
		if readyOnly && (a.Status != StatusReady || a.ModerationVerdict == nil || *a.ModerationVerdict != VerdictApproved) {
			continue
		}
		result = append(result, *a)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].DisplayOrder != result[j].DisplayOrder {
			return result[i].DisplayOrder < result[j].DisplayOrder
		}
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	return result, nil
}

func (m *MemoryMediaRepository) ReorderAssets(ctx context.Context, ownerUserID string, assetIDs []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for idx, id := range assetIDs {
		asset, ok := m.assets[id]
		if !ok || asset.Status == StatusPurged {
			return ErrAssetNotFound
		}
		if asset.OwnerUserID != ownerUserID {
			return ErrUnauthorizedMedia
		}
		asset.DisplayOrder = idx
		asset.UpdatedAt = time.Now().UTC()
	}
	return nil
}

func (m *MemoryMediaRepository) DeleteAsset(ctx context.Context, id string, ownerUserID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	asset, ok := m.assets[id]
	if !ok {
		return ErrAssetNotFound
	}
	if ownerUserID != "" && asset.OwnerUserID != ownerUserID {
		return ErrUnauthorizedMedia
	}

	asset.Status = StatusPurged
	delete(m.derivatives, id)
	return nil
}

// PostgresMediaRepository implements Repository for production PostgreSQL.
type PostgresMediaRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresMediaRepository {
	return &PostgresMediaRepository{pool: pool}
}

func (p *PostgresMediaRepository) CreateAsset(ctx context.Context, asset *MediaAsset) error {
	query := `
		INSERT INTO media_assets (
			owner_user_id, media_type, purpose, status,
			quarantine_bucket, quarantine_key, original_sha256, original_mime,
			original_size_bytes, width_px, height_px, duration_ms,
			exif_stripped, moderation_verdict, original_purge_after, idempotency_key,
			display_order
		) VALUES (
			$1, $2, $3, $4,
			$5, $6, $7, $8,
			$9, $10, $11, $12,
			$13, $14, $15, $16,
			$17
		)
		ON CONFLICT (idempotency_key) DO UPDATE
			SET updated_at = NOW(), display_order = EXCLUDED.display_order
		RETURNING id, created_at, updated_at
	`
	return p.pool.QueryRow(ctx, query,
		asset.OwnerUserID, string(asset.MediaType), string(asset.Purpose), string(asset.Status),
		asset.QuarantineBucket, asset.QuarantineKey, asset.OriginalSHA256, asset.OriginalMIME,
		asset.OriginalSizeBytes, asset.WidthPx, asset.HeightPx, asset.DurationMs,
		asset.ExifStripped, asset.ModerationVerdict, asset.OriginalPurgeAfter, asset.IdempotencyKey,
		asset.DisplayOrder,
	).Scan(&asset.ID, &asset.CreatedAt, &asset.UpdatedAt)
}

func (p *PostgresMediaRepository) GetAssetByID(ctx context.Context, id string) (*MediaAsset, error) {
	query := `
		SELECT
			id, owner_user_id, media_type, purpose, status,
			quarantine_bucket, quarantine_key, original_sha256, original_mime,
			original_size_bytes, width_px, height_px, duration_ms,
			exif_stripped, moderation_verdict, original_purge_after, idempotency_key,
			created_at, updated_at, display_order
		FROM media_assets
		WHERE id = $1 AND status <> 'PURGED'
	`
	var a MediaAsset
	var mediaType, purpose, status string
	var verdict *string

	err := p.pool.QueryRow(ctx, query, id).Scan(
		&a.ID, &a.OwnerUserID, &mediaType, &purpose, &status,
		&a.QuarantineBucket, &a.QuarantineKey, &a.OriginalSHA256, &a.OriginalMIME,
		&a.OriginalSizeBytes, &a.WidthPx, &a.HeightPx, &a.DurationMs,
		&a.ExifStripped, &verdict, &a.OriginalPurgeAfter, &a.IdempotencyKey,
		&a.CreatedAt, &a.UpdatedAt, &a.DisplayOrder,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAssetNotFound
		}
		return nil, err
	}

	a.MediaType = MediaType(mediaType)
	a.Purpose = MediaPurpose(purpose)
	a.Status = MediaStatus(status)
	if verdict != nil {
		v := ModerationVerdict(*verdict)
		a.ModerationVerdict = &v
	}
	return &a, nil
}

func (p *PostgresMediaRepository) GetAssetByIdempotencyKey(ctx context.Context, key string) (*MediaAsset, error) {
	query := `
		SELECT
			id, owner_user_id, media_type, purpose, status,
			quarantine_bucket, quarantine_key, original_sha256, original_mime,
			original_size_bytes, width_px, height_px, duration_ms,
			exif_stripped, moderation_verdict, original_purge_after, idempotency_key,
			created_at, updated_at, display_order
		FROM media_assets
		WHERE idempotency_key = $1 AND status <> 'PURGED'
	`
	var a MediaAsset
	var mediaType, purpose, status string
	var verdict *string

	err := p.pool.QueryRow(ctx, query, key).Scan(
		&a.ID, &a.OwnerUserID, &mediaType, &purpose, &status,
		&a.QuarantineBucket, &a.QuarantineKey, &a.OriginalSHA256, &a.OriginalMIME,
		&a.OriginalSizeBytes, &a.WidthPx, &a.HeightPx, &a.DurationMs,
		&a.ExifStripped, &verdict, &a.OriginalPurgeAfter, &a.IdempotencyKey,
		&a.CreatedAt, &a.UpdatedAt, &a.DisplayOrder,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAssetNotFound
		}
		return nil, err
	}

	a.MediaType = MediaType(mediaType)
	a.Purpose = MediaPurpose(purpose)
	a.Status = MediaStatus(status)
	if verdict != nil {
		v := ModerationVerdict(*verdict)
		a.ModerationVerdict = &v
	}
	return &a, nil
}

func (p *PostgresMediaRepository) UpdateAsset(ctx context.Context, asset *MediaAsset) error {
	query := `
		UPDATE media_assets
		SET
			status = $2,
			original_sha256 = $3,
			original_mime = $4,
			width_px = $5,
			height_px = $6,
			duration_ms = $7,
			exif_stripped = $8,
			moderation_verdict = $9,
			original_purge_after = $10,
			updated_at = NOW()
		WHERE id = $1
		RETURNING updated_at
	`
	return p.pool.QueryRow(ctx, query,
		asset.ID, string(asset.Status), asset.OriginalSHA256, asset.OriginalMIME,
		asset.WidthPx, asset.HeightPx, asset.DurationMs, asset.ExifStripped,
		asset.ModerationVerdict, asset.OriginalPurgeAfter,
	).Scan(&asset.UpdatedAt)
}

func (p *PostgresMediaRepository) SaveDerivative(ctx context.Context, d *MediaDerivative) error {
	query := `
		INSERT INTO media_derivatives (
			media_asset_id, variant, storage_bucket, storage_key,
			mime_type, size_bytes, width_px, height_px
		) VALUES (
			$1, $2, $3, $4,
			$5, $6, $7, $8
		)
		ON CONFLICT (media_asset_id, variant) DO UPDATE
			SET
				storage_bucket = EXCLUDED.storage_bucket,
				storage_key = EXCLUDED.storage_key,
				mime_type = EXCLUDED.mime_type,
				size_bytes = EXCLUDED.size_bytes,
				width_px = EXCLUDED.width_px,
				height_px = EXCLUDED.height_px
		RETURNING id, created_at
	`
	return p.pool.QueryRow(ctx, query,
		d.MediaAssetID, string(d.Variant), d.StorageBucket, d.StorageKey,
		d.MimeType, d.SizeBytes, d.WidthPx, d.HeightPx,
	).Scan(&d.ID, &d.CreatedAt)
}

func (p *PostgresMediaRepository) GetDerivativesByAssetID(ctx context.Context, assetID string) ([]MediaDerivative, error) {
	query := `
		SELECT id, media_asset_id, variant, storage_bucket, storage_key, mime_type, size_bytes, width_px, height_px, created_at
		FROM media_derivatives
		WHERE media_asset_id = $1
	`
	rows, err := p.pool.Query(ctx, query, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []MediaDerivative
	for rows.Next() {
		var d MediaDerivative
		var variant string
		if err := rows.Scan(&d.ID, &d.MediaAssetID, &variant, &d.StorageBucket, &d.StorageKey, &d.MimeType, &d.SizeBytes, &d.WidthPx, &d.HeightPx, &d.CreatedAt); err != nil {
			return nil, err
		}
		d.Variant = DerivativeVariant(variant)
		results = append(results, d)
	}
	return results, rows.Err()
}

func (p *PostgresMediaRepository) GetDerivativeByVariant(ctx context.Context, assetID string, variant DerivativeVariant) (*MediaDerivative, error) {
	query := `
		SELECT id, media_asset_id, variant, storage_bucket, storage_key, mime_type, size_bytes, width_px, height_px, created_at
		FROM media_derivatives
		WHERE media_asset_id = $1 AND variant = $2
	`
	var d MediaDerivative
	var variantStr string
	err := p.pool.QueryRow(ctx, query, assetID, string(variant)).Scan(
		&d.ID, &d.MediaAssetID, &variantStr, &d.StorageBucket, &d.StorageKey,
		&d.MimeType, &d.SizeBytes, &d.WidthPx, &d.HeightPx, &d.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrDerivativeNotFound
		}
		return nil, err
	}
	d.Variant = DerivativeVariant(variantStr)
	return &d, nil
}

func (p *PostgresMediaRepository) ListUserAssets(ctx context.Context, ownerUserID string, purpose *MediaPurpose, readyOnly bool) ([]MediaAsset, error) {
	query := `
		SELECT
			id, owner_user_id, media_type, purpose, status,
			quarantine_bucket, quarantine_key, original_sha256, original_mime,
			original_size_bytes, width_px, height_px, duration_ms,
			exif_stripped, moderation_verdict, original_purge_after, idempotency_key,
			created_at, updated_at, display_order
		FROM media_assets
		WHERE owner_user_id = $1 AND status <> 'PURGED'
	`
	args := []any{ownerUserID}
	if purpose != nil {
		args = append(args, string(*purpose))
		query += fmt.Sprintf(" AND purpose = $%d", len(args))
	}
	if readyOnly {
		query += " AND status = 'READY' AND moderation_verdict = 'APPROVED'"
	}
	query += " ORDER BY display_order ASC, created_at DESC"

	rows, err := p.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []MediaAsset
	for rows.Next() {
		var a MediaAsset
		var mediaType, purp, status string
		var verdict *string
		if err := rows.Scan(
			&a.ID, &a.OwnerUserID, &mediaType, &purp, &status,
			&a.QuarantineBucket, &a.QuarantineKey, &a.OriginalSHA256, &a.OriginalMIME,
			&a.OriginalSizeBytes, &a.WidthPx, &a.HeightPx, &a.DurationMs,
			&a.ExifStripped, &verdict, &a.OriginalPurgeAfter, &a.IdempotencyKey,
			&a.CreatedAt, &a.UpdatedAt, &a.DisplayOrder,
		); err != nil {
			return nil, err
		}
		a.MediaType = MediaType(mediaType)
		a.Purpose = MediaPurpose(purp)
		a.Status = MediaStatus(status)
		if verdict != nil {
			v := ModerationVerdict(*verdict)
			a.ModerationVerdict = &v
		}
		results = append(results, a)
	}
	return results, rows.Err()
}

func (p *PostgresMediaRepository) DeleteAsset(ctx context.Context, id string, ownerUserID string) error {
	query := `
		UPDATE media_assets
		SET status = 'PURGED', updated_at = NOW()
		WHERE id = $1
	`
	args := []any{id}
	if ownerUserID != "" {
		args = append(args, ownerUserID)
		query += " AND owner_user_id = $2"
	}
	res, err := p.pool.Exec(ctx, query, args...)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return ErrAssetNotFound
	}
	return nil
}

func (p *PostgresMediaRepository) ReorderAssets(ctx context.Context, ownerUserID string, assetIDs []string) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for idx, id := range assetIDs {
		var currentOwner string
		err := tx.QueryRow(ctx, "SELECT owner_user_id FROM media_assets WHERE id = $1 AND status <> 'PURGED'", id).Scan(&currentOwner)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrAssetNotFound
			}
			return err
		}
		if currentOwner != ownerUserID {
			return ErrUnauthorizedMedia
		}
		_, err = tx.Exec(ctx, "UPDATE media_assets SET display_order = $1, updated_at = NOW() WHERE id = $2", idx, id)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}
