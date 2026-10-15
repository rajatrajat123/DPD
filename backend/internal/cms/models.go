package cms

import (
	"errors"
	"time"
)

var (
	ErrContentNotFound   = errors.New("cms content item not found")
	ErrVersionNotFound   = errors.New("cms content version not found")
	ErrInvalidSlug       = errors.New("invalid or reserved url slug")
	ErrDuplicateSlug     = errors.New("published content item with this slug already exists")
	ErrInvalidFileType   = errors.New("only JPEG, PNG, and WebP images are permitted for marketing assets")
	ErrFileTooLarge      = errors.New("uploaded marketing image exceeds maximum allowed size (10 MB)")
	ErrUnpublishedItem   = errors.New("content item is not currently published")
)

type ContentType string

const (
	TypeHeroBanner   ContentType = "HERO_BANNER"
	TypePageSection  ContentType = "PAGE_SECTION"
	TypeNavMenu      ContentType = "NAV_MENU"
	TypeIntentPage   ContentType = "INTENT_PAGE"
	TypeInfoPage     ContentType = "PAGE"
)

type ContentStatus string

const (
	StatusDraft     ContentStatus = "DRAFT"
	StatusPublished ContentStatus = "PUBLISHED"
	StatusArchived  ContentStatus = "ARCHIVED"
)

// ContentItem represents a top-level CMS manageable entity.
type ContentItem struct {
	ID                 string        `json:"id"`
	ContentType        ContentType   `json:"content_type"`
	Slug               string        `json:"slug"`
	Title              string        `json:"title"`
	Status             ContentStatus `json:"status"`
	PublishedVersionID *string       `json:"published_version_id,omitempty"`
	PublishedAt        *time.Time    `json:"published_at,omitempty"`
	CreatedAt          time.Time     `json:"created_at"`
	UpdatedAt          time.Time     `json:"updated_at"`
}

// ContentVersion represents an immutable revision of a content item.
type ContentVersion struct {
	ID                 string         `json:"id"`
	ContentItemID      string         `json:"content_item_id"`
	VersionNumber      int            `json:"version_number"`
	Headline           string         `json:"headline"`
	Subheading         string         `json:"subheading,omitempty"`
	BodyMarkdown       string         `json:"body_markdown,omitempty"`
	CTALabel           string         `json:"cta_label,omitempty"`
	CTAURL             string         `json:"cta_url,omitempty"`
	ImageURL           string         `json:"image_url,omitempty"`
	ImageAlt           string         `json:"image_alt,omitempty"`
	SEOMetaTitle       string         `json:"seo_meta_title,omitempty"`
	SEOMetaDescription string         `json:"seo_meta_description,omitempty"`
	SEOCanonicalURL    string         `json:"seo_canonical_url,omitempty"`
	Metadata           map[string]any `json:"metadata,omitempty"`
	AuthorID           string         `json:"author_id"`
	AuthorEmail        string         `json:"author_email,omitempty"`
	CreatedAt          time.Time      `json:"created_at"`
}

// MediaAsset represents a public marketing image uploaded via the CMS.
type MediaAsset struct {
	ID            string    `json:"id"`
	Filename      string    `json:"filename"`
	ContentType   string    `json:"content_type"`
	FileSizeBytes int64     `json:"file_size_bytes"`
	StoragePath   string    `json:"storage_path"`
	PublicURL     string    `json:"public_url"`
	AltText       string    `json:"alt_text"`
	UploaderID    string    `json:"uploader_id"`
	CreatedAt     time.Time `json:"created_at"`
}

// CMSAuditRecord logs an audit trail of changes made to CMS content.
type CMSAuditRecord struct {
	ID            string         `json:"id"`
	ContentItemID string         `json:"content_item_id"`
	Action        string         `json:"action"` // DRAFT_SAVED, PUBLISHED, UNPUBLISHED, REVERTED, MEDIA_UPLOADED
	ActorID       string         `json:"actor_id"`
	ActorEmail    string         `json:"actor_email"`
	Details       map[string]any `json:"details,omitempty"`
	CreatedAt     time.Time      `json:"created_at"`
}

// ContentItemDetail is returned to the admin console with item, active draft, published version, and history.
type ContentItemDetail struct {
	Item             ContentItem      `json:"item"`
	CurrentVersion   *ContentVersion  `json:"current_version,omitempty"`
	PublishedVersion *ContentVersion  `json:"published_version,omitempty"`
	Versions         []ContentVersion `json:"versions,omitempty"`
}

// SaveDraftRequest is the incoming payload for creating or updating a draft revision.
type SaveDraftRequest struct {
	Headline           string         `json:"headline"`
	Subheading         string         `json:"subheading,omitempty"`
	BodyMarkdown       string         `json:"body_markdown,omitempty"`
	CTALabel           string         `json:"cta_label,omitempty"`
	CTAURL             string         `json:"cta_url,omitempty"`
	ImageURL           string         `json:"image_url,omitempty"`
	ImageAlt           string         `json:"image_alt,omitempty"`
	SEOMetaTitle       string         `json:"seo_meta_title,omitempty"`
	SEOMetaDescription string         `json:"seo_meta_description,omitempty"`
	SEOCanonicalURL    string         `json:"seo_canonical_url,omitempty"`
	Metadata           map[string]any `json:"metadata,omitempty"`
}
