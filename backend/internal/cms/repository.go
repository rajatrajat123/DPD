package cms

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	ListContentItems(ctx context.Context, statusFilter string) ([]ContentItem, error)
	GetContentItem(ctx context.Context, id string) (*ContentItemDetail, error)
	GetPublishedBySlug(ctx context.Context, slug string) (*ContentItem, *ContentVersion, error)
	GetPublishedByID(ctx context.Context, id string) (*ContentItem, *ContentVersion, error)
	SaveDraft(ctx context.Context, item *ContentItem, version *ContentVersion) error
	Publish(ctx context.Context, itemID string, versionID string, publishedAt time.Time) (*ContentItem, *ContentVersion, error)
	Unpublish(ctx context.Context, itemID string) (*ContentItem, error)
	RevertToVersion(ctx context.Context, itemID string, versionNumber int, newVersionID string, authorID, authorEmail string) (*ContentVersion, error)
	CreateMediaAsset(ctx context.Context, asset *MediaAsset) error
	ListMediaAssets(ctx context.Context, limit int) ([]MediaAsset, error)
	RecordAudit(ctx context.Context, record *CMSAuditRecord) error
	ListAuditRecords(ctx context.Context, limit int) ([]CMSAuditRecord, error)
}

// MemoryRepository provides thread-safe in-memory storage seeded with live Aura content.
type MemoryRepository struct {
	mu           sync.RWMutex
	items        map[string]*ContentItem
	versions     map[string][]*ContentVersion // key: itemID
	versionByID  map[string]*ContentVersion
	media        []MediaAsset
	auditRecords []CMSAuditRecord
}

