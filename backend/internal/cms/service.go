package cms

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/auradating/platform/backend/internal/identity"
)

type Service struct {
	repo         Repository
	mediaBaseDir string
	logger       *slog.Logger
}

func NewService(repo Repository, mediaBaseDir string, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	if mediaBaseDir == "" {
		mediaBaseDir = filepath.Join("web", "public", "uploads", "marketing")
	}
	_ = os.MkdirAll(mediaBaseDir, 0755)

	return &Service{
		repo:         repo,
		mediaBaseDir: mediaBaseDir,
		logger:       logger,
	}
}

func (s *Service) ListContent(ctx context.Context, statusFilter string) ([]ContentItem, error) {
	return s.repo.ListContentItems(ctx, statusFilter)
}

func (s *Service) GetContentDetail(ctx context.Context, id string) (*ContentItemDetail, error) {
	return s.repo.GetContentItem(ctx, id)
}

func (s *Service) GetPublicContent(ctx context.Context, slugOrID string) (*ContentItem, *ContentVersion, error) {
	if strings.HasPrefix(slugOrID, "/") {
		return s.repo.GetPublishedBySlug(ctx, slugOrID)
	}
	// Try by ID first, fallback to slug
	item, ver, err := s.repo.GetPublishedByID(ctx, slugOrID)
	if err == nil {
		return item, ver, nil
	}
	return s.repo.GetPublishedBySlug(ctx, "/"+strings.TrimPrefix(slugOrID, "/"))
}

func (s *Service) SaveDraft(ctx context.Context, id string, req SaveDraftRequest, actor *identity.AuthUser) (*ContentItemDetail, error) {
	if strings.TrimSpace(id) == "" {
		return nil, fmt.Errorf("content item ID cannot be empty")
	}

	detail, err := s.repo.GetContentItem(ctx, id)
	var item *ContentItem
	if err != nil {
		// New item
		slug := "/" + strings.TrimPrefix(id, "landing.")
		slug = strings.TrimPrefix(slug, "intent.")
		item = &ContentItem{
			ID:          id,
			ContentType: TypePageSection,
			Slug:        slug,
			Title:       id,
			Status:      StatusDraft,
			CreatedAt:   time.Now().UTC(),
			UpdatedAt:   time.Now().UTC(),
		}
	} else {
		it := detail.Item
		item = &it
	}

	verID := fmt.Sprintf("ver_%d_%s", time.Now().Unix(), generateRandomString(6))
	version := &ContentVersion{
		ID:                 verID,
		ContentItemID:      id,
		Headline:           req.Headline,
		Subheading:         req.Subheading,
		BodyMarkdown:       req.BodyMarkdown,
		CTALabel:           req.CTALabel,
		CTAURL:             req.CTAURL,
		ImageURL:           req.ImageURL,
		ImageAlt:           req.ImageAlt,
		SEOMetaTitle:       req.SEOMetaTitle,
		SEOMetaDescription: req.SEOMetaDescription,
		SEOCanonicalURL:    req.SEOCanonicalURL,
		Metadata:           req.Metadata,
		AuthorID:           actor.ID,
		AuthorEmail:        actor.Email,
		CreatedAt:          time.Now().UTC(),
	}

	if err := s.repo.SaveDraft(ctx, item, version); err != nil {
		return nil, fmt.Errorf("failed to save draft: %w", err)
	}

	_ = s.repo.RecordAudit(ctx, &CMSAuditRecord{
		ID:            fmt.Sprintf("aud_%d_%s", time.Now().Unix(), generateRandomString(6)),
		ContentItemID: id,
		Action:        "DRAFT_SAVED",
		ActorID:       actor.ID,
		ActorEmail:    actor.Email,
		Details: map[string]any{
			"version_id":     verID,
			"headline":       req.Headline,
			"version_number": version.VersionNumber,
		},
		CreatedAt: time.Now().UTC(),
	})

	return s.repo.GetContentItem(ctx, id)
}

func (s *Service) Publish(ctx context.Context, id string, versionID string, actor *identity.AuthUser) (*ContentItemDetail, error) {
	detail, err := s.repo.GetContentItem(ctx, id)
	if err != nil {
		return nil, err
	}

	targetVerID := versionID
	if targetVerID == "" {
		if detail.CurrentVersion == nil {
			return nil, fmt.Errorf("no version available to publish")
		}
		targetVerID = detail.CurrentVersion.ID
	}

	// Validate slug uniqueness among other published items
	existingBySlug, _, err := s.repo.GetPublishedBySlug(ctx, detail.Item.Slug)
	if err == nil && existingBySlug != nil && existingBySlug.ID != id {
		return nil, ErrDuplicateSlug
	}

	_, _, err = s.repo.Publish(ctx, id, targetVerID, time.Now().UTC())
	if err != nil {
		return nil, err
	}

	_ = s.repo.RecordAudit(ctx, &CMSAuditRecord{
		ID:            fmt.Sprintf("aud_%d_%s", time.Now().Unix(), generateRandomString(6)),
		ContentItemID: id,
		Action:        "PUBLISHED",
		ActorID:       actor.ID,
		ActorEmail:    actor.Email,
		Details: map[string]any{
			"published_version_id": targetVerID,
			"slug":                 detail.Item.Slug,
		},
		CreatedAt: time.Now().UTC(),
	})

	return s.repo.GetContentItem(ctx, id)
}

