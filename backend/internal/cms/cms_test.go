package cms

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/auradating/platform/backend/internal/identity"
)

func TestCMS_Service_Workflows(t *testing.T) {
	ctx := context.Background()
	repo := NewMemoryRepository()
	svc := NewService(repo, t.TempDir(), nil)

	editor := &identity.AuthUser{
		ID:    "usr_editor_01",
		Email: "editor@auradating.com",
		Role:  identity.RoleEditorialCMS,
	}

	// 1. Initial seeded content verification
	items, err := svc.ListContent(ctx, "")
	if err != nil {
		t.Fatalf("failed to list content items: %v", err)
	}
	if len(items) < 5 {
		t.Errorf("expected at least 5 seeded items, got %d", len(items))
	}

	// 2. Fetch public homepage hero
	pubItem, pubVer, err := svc.GetPublicContent(ctx, "homepage.hero")
	if err != nil {
		t.Fatalf("failed to get public hero: %v", err)
	}
	if pubItem.Status != StatusPublished {
		t.Errorf("expected status PUBLISHED, got %s", pubItem.Status)
	}
	if !strings.Contains(pubVer.Headline, "LGBTQ+") {
		t.Errorf("expected headline to contain LGBTQ+, got %q", pubVer.Headline)
	}

	// 3. Save draft edit
	draftReq := SaveDraftRequest{
		Headline:           "Updated Luxury LGBTQ+ Matchmaking",
		Subheading:         "Revised intentional sanctuary copy",
		BodyMarkdown:       "Updated body markdown description.",
		CTALabel:           "Join the Circle",
		CTAURL:             "/auth/register",
		ImageURL:           "https://images.unsplash.com/photo-1517841905240-472988babdf9",
		ImageAlt:           "Revised alt text",
		SEOMetaTitle:       "Aura Dating | Authentic, Safe LGBTQ+ Relationships",
		SEOMetaDescription: "Experience safe, authentic LGBTQ+ dating with photo verification.",
		SEOCanonicalURL:    "https://www.auradating.com/",
	}

	detail, err := svc.SaveDraft(ctx, "homepage.hero", draftReq, editor)
	if err != nil {
		t.Fatalf("failed to save draft: %v", err)
	}
	if detail.CurrentVersion == nil || detail.CurrentVersion.Headline != "Updated Luxury LGBTQ+ Matchmaking" {
		t.Errorf("expected current draft headline to match, got %v", detail.CurrentVersion)
	}
	if detail.CurrentVersion.VersionNumber != 2 {
		t.Errorf("expected version number 2, got %d", detail.CurrentVersion.VersionNumber)
	}

	// 4. Public content remains untouched before publish (draft isolation)
	_, untouchedPubVer, _ := svc.GetPublicContent(ctx, "homepage.hero")
	if untouchedPubVer.Headline == "Updated Luxury LGBTQ+ Matchmaking" {
		t.Errorf("draft change leaked to public view before publishing!")
	}

	// 5. Publish draft
	publishedDetail, err := svc.Publish(ctx, "homepage.hero", detail.CurrentVersion.ID, editor)
	if err != nil {
		t.Fatalf("failed to publish draft: %v", err)
	}
	if publishedDetail.Item.Status != StatusPublished {
		t.Errorf("expected status PUBLISHED, got %s", publishedDetail.Item.Status)
	}

	// 6. Verify public view is now updated
	_, liveVer, err := svc.GetPublicContent(ctx, "/")
	if err != nil {
		t.Fatalf("failed to get live published content by slug: %v", err)
	}
	if liveVer.Headline != "Updated Luxury LGBTQ+ Matchmaking" {
		t.Errorf("expected live headline to be updated, got %q", liveVer.Headline)
	}

	// 7. Revert to Version 1
	revertedDetail, err := svc.RevertToVersion(ctx, "homepage.hero", 1, editor)
	if err != nil {
		t.Fatalf("failed to revert to version 1: %v", err)
	}
	if revertedDetail.CurrentVersion.Headline != "Where Intentional LGBTQ+ Connections Begin" {
		t.Errorf("expected reverted headline from version 1, got %q", revertedDetail.CurrentVersion.Headline)
	}

	// 8. Audit trail
	auditRecords, err := svc.ListAuditTrail(ctx, 10)
	if err != nil {
		t.Fatalf("failed to list audit trail: %v", err)
	}
	if len(auditRecords) < 3 {
		t.Errorf("expected at least 3 audit records, got %d", len(auditRecords))
	}
}

func TestCMS_MediaUpload_Validation(t *testing.T) {
	ctx := context.Background()
	repo := NewMemoryRepository()
	tempDir := t.TempDir()
	svc := NewService(repo, tempDir, nil)

	editor := &identity.AuthUser{
		ID:    "usr_editor_01",
		Email: "editor@auradating.com",
		Role:  identity.RoleEditorialCMS,
	}

	// 1. Valid PNG upload
	img := image.NewRGBA(image.Rect(0, 0, 100, 100))
	img.Set(50, 50, color.RGBA{R: 195, G: 161, B: 91, A: 255})
	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, img); err != nil {
		t.Fatalf("failed to encode png: %v", err)
	}

	asset, err := svc.UploadMarketingMedia(ctx, "banner.png", &pngBuf, int64(pngBuf.Len()), "Gold marketing banner", editor)
	if err != nil {
		t.Fatalf("failed to upload valid png: %v", err)
	}
	if asset.ContentType != "image/png" {
		t.Errorf("expected content type image/png, got %s", asset.ContentType)
	}
	if !strings.HasPrefix(asset.PublicURL, "/uploads/marketing/") {
		t.Errorf("expected public url in /uploads/marketing/, got %s", asset.PublicURL)
	}

	// 2. Reject executable / non-image file masquerading as image
	fakeBytes := []byte("MZ\x90\x00\x03\x00\x00\x00executable-content")
	_, err = svc.UploadMarketingMedia(ctx, "malicious.jpg", bytes.NewReader(fakeBytes), int64(len(fakeBytes)), "Fake", editor)
	if err == nil {
		t.Fatalf("expected error uploading executable file, got nil")
	}
}

func TestCMS_Handler_RBAC(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewService(repo, t.TempDir(), nil)
	handler := NewHandler(svc, nil)

	// Public endpoint without auth succeeds
	req := httptest.NewRequest(http.MethodGet, "/api/v1/cms/public?key=homepage.hero", nil)
	rr := httptest.NewRecorder()
	handler.GetPublicContent(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 OK on public cms endpoint, got %d", rr.Code)
	}

	// Admin endpoint without auth fails with 401
	adminReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/cms/content", nil)
	adminRR := httptest.NewRecorder()
	handler.AdminContent(adminRR, adminReq)
	if adminRR.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 on unauthenticated admin cms request, got %d", adminRR.Code)
	}
}