func NewMemoryRepository() *MemoryRepository {
	now := time.Now().UTC().Add(-24 * time.Hour)
	pubVer1 := "ver_hero_pub_01"
	pubVer2 := "ver_nav_pub_01"
	pubVer3 := "ver_gay_pub_01"
	pubVer4 := "ver_les_pub_01"
	pubVer5 := "ver_bi_pub_01"
	pubVer6 := "ver_queer_pub_01"

	repo := &MemoryRepository{
		items:       make(map[string]*ContentItem),
		versions:    make(map[string][]*ContentVersion),
		versionByID: make(map[string]*ContentVersion),
		media: []MediaAsset{
			{
				ID:            "ast_hero_default",
				Filename:      "aura-luxury-editorial.webp",
				ContentType:   "image/webp",
				FileSizeBytes: 184500,
				StoragePath:   "/uploads/marketing/aura-luxury-editorial.webp",
				PublicURL:     "/uploads/marketing/aura-luxury-editorial.webp",
				AltText:       "Authentic LGBTQ+ daters in an intimate luxury interior setting",
				UploaderID:    "usr_system_editorial",
				CreatedAt:     now,
			},
		},
		auditRecords: make([]CMSAuditRecord, 0),
	}

	// 1. Homepage Hero
	heroItem := &ContentItem{
		ID:                 "homepage.hero",
		ContentType:        TypeHeroBanner,
		Slug:               "/",
		Title:              "Homepage Hero Banner",
		Status:             StatusPublished,
		PublishedVersionID: &pubVer1,
		PublishedAt:        &now,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	heroVersion := &ContentVersion{
		ID:                 pubVer1,
		ContentItemID:      "homepage.hero",
		VersionNumber:      1,
		Headline:           "Where Intentional LGBTQ+ Connections Begin",
		Subheading:         "A bot-free, verified dating sanctuary engineered for authentic connections, mutual values, and lifestyle discretion.",
		BodyMarkdown:       "Explore verified queer dating across gay, lesbian, bisexual, and expansive non-binary identities.",
		CTALabel:           "Begin Your Journey",
		CTAURL:             "/auth/register",
		ImageURL:           "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=1200&h=800&fit=crop",
		ImageAlt:           "Curated LGBTQ+ community members connecting warmly in a modern sanctuary",
		SEOMetaTitle:       "Aura Dating | Authentic, Safe LGBTQ+ Relationships",
		SEOMetaDescription: "Experience safe, authentic LGBTQ+ dating with photo verification, privacy-first controls, and intentional matchmaking for gay, lesbian, bi, and queer folks.",
		SEOCanonicalURL:    "https://www.auradating.com/",
		AuthorID:           "usr_system_editorial",
		AuthorEmail:        "editorial@auradating.com",
		CreatedAt:          now,
	}
	repo.items[heroItem.ID] = heroItem
	repo.versions[heroItem.ID] = []*ContentVersion{heroVersion}
	repo.versionByID[heroVersion.ID] = heroVersion

	// 2. Primary Navigation
	navItem := &ContentItem{
		ID:                 "nav.primary",
		ContentType:        TypeNavMenu,
		Slug:               "/nav",
		Title:              "Primary Navigation & Community Menu",
		Status:             StatusPublished,
		PublishedVersionID: &pubVer2,
		PublishedAt:        &now,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	navVersion := &ContentVersion{
		ID:            pubVer2,
		ContentItemID: "nav.primary",
		VersionNumber: 1,
		Headline:      "Aura Primary Navigation",
		Metadata: map[string]any{
			"primary_links": []map[string]any{
				{"label": "How It Works", "href": "/how-it-works"},
				{"label": "Safety & Privacy", "href": "/safety"},
				{"label": "Membership", "href": "/pricing"},
			},
			"communities": []map[string]any{
				{"label": "Gay Dating", "href": "/gay-dating", "description": "Intentional matchmaking for gay men."},
				{"label": "Lesbian & WLW", "href": "/lesbian-dating", "description": "A verified haven for queer women."},
				{"label": "Bisexual Dating", "href": "/bisexual-dating", "description": "Date freely without biphobia."},
				{"label": "Queer & Non-Binary", "href": "/queer-dating", "description": "Gender-affirming matchmaking."},
				{"label": "Intentional Relationships", "href": "/dating", "description": "Filtered by structure and dealbreakers."},
			},
		},
		AuthorID:    "usr_system_editorial",
		AuthorEmail: "editorial@auradating.com",
		CreatedAt:   now,
	}
	repo.items[navItem.ID] = navItem
	repo.versions[navItem.ID] = []*ContentVersion{navVersion}
	repo.versionByID[navVersion.ID] = navVersion

	// 3. Gay Dating Landing Page
	gayItem := &ContentItem{
		ID:                 "intent.gay-dating",
		ContentType:        TypeIntentPage,
		Slug:               "/gay-dating",
		Title:              "Gay Dating Community Landing Page",
		Status:             StatusPublished,
		PublishedVersionID: &pubVer3,
		PublishedAt:        &now,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	gayVersion := &ContentVersion{
		ID:                 pubVer3,
		ContentItemID:      "intent.gay-dating",
		VersionNumber:      1,
		Headline:           "Intentional Gay Matchmaking Without the Noise",
		Subheading:         "A sanctuary for gay men seeking meaningful chemistry, verified profiles, and lifestyle dealbreaker integrity.",
		BodyMarkdown:       "Aura reimagines gay dating with mandatory photo verification, mutual values alignment, and discretion mode.",
		CTALabel:           "Join Gay Community",
		CTAURL:             "/auth/register?community=gay",
		ImageURL:           "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=1200&h=800&fit=crop",
		ImageAlt:           "Gay couple smiling together warmly on a scenic city overlook",
		SEOMetaTitle:       "Gay Dating App | Authentic Gay Connections | Aura",
		SEOMetaDescription: "Join Aura for intentional gay dating. Connect with verified gay singles looking for genuine romance, shared values, and lasting compatibility.",
		SEOCanonicalURL:    "https://www.auradating.com/gay-dating",
		AuthorID:           "usr_system_editorial",
		AuthorEmail:        "editorial@auradating.com",
		CreatedAt:          now,
	}
	repo.items[gayItem.ID] = gayItem
	repo.versions[gayItem.ID] = []*ContentVersion{gayVersion}
	repo.versionByID[gayVersion.ID] = gayVersion

	// 4. Lesbian Dating Landing Page
	lesItem := &ContentItem{
		ID:                 "intent.lesbian-dating",
		ContentType:        TypeIntentPage,
		Slug:               "/lesbian-dating",
		Title:              "Lesbian & WLW Community Landing Page",
		Status:             StatusPublished,
		PublishedVersionID: &pubVer4,
		PublishedAt:        &now,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	lesVersion := &ContentVersion{
		ID:                 pubVer4,
		ContentItemID:      "intent.lesbian-dating",
		VersionNumber:      1,
		Headline:           "A Verified Haven for Queer Women & WLW",
		Subheading:         "Escape algorithmic ghosting. Meet authentic queer women, lesbians, and sapphics in an intentional community.",
		BodyMarkdown:       "Built specifically to eliminate bot profiles and predatory intrusion, Aura delivers genuine connections for women who love women.",
		CTALabel:           "Join WLW Community",
		CTAURL:             "/auth/register?community=lesbian",
		ImageURL:           "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=1200&h=800&fit=crop",
		ImageAlt:           "Queer women sharing laughter and conversation outdoors",
		SEOMetaTitle:       "Lesbian Dating App | Authentic Queer Women Dating | Aura",
		SEOMetaDescription: "Discover Aura, the verified lesbian and WLW dating app. Connect with genuine queer women in an intentional, bot-free dating environment.",
		SEOCanonicalURL:    "https://www.auradating.com/lesbian-dating",
		AuthorID:           "usr_system_editorial",
		AuthorEmail:        "editorial@auradating.com",
		CreatedAt:          now,
	}
	repo.items[lesItem.ID] = lesItem
	repo.versions[lesItem.ID] = []*ContentVersion{lesVersion}
	repo.versionByID[lesVersion.ID] = lesVersion

	// 5. Bisexual Dating Landing Page
	biItem := &ContentItem{
		ID:                 "intent.bisexual-dating",
		ContentType:        TypeIntentPage,
		Slug:               "/bisexual-dating",
		Title:              "Bisexual Dating Community Landing Page",
		Status:             StatusPublished,
		PublishedVersionID: &pubVer5,
		PublishedAt:        &now,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	biVersion := &ContentVersion{
		ID:                 pubVer5,
		ContentItemID:      "intent.bisexual-dating",
		VersionNumber:      1,
		Headline:           "Date Freely Without Stereotypes or Biphobia",
		Subheading:         "A nuanced dating space celebrating bisexual and pansexual singles with full visibility and dealbreaker controls.",
		BodyMarkdown:       "Aura gives bisexual daters full control over gender visibility, relationship structure preferences, and privacy safeguards.",
		CTALabel:           "Join Bisexual Community",
		CTAURL:             "/auth/register?community=bisexual",
		ImageURL:           "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=1200&h=800&fit=crop",
		ImageAlt:           "Bisexual dater exploring city art district in golden evening sunlight",
		SEOMetaTitle:       "Bisexual Dating App | Bi & Pan Dating Community | Aura",
		SEOMetaDescription: "Join Aura's bisexual dating community. Explore meaningful romance and dates without judgment, biphobia, or forced gender binaries.",
		SEOCanonicalURL:    "https://www.auradating.com/bisexual-dating",
		AuthorID:           "usr_system_editorial",
		AuthorEmail:        "editorial@auradating.com",
		CreatedAt:          now,
	}
	repo.items[biItem.ID] = biItem
	repo.versions[biItem.ID] = []*ContentVersion{biVersion}
	repo.versionByID[biVersion.ID] = biVersion

	// 6. Queer & Non-Binary Landing Page
	queerItem := &ContentItem{
		ID:                 "intent.queer-dating",
		ContentType:        TypeIntentPage,
		Slug:               "/queer-dating",
		Title:              "Queer & Non-Binary Community Landing Page",
		Status:             StatusPublished,
		PublishedVersionID: &pubVer6,
		PublishedAt:        &now,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	queerVersion := &ContentVersion{
		ID:                 pubVer6,
		ContentItemID:      "intent.queer-dating",
		VersionNumber:      1,
		Headline:           "Gender-Affirming Matchmaking for the Expansive Spectrum",
		Subheading:         "Pronoun affirmation, gender-expansive taxonomy, and mutual dealbreakers honoring all authentic identities.",
		BodyMarkdown:       "Never squeezed into rigid binary dropdowns. Aura is built from the ground up for trans, non-binary, genderfluid, and queer singles.",
		CTALabel:           "Join Queer Community",
		CTAURL:             "/auth/register?community=queer",
		ImageURL:           "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=1200&h=800&fit=crop",
		ImageAlt:           "Non-binary community members smiling together at an evening cultural gathering",
		SEOMetaTitle:       "Queer & Non-Binary Dating App | Gender-Affirming | Aura",
		SEOMetaDescription: "Aura provides gender-affirming dating for queer and non-binary individuals. Enjoy pronoun affirmation, safety tools, and authentic matches.",
		SEOCanonicalURL:    "https://www.auradating.com/queer-dating",
		AuthorID:           "usr_system_editorial",
		AuthorEmail:        "editorial@auradating.com",
		CreatedAt:          now,
	}
	repo.items[queerItem.ID] = queerItem
	repo.versions[queerItem.ID] = []*ContentVersion{queerVersion}
	repo.versionByID[queerVersion.ID] = queerVersion

	return repo
}

func (m *MemoryRepository) ListContentItems(ctx context.Context, statusFilter string) ([]ContentItem, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []ContentItem
	for _, it := range m.items {
		if statusFilter != "" && !strings.EqualFold(string(it.Status), statusFilter) {
			continue
		}
		result = append(result, *it)
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].Title < result[j].Title
	})
	return result, nil
}

func (m *MemoryRepository) GetContentItem(ctx context.Context, id string) (*ContentItemDetail, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	item, exists := m.items[id]
	if !exists {
		return nil, ErrContentNotFound
	}

	versions := m.versions[id]
	var current *ContentVersion
	var published *ContentVersion

	if len(versions) > 0 {
		current = versions[len(versions)-1] // latest draft or revision
	}
	if item.PublishedVersionID != nil {
		published = m.versionByID[*item.PublishedVersionID]
	}

	clonedVersions := make([]ContentVersion, len(versions))
	for i, v := range versions {
		clonedVersions[i] = *v
	}

	return &ContentItemDetail{
		Item:             *item,
		CurrentVersion:   current,
		PublishedVersion: published,
		Versions:         clonedVersions,
	}, nil
}

func (m *MemoryRepository) GetPublishedBySlug(ctx context.Context, slug string) (*ContentItem, *ContentVersion, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	normalizedSlug := slug
	if !strings.HasPrefix(normalizedSlug, "/") {
		normalizedSlug = "/" + normalizedSlug
	}

	for _, item := range m.items {
		if item.Status == StatusPublished && strings.EqualFold(item.Slug, normalizedSlug) {
			if item.PublishedVersionID != nil {
				ver := m.versionByID[*item.PublishedVersionID]
				if ver != nil {
					return item, ver, nil
				}
			}
		}
	}
	return nil, nil, ErrContentNotFound
}

func (m *MemoryRepository) GetPublishedByID(ctx context.Context, id string) (*ContentItem, *ContentVersion, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	item, exists := m.items[id]
	if !exists || item.Status != StatusPublished || item.PublishedVersionID == nil {
		return nil, nil, ErrContentNotFound
	}

	ver, exists := m.versionByID[*item.PublishedVersionID]
	if !exists {
		return nil, nil, ErrVersionNotFound
	}
	return item, ver, nil
}

func (m *MemoryRepository) SaveDraft(ctx context.Context, item *ContentItem, version *ContentVersion) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	existing, exists := m.items[item.ID]
	if !exists {
		m.items[item.ID] = item
		version.VersionNumber = 1
	} else {
		existing.Title = item.Title
		existing.Slug = item.Slug
		existing.UpdatedAt = time.Now().UTC()
		vers := m.versions[item.ID]
		version.VersionNumber = len(vers) + 1
	}

	version.CreatedAt = time.Now().UTC()
	m.versions[item.ID] = append(m.versions[item.ID], version)
	m.versionByID[version.ID] = version
	return nil
}

func (m *MemoryRepository) Publish(ctx context.Context, itemID string, versionID string, publishedAt time.Time) (*ContentItem, *ContentVersion, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	item, exists := m.items[itemID]
	if !exists {
		return nil, nil, ErrContentNotFound
	}

	ver, exists := m.versionByID[versionID]
	if !exists || ver.ContentItemID != itemID {
		return nil, nil, ErrVersionNotFound
	}

	item.Status = StatusPublished
	item.PublishedVersionID = &versionID
	item.PublishedAt = &publishedAt
	item.UpdatedAt = publishedAt

	return item, ver, nil
}

func (m *MemoryRepository) Unpublish(ctx context.Context, itemID string) (*ContentItem, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	item, exists := m.items[itemID]
	if !exists {
		return nil, ErrContentNotFound
	}

	item.Status = StatusDraft
	item.PublishedVersionID = nil
	item.PublishedAt = nil
	item.UpdatedAt = time.Now().UTC()

	return item, nil
}

func (m *MemoryRepository) RevertToVersion(ctx context.Context, itemID string, versionNumber int, newVersionID string, authorID, authorEmail string) (*ContentVersion, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	item, exists := m.items[itemID]
	if !exists {
		return nil, ErrContentNotFound
	}

	versions := m.versions[itemID]
	var target *ContentVersion
	for _, v := range versions {
		if v.VersionNumber == versionNumber {
			target = v
			break
		}
	}
	if target == nil {
		return nil, ErrVersionNotFound
	}

	// Create new revision from target
	now := time.Now().UTC()
	reverted := &ContentVersion{
		ID:                 newVersionID,
		ContentItemID:      itemID,
		VersionNumber:      len(versions) + 1,
		Headline:           target.Headline,
		Subheading:         target.Subheading,
		BodyMarkdown:       target.BodyMarkdown,
		CTALabel:           target.CTALabel,
		CTAURL:             target.CTAURL,
		ImageURL:           target.ImageURL,
		ImageAlt:           target.ImageAlt,
		SEOMetaTitle:       target.SEOMetaTitle,
		SEOMetaDescription: target.SEOMetaDescription,
		SEOCanonicalURL:    target.SEOCanonicalURL,
		Metadata:           target.Metadata,
		AuthorID:           authorID,
		AuthorEmail:        authorEmail,
		CreatedAt:          now,
	}

	m.versions[itemID] = append(m.versions[itemID], reverted)
	m.versionByID[reverted.ID] = reverted
	item.UpdatedAt = now

	return reverted, nil
}

func (m *MemoryRepository) CreateMediaAsset(ctx context.Context, asset *MediaAsset) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.media = append([]MediaAsset{*asset}, m.media...)
	return nil
}

func (m *MemoryRepository) ListMediaAssets(ctx context.Context, limit int) ([]MediaAsset, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if limit <= 0 || limit > len(m.media) {
		limit = len(m.media)
	}
	res := make([]MediaAsset, limit)
	copy(res, m.media[:limit])
	return res, nil
}

func (m *MemoryRepository) RecordAudit(ctx context.Context, record *CMSAuditRecord) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.auditRecords = append([]CMSAuditRecord{*record}, m.auditRecords...)
	return nil
}

func (m *MemoryRepository) ListAuditRecords(ctx context.Context, limit int) ([]CMSAuditRecord, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if limit <= 0 || limit > len(m.auditRecords) {
		limit = len(m.auditRecords)
	}
	res := make([]CMSAuditRecord, limit)
	copy(res, m.auditRecords[:limit])
	return res, nil
}

// PostgresRepository executes durable queries against cms_* tables.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (p *PostgresRepository) ListContentItems(ctx context.Context, statusFilter string) ([]ContentItem, error) {
	query := "SELECT id, content_type, slug, title, status, published_version_id, published_at, created_at, updated_at FROM cms_content_items"
	var args []any
	if statusFilter != "" {
		query += " WHERE status = $1"
		args = append(args, strings.ToUpper(statusFilter))
	}
	query += " ORDER BY title ASC"

	rows, err := p.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query cms items: %w", err)
	}
	defer rows.Close()

	var result []ContentItem
	for rows.Next() {
		var it ContentItem
		var ctStr, statusStr string
		err := rows.Scan(
			&it.ID, &ctStr, &it.Slug, &it.Title, &statusStr,
			&it.PublishedVersionID, &it.PublishedAt, &it.CreatedAt, &it.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan cms item: %w", err)
		}
		it.ContentType = ContentType(ctStr)
		it.Status = ContentStatus(statusStr)
		result = append(result, it)
	}
	return result, nil
}