func (s *Service) Unpublish(ctx context.Context, id string, actor *identity.AuthUser) (*ContentItemDetail, error) {
	_, err := s.repo.Unpublish(ctx, id)
	if err != nil {
		return nil, err
	}

	_ = s.repo.RecordAudit(ctx, &CMSAuditRecord{
		ID:            fmt.Sprintf("aud_%d_%s", time.Now().Unix(), generateRandomString(6)),
		ContentItemID: id,
		Action:        "UNPUBLISHED",
		ActorID:       actor.ID,
		ActorEmail:    actor.Email,
		CreatedAt:     time.Now().UTC(),
	})

	return s.repo.GetContentItem(ctx, id)
}

func (s *Service) RevertToVersion(ctx context.Context, id string, versionNumber int, actor *identity.AuthUser) (*ContentItemDetail, error) {
	newVerID := fmt.Sprintf("ver_%d_%s", time.Now().Unix(), generateRandomString(6))
	_, err := s.repo.RevertToVersion(ctx, id, versionNumber, newVerID, actor.ID, actor.Email)
	if err != nil {
		return nil, err
	}

	_ = s.repo.RecordAudit(ctx, &CMSAuditRecord{
		ID:            fmt.Sprintf("aud_%d_%s", time.Now().Unix(), generateRandomString(6)),
		ContentItemID: id,
		Action:        "REVERTED",
		ActorID:       actor.ID,
		ActorEmail:    actor.Email,
		Details: map[string]any{
			"reverted_to_version": versionNumber,
			"new_version_id":      newVerID,
		},
		CreatedAt: time.Now().UTC(),
	})

	return s.repo.GetContentItem(ctx, id)
}

func (s *Service) UploadMarketingMedia(ctx context.Context, filename string, reader io.Reader, sizeBytes int64, altText string, actor *identity.AuthUser) (*MediaAsset, error) {
	const maxMarketingFileSize = 10 * 1024 * 1024 // 10 MB
	if sizeBytes > maxMarketingFileSize {
		return nil, ErrFileTooLarge
	}

	buf := new(bytes.Buffer)
	n, err := io.CopyN(buf, reader, maxMarketingFileSize+1)
	if err != nil && err != io.EOF {
		return nil, fmt.Errorf("failed to read media stream: %w", err)
	}
	if n > maxMarketingFileSize {
		return nil, ErrFileTooLarge
	}

	data := buf.Bytes()
	mimeType := detectSafeImageMime(data)
	if mimeType == "" {
		return nil, ErrInvalidFileType
	}

	// Verify image decodability
	_, _, err = image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("image verification failed: %w", err)
	}

	// Determine file extension
	ext := ".jpg"
	switch mimeType {
	case "image/png":
		ext = ".png"
	case "image/webp":
		ext = ".webp"
	}

	assetID := fmt.Sprintf("ast_cms_%d_%s", time.Now().Unix(), generateRandomString(6))
	diskFilename := assetID + ext
	filePath := filepath.Join(s.mediaBaseDir, diskFilename)

	// Save to dedicated public marketing asset path
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return nil, fmt.Errorf("failed to persist marketing asset to disk: %w", err)
	}

	publicURL := "/uploads/marketing/" + diskFilename
	asset := &MediaAsset{
		ID:            assetID,
		Filename:      filename,
		ContentType:   mimeType,
		FileSizeBytes: int64(len(data)),
		StoragePath:   filePath,
		PublicURL:     publicURL,
		AltText:       altText,
		UploaderID:    actor.ID,
		CreatedAt:     time.Now().UTC(),
	}

	if err := s.repo.CreateMediaAsset(ctx, asset); err != nil {
		return nil, fmt.Errorf("failed to save asset metadata: %w", err)
	}

	_ = s.repo.RecordAudit(ctx, &CMSAuditRecord{
		ID:            fmt.Sprintf("aud_%d_%s", time.Now().Unix(), generateRandomString(6)),
		ContentItemID: assetID,
		Action:        "MEDIA_UPLOADED",
		ActorID:       actor.ID,
		ActorEmail:    actor.Email,
		Details: map[string]any{
			"filename":   filename,
			"public_url": publicURL,
			"mime_type":  mimeType,
			"size_bytes": asset.FileSizeBytes,
		},
		CreatedAt: time.Now().UTC(),
	})

	return asset, nil
}

func (s *Service) ListMedia(ctx context.Context, limit int) ([]MediaAsset, error) {
	return s.repo.ListMediaAssets(ctx, limit)
}

func (s *Service) ListAuditTrail(ctx context.Context, limit int) ([]CMSAuditRecord, error) {
	return s.repo.ListAuditRecords(ctx, limit)
}

func detectSafeImageMime(data []byte) string {
	if len(data) < 12 {
		return ""
	}
	// JPEG: FF D8 FF
	if data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		return "image/jpeg"
	}
	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 {
		return "image/png"
	}
	// WebP: RIFF .... WEBP
	if string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		return "image/webp"
	}
	return ""
}

func generateRandomString(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