func (p *PostgresRepository) GetContentItem(ctx context.Context, id string) (*ContentItemDetail, error) {
	var it ContentItem
	var ctStr, statusStr string
	query := `SELECT id, content_type, slug, title, status, published_version_id, published_at, created_at, updated_at FROM cms_content_items WHERE id = $1`
	err := p.pool.QueryRow(ctx, query, id).Scan(
		&it.ID, &ctStr, &it.Slug, &it.Title, &statusStr,
		&it.PublishedVersionID, &it.PublishedAt, &it.CreatedAt, &it.UpdatedAt,
	)
	if err != nil {
		return nil, ErrContentNotFound
	}
	it.ContentType = ContentType(ctStr)
	it.Status = ContentStatus(statusStr)

	// Fetch versions
	verQuery := `SELECT id, content_item_id, version_number, headline, subheading, body_markdown, cta_label, cta_url, image_url, image_alt, seo_meta_title, seo_meta_description, seo_canonical_url, metadata, author_id, author_email, created_at FROM cms_content_versions WHERE content_item_id = $1 ORDER BY version_number ASC`
	rows, err := p.pool.Query(ctx, verQuery, id)
	if err != nil {
		return nil, fmt.Errorf("failed to query versions: %w", err)
	}
	defer rows.Close()

	var versions []ContentVersion
	var current *ContentVersion
	var published *ContentVersion

	for rows.Next() {
		var v ContentVersion
		var sub, body, ctaL, ctaU, imgU, imgA, sTitle, sDesc, sCanon, aEmail *string
		var metaBytes []byte

		err := rows.Scan(
			&v.ID, &v.ContentItemID, &v.VersionNumber, &v.Headline,
			&sub, &body, &ctaL, &ctaU, &imgU, &imgA, &sTitle, &sDesc, &sCanon,
			&metaBytes, &v.AuthorID, &aEmail, &v.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan version: %w", err)
		}
		if sub != nil {
			v.Subheading = *sub
		}
		if body != nil {
			v.BodyMarkdown = *body
		}
		if ctaL != nil {
			v.CTALabel = *ctaL
		}
		if ctaU != nil {
			v.CTAURL = *ctaU
		}
		if imgU != nil {
			v.ImageURL = *imgU
		}
		if imgA != nil {
			v.ImageAlt = *imgA
		}
		if sTitle != nil {
			v.SEOMetaTitle = *sTitle
		}
		if sDesc != nil {
			v.SEOMetaDescription = *sDesc
		}
		if sCanon != nil {
			v.SEOCanonicalURL = *sCanon
		}
		if aEmail != nil {
			v.AuthorEmail = *aEmail
		}
		if len(metaBytes) > 0 {
			_ = json.Unmarshal(metaBytes, &v.Metadata)
		}

		versions = append(versions, v)
		last := versions[len(versions)-1]
		current = &last
		if it.PublishedVersionID != nil && *it.PublishedVersionID == v.ID {
			pub := v
			published = &pub
		}
	}

	return &ContentItemDetail{
		Item:             it,
		CurrentVersion:   current,
		PublishedVersion: published,
		Versions:         versions,
	}, nil
}

func (p *PostgresRepository) GetPublishedBySlug(ctx context.Context, slug string) (*ContentItem, *ContentVersion, error) {
	query := `
		SELECT i.id, i.content_type, i.slug, i.title, i.status, i.published_version_id, i.published_at, i.created_at, i.updated_at,
		       v.id, v.version_number, v.headline, v.subheading, v.body_markdown, v.cta_label, v.cta_url, v.image_url, v.image_alt,
		       v.seo_meta_title, v.seo_meta_description, v.seo_canonical_url, v.metadata, v.author_id, v.author_email, v.created_at
		FROM cms_content_items i
		JOIN cms_content_versions v ON i.published_version_id = v.id
		WHERE i.slug = $1 AND i.status = 'PUBLISHED'
	`
	var it ContentItem
	var v ContentVersion
	var ctStr, statusStr string
	var sub, body, ctaL, ctaU, imgU, imgA, sTitle, sDesc, sCanon, aEmail *string
	var metaBytes []byte

	err := p.pool.QueryRow(ctx, query, slug).Scan(
		&it.ID, &ctStr, &it.Slug, &it.Title, &statusStr, &it.PublishedVersionID, &it.PublishedAt, &it.CreatedAt, &it.UpdatedAt,
		&v.ID, &v.VersionNumber, &v.Headline, &sub, &body, &ctaL, &ctaU, &imgU, &imgA,
		&sTitle, &sDesc, &sCanon, &metaBytes, &v.AuthorID, &aEmail, &v.CreatedAt,
	)
	if err != nil {
		return nil, nil, ErrContentNotFound
	}
	it.ContentType = ContentType(ctStr)
	it.Status = ContentStatus(statusStr)
	v.ContentItemID = it.ID
	if sub != nil {
		v.Subheading = *sub
	}
	if body != nil {
		v.BodyMarkdown = *body
	}
	if ctaL != nil {
		v.CTALabel = *ctaL
	}
	if ctaU != nil {
		v.CTAURL = *ctaU
	}
	if imgU != nil {
		v.ImageURL = *imgU
	}
	if imgA != nil {
		v.ImageAlt = *imgA
	}
	if sTitle != nil {
		v.SEOMetaTitle = *sTitle
	}
	if sDesc != nil {
		v.SEOMetaDescription = *sDesc
	}
	if sCanon != nil {
		v.SEOCanonicalURL = *sCanon
	}
	if aEmail != nil {
		v.AuthorEmail = *aEmail
	}
	if len(metaBytes) > 0 {
		_ = json.Unmarshal(metaBytes, &v.Metadata)
	}

	return &it, &v, nil
}

func (p *PostgresRepository) GetPublishedByID(ctx context.Context, id string) (*ContentItem, *ContentVersion, error) {
	query := `
		SELECT i.id, i.content_type, i.slug, i.title, i.status, i.published_version_id, i.published_at, i.created_at, i.updated_at,
		       v.id, v.version_number, v.headline, v.subheading, v.body_markdown, v.cta_label, v.cta_url, v.image_url, v.image_alt,
		       v.seo_meta_title, v.seo_meta_description, v.seo_canonical_url, v.metadata, v.author_id, v.author_email, v.created_at
		FROM cms_content_items i
		JOIN cms_content_versions v ON i.published_version_id = v.id
		WHERE i.id = $1 AND i.status = 'PUBLISHED'
	`
	var it ContentItem
	var v ContentVersion
	var ctStr, statusStr string
	var sub, body, ctaL, ctaU, imgU, imgA, sTitle, sDesc, sCanon, aEmail *string
	var metaBytes []byte

	err := p.pool.QueryRow(ctx, query, id).Scan(
		&it.ID, &ctStr, &it.Slug, &it.Title, &statusStr, &it.PublishedVersionID, &it.PublishedAt, &it.CreatedAt, &it.UpdatedAt,
		&v.ID, &v.VersionNumber, &v.Headline, &sub, &body, &ctaL, &ctaU, &imgU, &imgA,
		&sTitle, &sDesc, &sCanon, &metaBytes, &v.AuthorID, &aEmail, &v.CreatedAt,
	)
	if err != nil {
		return nil, nil, ErrContentNotFound
	}
	it.ContentType = ContentType(ctStr)
	it.Status = ContentStatus(statusStr)
	v.ContentItemID = it.ID
	if sub != nil {
		v.Subheading = *sub
	}
	if body != nil {
		v.BodyMarkdown = *body
	}
	if ctaL != nil {
		v.CTALabel = *ctaL
	}
	if ctaU != nil {
		v.CTAURL = *ctaU
	}
	if imgU != nil {
		v.ImageURL = *imgU
	}
	if imgA != nil {
		v.ImageAlt = *imgA
	}
	if sTitle != nil {
		v.SEOMetaTitle = *sTitle
	}
	if sDesc != nil {
		v.SEOMetaDescription = *sDesc
	}
	if sCanon != nil {
		v.SEOCanonicalURL = *sCanon
	}
	if aEmail != nil {
		v.AuthorEmail = *aEmail
	}
	if len(metaBytes) > 0 {
		_ = json.Unmarshal(metaBytes, &v.Metadata)
	}

	return &it, &v, nil
}

func (p *PostgresRepository) SaveDraft(ctx context.Context, item *ContentItem, version *ContentVersion) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Upsert ContentItem
	itemQuery := `
		INSERT INTO cms_content_items (id, content_type, slug, title, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (id) DO UPDATE SET
			title = EXCLUDED.title,
			slug = EXCLUDED.slug,
			updated_at = EXCLUDED.updated_at
	`
	now := time.Now().UTC()
	_, err = tx.Exec(ctx, itemQuery, item.ID, string(item.ContentType), item.Slug, item.Title, string(item.Status), now, now)
	if err != nil {
		return fmt.Errorf("failed to upsert content item: %w", err)
	}

	// Calculate next version number
	var nextVer int
	countQuery := `SELECT COALESCE(MAX(version_number), 0) + 1 FROM cms_content_versions WHERE content_item_id = $1`
	_ = tx.QueryRow(ctx, countQuery, item.ID).Scan(&nextVer)
	version.VersionNumber = nextVer

	metaJSON, _ := json.Marshal(version.Metadata)
	verQuery := `
		INSERT INTO cms_content_versions (
			id, content_item_id, version_number, headline, subheading, body_markdown,
			cta_label, cta_url, image_url, image_alt, seo_meta_title, seo_meta_description,
			seo_canonical_url, metadata, author_id, author_email, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
	`
	_, err = tx.Exec(ctx, verQuery,
		version.ID, item.ID, version.VersionNumber, version.Headline,
		version.Subheading, version.BodyMarkdown, version.CTALabel, version.CTAURL,
		version.ImageURL, version.ImageAlt, version.SEOMetaTitle, version.SEOMetaDescription,
		version.SEOCanonicalURL, metaJSON, version.AuthorID, version.AuthorEmail, now,
	)
	if err != nil {
		return fmt.Errorf("failed to insert version: %w", err)
	}

	return tx.Commit(ctx)
}

func (p *PostgresRepository) Publish(ctx context.Context, itemID string, versionID string, publishedAt time.Time) (*ContentItem, *ContentVersion, error) {
	query := `
		UPDATE cms_content_items
		SET status = 'PUBLISHED', published_version_id = $1, published_at = $2, updated_at = $2
		WHERE id = $3
		RETURNING id, content_type, slug, title, status, published_version_id, published_at, created_at, updated_at
	`
	var it ContentItem
	var ctStr, statusStr string
	err := p.pool.QueryRow(ctx, query, versionID, publishedAt, itemID).Scan(
		&it.ID, &ctStr, &it.Slug, &it.Title, &statusStr, &it.PublishedVersionID, &it.PublishedAt, &it.CreatedAt, &it.UpdatedAt,
	)
	if err != nil {
		return nil, nil, ErrContentNotFound
	}
	it.ContentType = ContentType(ctStr)
	it.Status = ContentStatus(statusStr)

	detail, err := p.GetContentItem(ctx, itemID)
	if err != nil || detail.PublishedVersion == nil {
		return &it, nil, nil
	}
	return &it, detail.PublishedVersion, nil
}

func (p *PostgresRepository) Unpublish(ctx context.Context, itemID string) (*ContentItem, error) {
	query := `
		UPDATE cms_content_items
		SET status = 'DRAFT', published_version_id = NULL, published_at = NULL, updated_at = NOW()
		WHERE id = $1
		RETURNING id, content_type, slug, title, status, published_version_id, published_at, created_at, updated_at
	`
	var it ContentItem
	var ctStr, statusStr string
	err := p.pool.QueryRow(ctx, query, itemID).Scan(
		&it.ID, &ctStr, &it.Slug, &it.Title, &statusStr, &it.PublishedVersionID, &it.PublishedAt, &it.CreatedAt, &it.UpdatedAt,
	)
	if err != nil {
		return nil, ErrContentNotFound
	}
	it.ContentType = ContentType(ctStr)
	it.Status = ContentStatus(statusStr)
	return &it, nil
}

func (p *PostgresRepository) RevertToVersion(ctx context.Context, itemID string, versionNumber int, newVersionID string, authorID, authorEmail string) (*ContentVersion, error) {
	detail, err := p.GetContentItem(ctx, itemID)
	if err != nil {
		return nil, err
	}

	var target *ContentVersion
	for _, v := range detail.Versions {
		if v.VersionNumber == versionNumber {
			target = &v
			break
		}
	}
	if target == nil {
		return nil, ErrVersionNotFound
	}

	metaJSON, _ := json.Marshal(target.Metadata)
	nextVer := len(detail.Versions) + 1
	now := time.Now().UTC()

	verQuery := `
		INSERT INTO cms_content_versions (
			id, content_item_id, version_number, headline, subheading, body_markdown,
			cta_label, cta_url, image_url, image_alt, seo_meta_title, seo_meta_description,
			seo_canonical_url, metadata, author_id, author_email, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
		RETURNING id, content_item_id, version_number, headline, subheading, body_markdown, cta_label, cta_url, image_url, image_alt, seo_meta_title, seo_meta_description, seo_canonical_url, author_id, author_email, created_at
	`
	var reverted ContentVersion
	var sub, body, ctaL, ctaU, imgU, imgA, sTitle, sDesc, sCanon, aEmail *string

	err = p.pool.QueryRow(ctx, verQuery,
		newVersionID, itemID, nextVer, target.Headline, target.Subheading, target.BodyMarkdown,
		target.CTALabel, target.CTAURL, target.ImageURL, target.ImageAlt, target.SEOMetaTitle, target.SEOMetaDescription,
		target.SEOCanonicalURL, metaJSON, authorID, authorEmail, now,
	).Scan(
		&reverted.ID, &reverted.ContentItemID, &reverted.VersionNumber, &reverted.Headline,
		&sub, &body, &ctaL, &ctaU, &imgU, &imgA, &sTitle, &sDesc, &sCanon,
		&reverted.AuthorID, &aEmail, &reverted.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to revert version: %w", err)
	}
	if sub != nil {
		reverted.Subheading = *sub
	}
	if body != nil {
		reverted.BodyMarkdown = *body
	}
	if ctaL != nil {
		reverted.CTALabel = *ctaL
	}
	if ctaU != nil {
		reverted.CTAURL = *ctaU
	}
	if imgU != nil {
		reverted.ImageURL = *imgU
	}
	if imgA != nil {
		reverted.ImageAlt = *imgA
	}
	if sTitle != nil {
		reverted.SEOMetaTitle = *sTitle
	}
	if sDesc != nil {
		reverted.SEOMetaDescription = *sDesc
	}
	if sCanon != nil {
		reverted.SEOCanonicalURL = *sCanon
	}
	if aEmail != nil {
		reverted.AuthorEmail = *aEmail
	}
	reverted.Metadata = target.Metadata

	_, _ = p.pool.Exec(ctx, `UPDATE cms_content_items SET updated_at = $1 WHERE id = $2`, now, itemID)
	return &reverted, nil
}

func (p *PostgresRepository) CreateMediaAsset(ctx context.Context, asset *MediaAsset) error {
	query := `
		INSERT INTO cms_media_assets (id, filename, content_type, file_size_bytes, storage_path, public_url, alt_text, uploader_id, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`
	_, err := p.pool.Exec(ctx, query,
		asset.ID, asset.Filename, asset.ContentType, asset.FileSizeBytes,
		asset.StoragePath, asset.PublicURL, asset.AltText, asset.UploaderID, asset.CreatedAt,
	)
	return err
}

func (p *PostgresRepository) ListMediaAssets(ctx context.Context, limit int) ([]MediaAsset, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := `SELECT id, filename, content_type, file_size_bytes, storage_path, public_url, alt_text, uploader_id, created_at FROM cms_media_assets ORDER BY created_at DESC LIMIT $1`
	rows, err := p.pool.Query(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []MediaAsset
	for rows.Next() {
		var a MediaAsset
		err := rows.Scan(
			&a.ID, &a.Filename, &a.ContentType, &a.FileSizeBytes,
			&a.StoragePath, &a.PublicURL, &a.AltText, &a.UploaderID, &a.CreatedAt,
		)
		if err == nil {
			result = append(result, a)
		}
	}
	return result, nil
}

func (p *PostgresRepository) RecordAudit(ctx context.Context, record *CMSAuditRecord) error {
	detailsJSON, _ := json.Marshal(record.Details)
	query := `
		INSERT INTO cms_audit_trail (id, content_item_id, action, actor_id, actor_email, details, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	_, err := p.pool.Exec(ctx, query,
		record.ID, record.ContentItemID, record.Action,
		record.ActorID, record.ActorEmail, detailsJSON, record.CreatedAt,
	)
	return err
}

func (p *PostgresRepository) ListAuditRecords(ctx context.Context, limit int) ([]CMSAuditRecord, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := `SELECT id, content_item_id, action, actor_id, actor_email, details, created_at FROM cms_audit_trail ORDER BY created_at DESC LIMIT $1`
	rows, err := p.pool.Query(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []CMSAuditRecord
	for rows.Next() {
		var r CMSAuditRecord
		var dBytes []byte
		err := rows.Scan(
			&r.ID, &r.ContentItemID, &r.Action, &r.ActorID, &r.ActorEmail, &dBytes, &r.CreatedAt,
		)
		if err == nil {
			if len(dBytes) > 0 {
				_ = json.Unmarshal(dBytes, &r.Details)
			}
			result = append(result, r)
		}
	}
	return result, nil
}
