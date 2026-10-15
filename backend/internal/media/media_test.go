package media_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/media"
)

func setupTestMedia(t *testing.T) (*media.Service, *media.FileStorageEngine, string) {
	t.Helper()
	tempDir := t.TempDir()
	storage, err := media.NewFileStorageEngine(tempDir, "test-media-signing-secret-key-32b-long")
	if err != nil {
		t.Fatalf("failed to create test storage engine: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	processor := media.NewProcessor(logger, 15*1024*1024, 100*1024*1024)
	repo := media.NewMemoryRepository()
	svc := media.NewService(repo, storage, processor, logger)
	t.Cleanup(func() {
		svc.Stop()
	})

	return svc, storage, tempDir
}

func TestProcessor_MagicBytesAndPolyglotDefense(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	proc := media.NewProcessor(logger, 15*1024*1024, 100*1024*1024)

	tests := []struct {
		name      string
		header    []byte
		wantMime  string
		wantError error
	}{
		{
			name:     "valid jpeg header",
			header:   []byte("\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x01"),
			wantMime: "image/jpeg",
		},
		{
			name:     "valid png header",
			header:   []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"),
			wantMime: "image/png",
		},
		{
			name:     "valid webp header",
			header:   []byte("RIFF\x20\x00\x00\x00WEBPVP8 "),
			wantMime: "image/webp",
		},
		{
			name:     "valid gif header",
			header:   []byte("GIF89a\x01\x00\x01\x00\x80\x00\x00"),
			wantMime: "image/gif",
		},
		{
			name:     "valid mp4 container",
			header:   []byte("\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00"),
			wantMime: "video/mp4",
		},
		{
			name:     "valid webm container",
			header:   []byte("\x1A\x45\xDF\xA3\x9F\x42\x86\x81\x01\x42\xF7\x81"),
			wantMime: "video/webm",
		},
		{
			name:      "polyglot with php script tag",
			header:    []byte("\xFF\xD8\xFF\xE0<?php phpinfo(); ?>"),
			wantError: media.ErrPolyglotDetected,
		},
		{
			name:      "polyglot with html script tag",
			header:    []byte("\xFF\xD8\xFF\xE0<script>alert(1)</script>"),
			wantError: media.ErrPolyglotDetected,
		},
		{
			name:      "executable ELF marker",
			header:    []byte("\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00"),
			wantError: media.ErrPolyglotDetected,
		},
		{
			name:      "windows PE executable marker",
			header:    []byte("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00"),
			wantError: media.ErrPolyglotDetected,
		},
		{
			name:      "random junk",
			header:    []byte("abcdefghijklmnop"),
			wantError: media.ErrUnsupportedFormat,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sniffed, err := proc.SniffAndValidate(tc.header)
			if tc.wantError != nil {
				if err == nil || err != tc.wantError {
					t.Fatalf("expected error %v, got %v", tc.wantError, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if sniffed.MimeType != tc.wantMime {
				t.Errorf("expected mime %s, got %s", tc.wantMime, sniffed.MimeType)
			}
		})
	}
}

func TestProcessor_ImageRasterRecreationAndStripping(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	proc := media.NewProcessor(logger, 15*1024*1024, 100*1024*1024)

	// Valid 600x800 JPEG test image
	testJPEG := media.GenerateTestJPEG(600, 800)

	result, err := proc.ProcessImage(context.Background(), testJPEG, media.PurposeProfileGallery)
	if err != nil {
		t.Fatalf("unexpected processing failure: %v", err)
	}

	if !result.ExifStripped {
		t.Errorf("expected exif_stripped to be true")
	}
	if *result.WidthPx != 600 || *result.HeightPx != 800 {
		t.Errorf("expected dimensions 600x800, got %dx%d", *result.WidthPx, *result.HeightPx)
	}
	if result.ModerationVerdict != media.VerdictApproved {
		t.Errorf("expected approved verdict, got %s", result.ModerationVerdict)
	}
	if len(result.Derivatives) != 3 {
		t.Fatalf("expected 3 derivatives (thumb, card, full), got %d", len(result.Derivatives))
	}

	// Verify thumb derivative
	thumb := result.Derivatives[0]
	if thumb.Variant != media.VariantThumbWebP || thumb.Width != 160 || thumb.Height != 160 {
		t.Errorf("invalid thumb variant: %+v", thumb)
	}
}

func TestProcessor_DimensionLimits(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	proc := media.NewProcessor(logger, 15*1024*1024, 100*1024*1024)

	// Image too small for profile gallery (< 100x100)
	smallJPEG := media.GenerateTestJPEG(50, 50)
	_, err := proc.ProcessImage(context.Background(), smallJPEG, media.PurposeProfileGallery)
	if err == nil || err != media.ErrImageDimensionTooSmall {
		t.Fatalf("expected ErrImageDimensionTooSmall, got %v", err)
	}
}

func TestStorageEngine_PathTraversalAndSigning(t *testing.T) {
	tempDir := t.TempDir()
	storage, err := media.NewFileStorageEngine(tempDir, "test-secret-32b-length-must-be-long")
	if err != nil {
		t.Fatalf("storage engine init error: %v", err)
	}

	// Path traversal attempts must fail
	traversalKeys := []string{
		"../secret.txt",
		"../../windows/system32/cmd.exe",
		"foo/../../bar",
		"C:\\boot.ini",
		"/etc/passwd",
		"sub/key\x00null",
	}

	ctx := context.Background()
	for _, key := range traversalKeys {
		err := storage.SaveQuarantine(ctx, key, bytes.NewReader([]byte("test")), 4)
		if err == nil {
			t.Errorf("expected path traversal defense to block key %q, but succeeded", key)
		}
	}

	// Token Signing Verification
	token, exp := storage.GenerateSignedToken("approved", "user123/asset456/thumb.jpg", 1*time.Hour)
	if token == "" || exp.Before(time.Now()) {
		t.Fatalf("invalid generated token")
	}

	// Verify valid token
	if !storage.VerifySignedToken("approved", "user123/asset456/thumb.jpg", token) {
		t.Errorf("valid token failed verification")
	}

	// Tampered key must fail
	if storage.VerifySignedToken("approved", "user123/asset456/card.jpg", token) {
		t.Errorf("tampered key unexpectedly passed verification")
	}

	// Expired token must fail
	expiredToken, _ := storage.GenerateSignedToken("approved", "user123/asset456/thumb.jpg", -10*time.Second)
	if storage.VerifySignedToken("approved", "user123/asset456/thumb.jpg", expiredToken) {
		t.Errorf("expired token unexpectedly passed verification")
	}
}

func TestService_DirectUploadAndDeliveryPipeline(t *testing.T) {
	svc, _, _ := setupTestMedia(t)
	ctx := context.Background()

	testJPEG := media.GenerateTestJPEG(500, 700)
	userID := "user-uuid-1010"

	// Direct upload image
	resp, err := svc.UploadDirect(
		ctx,
		userID,
		string(media.PurposeProfileGallery),
		string(media.MediaTypeImage),
		"avatar.jpg",
		bytes.NewReader(testJPEG),
		int64(len(testJPEG)),
		"test-idempotency-key-01",
	)
	if err != nil {
		t.Fatalf("direct upload failed: %v", err)
	}

	if resp.Status != media.StatusReady {
		t.Errorf("expected status READY, got %s", resp.Status)
	}
	if !resp.ExifStripped {
		t.Errorf("expected exif_stripped == true")
	}
	if len(resp.Derivatives) != 3 {
		t.Fatalf("expected 3 derivatives, got %d", len(resp.Derivatives))
	}

	// Idempotency check: repeated upload with same key returns identical asset
	repeatResp, err := svc.UploadDirect(
		ctx,
		userID,
		string(media.PurposeProfileGallery),
		string(media.MediaTypeImage),
		"avatar.jpg",
		bytes.NewReader(testJPEG),
		int64(len(testJPEG)),
		"test-idempotency-key-01",
	)
	if err != nil {
		t.Fatalf("idempotent repeat upload failed: %v", err)
	}
	if repeatResp.ID != resp.ID {
		t.Errorf("idempotency failed: got different IDs %s vs %s", repeatResp.ID, resp.ID)
	}

	// List gallery for user
	gallery, err := svc.ListUserGallery(ctx, userID)
	if err != nil {
		t.Fatalf("failed to list user gallery: %v", err)
	}
	if len(gallery) != 1 || gallery[0].ID != resp.ID {
		t.Errorf("gallery listing mismatch: got %d items", len(gallery))
	}

	// Unauthorized non-owner cannot view non-ready media
	otherUser := "user-uuid-9999"
	viewResp, err := svc.GetAssetWithDerivatives(ctx, resp.ID, otherUser)
	if err != nil {
		t.Fatalf("other user should view READY approved media: %v", err)
	}
	if viewResp.ID != resp.ID {
		t.Errorf("view response ID mismatch")
	}

	// Delete asset
	if err := svc.DeleteAsset(ctx, resp.ID, userID); err != nil {
		t.Fatalf("failed to delete asset: %v", err)
	}

	// Deleted asset should be purged and inaccessible
	_, err = svc.GetAssetWithDerivatives(ctx, resp.ID, userID)
	if err == nil {
		t.Errorf("expected error after deleting asset, got nil")
	}
}

func TestProcessor_UntranscodedVideoNeverMarkedReady(t *testing.T) {
	svc, _, _ := setupTestMedia(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	proc := media.NewProcessor(logger, 15*1024*1024, 100*1024*1024)

	// Minimal MP4 container header
	dummyMP4 := make([]byte, 1024)
	copy(dummyMP4[0:4], []byte{0x00, 0x00, 0x04, 0x00}) // Box size
	copy(dummyMP4[4:8], []byte("ftyp"))
	copy(dummyMP4[8:12], []byte("mp42"))

	// 1. Processor level: ProcessVideo without ffmpeg must return ErrTranscodingWorkerUnavailable
	// and MUST NOT return fake derivatives or mark as ready.
	res, err := proc.ProcessVideo(context.Background(), dummyMP4, media.PurposeProfileGallery)
	if err == nil {
		t.Fatalf("expected ErrTranscodingWorkerUnavailable, got nil")
	}
	if err != media.ErrTranscodingWorkerUnavailable {
		t.Fatalf("expected ErrTranscodingWorkerUnavailable, got %v", err)
	}
	if res != nil {
		t.Fatalf("expected nil result on unavailable transcoder, got %+v", res)
	}

	// 2. Service level: direct upload of video without ffmpeg leaves asset in PROCESSING, not READY
	ctx := context.Background()
	_, upErr := svc.UploadDirect(
		ctx,
		"user-vid-1",
		string(media.PurposeProfileGallery),
		string(media.MediaTypeVideo),
		"clip.mp4",
		bytes.NewReader(dummyMP4),
		int64(len(dummyMP4)),
		"test-video-idempotent-key",
	)
	if upErr == nil {
		t.Fatalf("expected direct upload to fail when ffmpeg is unavailable, got nil")
	}
	if upErr != media.ErrTranscodingWorkerUnavailable {
		t.Fatalf("expected ErrTranscodingWorkerUnavailable, got %v", upErr)
	}
}

func TestHandler_HTTPRoutes(t *testing.T) {
	svc, storage, _ := setupTestMedia(t)
	handler := media.NewHandler(svc, storage)

	jwtSecret := "test-jwt-secret-key-32b-must-be-long-enough"
	authMw := identity.RequireAuth(jwtSecret)

	testUser := &identity.User{
		ID:    "user-authed-1",
		Email: "test@auradating.com",
		Role:  identity.RoleMember,
	}
	accessToken, err := identity.GenerateAccessToken(jwtSecret, testUser, 1*time.Hour)
	if err != nil {
		t.Fatalf("token gen error: %v", err)
	}

	mux := http.NewServeMux()
	mux.Handle("/api/v1/media/upload", authMw(http.HandlerFunc(handler.Upload)))
	mux.Handle("/api/v1/media/upload-intent", authMw(http.HandlerFunc(handler.CreateUploadIntent)))
	mux.Handle("/api/v1/media/gallery/me", authMw(http.HandlerFunc(handler.ListMyGallery)))
	mux.HandleFunc("/api/v1/media/stream/", handler.Stream)

	// 1. Upload direct via HTTP multipart
	body := new(bytes.Buffer)
	mpWriter := multipart.NewWriter(body)
	_ = mpWriter.WriteField("purpose", "PROFILE_GALLERY")
	part, _ := mpWriter.CreateFormFile("file", "test.jpg")
	_, _ = part.Write(media.GenerateTestJPEG(450, 450))
	_ = mpWriter.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/media/upload", body)
	req.Header.Set("Content-Type", mpWriter.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+accessToken)
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created on upload, got %d: %s", rec.Code, rec.Body.String())
	}

	var uploadResp media.MediaAssetResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &uploadResp); err != nil {
		t.Fatalf("failed to decode upload response: %v", err)
	}

	if uploadResp.Status != media.StatusReady {
		t.Errorf("expected status READY, got %s", uploadResp.Status)
	}
	if len(uploadResp.Derivatives) == 0 {
		t.Fatalf("expected derivatives in response")
	}

	streamURL := uploadResp.Derivatives[0].URL
	if streamURL == "" {
		t.Fatalf("expected stream URL")
	}

	// 2. Stream derivative with valid signed token
	streamReq := httptest.NewRequest(http.MethodGet, streamURL, nil)
	streamRec := httptest.NewRecorder()
	mux.ServeHTTP(streamRec, streamReq)

	if streamRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on signed stream, got %d: %s", streamRec.Code, streamRec.Body.String())
	}
	if streamRec.Header().Get("Content-Type") != "image/webp" && streamRec.Header().Get("Content-Type") != "image/jpeg" {
		t.Errorf("expected Content-Type image/webp or image/jpeg, got %s", streamRec.Header().Get("Content-Type"))
	}
	if streamRec.Header().Get("Cache-Control") != "private, max-age=3600" {
		t.Errorf("expected Cache-Control private, max-age=3600, got %s", streamRec.Header().Get("Cache-Control"))
	}

	// 3. Stream with invalid token -> 403 Forbidden
	tamperedURL := streamURL + "-invalid"
	badReq := httptest.NewRequest(http.MethodGet, tamperedURL, nil)
	badRec := httptest.NewRecorder()
	mux.ServeHTTP(badRec, badReq)

	if badRec.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for bad token, got %d", badRec.Code)
	}
}

func TestHandler_ReorderAndDeletion(t *testing.T) {
	svc, storage, _ := setupTestMedia(t)
	handler := media.NewHandler(svc, storage)

	jwtSecret := "test-jwt-secret-key-32b-must-be-long-enough"
	authMw := identity.RequireAuth(jwtSecret)

	user1 := &identity.User{ID: "user-reorder-1", Email: "u1@test.com", Role: identity.RoleMember}
	token1, _ := identity.GenerateAccessToken(jwtSecret, user1, 1*time.Hour)

	user2 := &identity.User{ID: "user-reorder-2", Email: "u2@test.com", Role: identity.RoleMember}
	token2, _ := identity.GenerateAccessToken(jwtSecret, user2, 1*time.Hour)

	mux := http.NewServeMux()
	mux.Handle("/api/v1/media/upload", authMw(http.HandlerFunc(handler.Upload)))
	mux.Handle("/api/v1/media/gallery/me", authMw(http.HandlerFunc(handler.ListMyGallery)))
	mux.Handle("/api/v1/media/gallery/reorder", authMw(http.HandlerFunc(handler.ReorderGallery)))
	mux.HandleFunc("/api/v1/media/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			authMw(http.HandlerFunc(handler.DeleteAsset)).ServeHTTP(w, r)
		}
	})

	// Upload 3 photos for user 1
	var assetIDs []string
	for i := 0; i < 3; i++ {
		body := new(bytes.Buffer)
		mpWriter := multipart.NewWriter(body)
		_ = mpWriter.WriteField("purpose", "PROFILE_GALLERY")
		part, _ := mpWriter.CreateFormFile("file", fmt.Sprintf("test%d.jpg", i))
		_, _ = part.Write(media.GenerateTestJPEG(400, 400))
		_ = mpWriter.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/v1/media/upload", body)
		req.Header.Set("Content-Type", mpWriter.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+token1)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusCreated {
			t.Fatalf("upload %d failed: %d %s", i, rec.Code, rec.Body.String())
		}
		var resp media.MediaAssetResponse
		_ = json.Unmarshal(rec.Body.Bytes(), &resp)
		assetIDs = append(assetIDs, resp.ID)
		time.Sleep(10 * time.Millisecond) // separate timestamps
	}

	if len(assetIDs) != 3 {
		t.Fatalf("expected 3 asset IDs, got %d", len(assetIDs))
	}

	// 1. Reorder photos: put photo 3 first, photo 1 second, photo 2 third
	reorderedIDs := []string{assetIDs[2], assetIDs[0], assetIDs[1]}
	reorderBody, _ := json.Marshal(map[string]any{"asset_ids": reorderedIDs})
	reorderReq := httptest.NewRequest(http.MethodPut, "/api/v1/media/gallery/reorder", bytes.NewReader(reorderBody))
	reorderReq.Header.Set("Content-Type", "application/json")
	reorderReq.Header.Set("Authorization", "Bearer "+token1)
	reorderRec := httptest.NewRecorder()
	mux.ServeHTTP(reorderRec, reorderReq)

	if reorderRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on reorder, got %d: %s", reorderRec.Code, reorderRec.Body.String())
	}

	// 2. Fetch gallery and verify order
	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/media/gallery/me", nil)
	getReq.Header.Set("Authorization", "Bearer "+token1)
	getRec := httptest.NewRecorder()
	mux.ServeHTTP(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on list gallery, got %d", getRec.Code)
	}
	var galleryResult struct {
		Count  int                        `json:"count"`
		Assets []media.MediaAssetResponse `json:"assets"`
	}
	_ = json.Unmarshal(getRec.Body.Bytes(), &galleryResult)

	if len(galleryResult.Assets) != 3 {
		t.Fatalf("expected 3 photos in gallery, got %d", len(galleryResult.Assets))
	}
	if galleryResult.Assets[0].ID != reorderedIDs[0] || galleryResult.Assets[1].ID != reorderedIDs[1] || galleryResult.Assets[2].ID != reorderedIDs[2] {
		t.Fatalf("photos not in expected reordered order: got [%s, %s, %s], want [%s, %s, %s]",
			galleryResult.Assets[0].ID, galleryResult.Assets[1].ID, galleryResult.Assets[2].ID,
			reorderedIDs[0], reorderedIDs[1], reorderedIDs[2],
		)
	}

	// 3. User 2 attempts to reorder user 1's photos -> 403 Forbidden
	badReorderReq := httptest.NewRequest(http.MethodPut, "/api/v1/media/gallery/reorder", bytes.NewReader(reorderBody))
	badReorderReq.Header.Set("Content-Type", "application/json")
	badReorderReq.Header.Set("Authorization", "Bearer "+token2)
	badReorderRec := httptest.NewRecorder()
	mux.ServeHTTP(badReorderRec, badReorderReq)

	if badReorderRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden on unauthorized reorder, got %d", badReorderRec.Code)
	}

	// 4. Delete photo 2 (reorderedIDs[2])
	deleteReq := httptest.NewRequest(http.MethodDelete, "/api/v1/media/"+reorderedIDs[2], nil)
	deleteReq.Header.Set("Authorization", "Bearer "+token1)
	deleteRec := httptest.NewRecorder()
	mux.ServeHTTP(deleteRec, deleteReq)

	if deleteRec.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content on delete, got %d: %s", deleteRec.Code, deleteRec.Body.String())
	}

	// 5. Verify gallery now has 2 photos
	getReq2 := httptest.NewRequest(http.MethodGet, "/api/v1/media/gallery/me", nil)
	getReq2.Header.Set("Authorization", "Bearer "+token1)
	getRec2 := httptest.NewRecorder()
	mux.ServeHTTP(getRec2, getReq2)

	var galleryResult2 struct {
		Count  int                        `json:"count"`
		Assets []media.MediaAssetResponse `json:"assets"`
	}
	_ = json.Unmarshal(getRec2.Body.Bytes(), &galleryResult2)
	if len(galleryResult2.Assets) != 2 {
		t.Fatalf("expected 2 photos after deletion, got %d", len(galleryResult2.Assets))
	}
	if galleryResult2.Assets[0].ID != reorderedIDs[0] || galleryResult2.Assets[1].ID != reorderedIDs[1] {
		t.Fatalf("expected remaining photos to be [%s, %s], got [%s, %s]",
			reorderedIDs[0], reorderedIDs[1], galleryResult2.Assets[0].ID, galleryResult2.Assets[1].ID)
	}

	// 6. User 2 attempts to delete user 1's photo -> 403 Forbidden
	badDeleteReq := httptest.NewRequest(http.MethodDelete, "/api/v1/media/"+reorderedIDs[0], nil)
	badDeleteReq.Header.Set("Authorization", "Bearer "+token2)
	badDeleteRec := httptest.NewRecorder()
	mux.ServeHTTP(badDeleteRec, badDeleteReq)

	if badDeleteRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden on unauthorized delete, got %d", badDeleteRec.Code)
	}
}

func TestService_MinimumPhotosDeletionGuard(t *testing.T) {
	svc, _, _ := setupTestMedia(t)
	ctx := context.Background()
	user := "user-min-photos"

	// Mock active profile checker
	isActiveProfile := false
	svc.SetProfileStatusChecker(func(ctx context.Context, userID string) (bool, error) {
		return isActiveProfile, nil
	})

	// Upload 4 photos
	var uploadedIDs []string
	for i := 0; i < 4; i++ {
		imgBytes := media.GenerateTestJPEG(300+i*10, 300+i*10)
		resp, err := svc.UploadDirect(
			ctx,
			user,
			string(media.PurposeProfileGallery),
			string(media.MediaTypeImage),
			fmt.Sprintf("photo_%d.jpg", i),
			bytes.NewReader(imgBytes),
			int64(len(imgBytes)),
			fmt.Sprintf("idem-key-%d", i),
		)
		if err != nil {
			t.Fatalf("failed to upload photo %d: %v", i, err)
		}
		uploadedIDs = append(uploadedIDs, resp.ID)
	}

	// 1. Inactive profile can delete photos even when count <= 3
	isActiveProfile = false
	if err := svc.DeleteAsset(ctx, uploadedIDs[3], user); err != nil {
		t.Fatalf("inactive profile should be able to delete photo: %v", err)
	}

	// Now 3 photos remain
	// 2. Profile becomes active
	isActiveProfile = true

	// 3. Attempting to delete when count == 3 must fail with ErrMinimumPhotosViolation
	err := svc.DeleteAsset(ctx, uploadedIDs[2], user)
	if err == nil {
		t.Fatalf("expected ErrMinimumPhotosViolation when deleting from active profile with 3 photos, got nil")
	}
	if !errors.Is(err, media.ErrMinimumPhotosViolation) {
		t.Fatalf("expected ErrMinimumPhotosViolation, got %v", err)
	}

	// 4. Upload a 4th photo again
	imgBytes := media.GenerateTestJPEG(400, 400)
	resp4, err := svc.UploadDirect(
		ctx,
		user,
		string(media.PurposeProfileGallery),
		string(media.MediaTypeImage),
		"photo_extra.jpg",
		bytes.NewReader(imgBytes),
		int64(len(imgBytes)),
		"idem-key-extra",
	)
	if err != nil {
		t.Fatalf("failed to upload 4th photo: %v", err)
	}

	// 5. Active profile with 4 photos can delete 1 photo (reducing to 3)
	if err := svc.DeleteAsset(ctx, resp4.ID, user); err != nil {
		t.Fatalf("active profile with 4 photos should be allowed to delete photo down to 3: %v", err)
	}
}

func TestProcessor_ModerationRejection(t *testing.T) {
	svc, _, _ := setupTestMedia(t)
	ctx := context.Background()

	// Image containing explicit content marker
	cleanImg := media.GenerateTestJPEG(300, 300)
	explicitData := append(cleanImg, []byte("AURA_TEST_EXPLICIT_NSFW")...)

	_, err := svc.UploadDirect(
		ctx,
		"user-nsfw-test",
		string(media.PurposeProfileGallery),
		string(media.MediaTypeImage),
		"nsfw.jpg",
		bytes.NewReader(explicitData),
		int64(len(explicitData)),
		"idem-nsfw-test",
	)
	if err == nil {
		t.Fatalf("expected moderation rejection for explicit content, got nil")
	}
	if !errors.Is(err, media.ErrMediaModerationRejected) {
		t.Fatalf("expected ErrMediaModerationRejected, got %v", err)
	}
}

func TestService_UploadIntent_ValidatesSizeBytes(t *testing.T) {
	svc, _, _ := setupTestMedia(t)
	ctx := context.Background()
	user := "user-intent-test"

	// 1. Zero size_bytes must be rejected
	_, err := svc.CreateUploadIntent(ctx, user, media.UploadIntentRequest{
		Purpose:   string(media.PurposeProfileGallery),
		MediaType: string(media.MediaTypeImage),
		Filename:  "test.jpg",
		SizeBytes: 0,
	})
	if err == nil {
		t.Fatalf("expected error for size_bytes=0, got nil")
	}
	if !errors.Is(err, media.ErrInvalidFileSize) {
		t.Fatalf("expected ErrInvalidFileSize, got %v", err)
	}

	// 2. Negative size_bytes must be rejected
	_, err = svc.CreateUploadIntent(ctx, user, media.UploadIntentRequest{
		Purpose:   string(media.PurposeProfileGallery),
		MediaType: string(media.MediaTypeImage),
		Filename:  "test.jpg",
		SizeBytes: -50,
	})
	if err == nil {
		t.Fatalf("expected error for negative size_bytes, got nil")
	}

	// 3. Positive size_bytes succeeds and populates both AssetID and MediaID alias
	resp, err := svc.CreateUploadIntent(ctx, user, media.UploadIntentRequest{
		Purpose:   string(media.PurposeProfileGallery),
		MediaType: string(media.MediaTypeImage),
		Filename:  "valid.jpg",
		SizeBytes: 10240,
	})
	if err != nil {
		t.Fatalf("expected success for positive size_bytes, got %v", err)
	}
	if resp.AssetID == "" || resp.MediaID == "" {
		t.Fatalf("expected non-empty AssetID and MediaID, got asset=%s media=%s", resp.AssetID, resp.MediaID)
	}
	if resp.AssetID != resp.MediaID {
		t.Errorf("expected AssetID and MediaID to match, got %s vs %s", resp.AssetID, resp.MediaID)
	}
	if resp.UploadURL == "" {
		t.Errorf("expected non-empty UploadURL")
	}
}

func TestHandler_UploadIntent_RejectsZeroSizeBytes(t *testing.T) {
	svc, storage, _ := setupTestMedia(t)
	handler := media.NewHandler(svc, storage)

	jwtSecret := "test-jwt-secret-key-32b-must-be-long-enough"
	authMw := identity.RequireAuth(jwtSecret)

	testUser := &identity.User{
		ID:    "user-authed-intent",
		Email: "intent@auradating.com",
		Role:  identity.RoleMember,
	}
	token, _ := identity.GenerateAccessToken(jwtSecret, testUser, 1*time.Hour)

	mux := http.NewServeMux()
	mux.Handle("/api/v1/media/upload-intent", authMw(http.HandlerFunc(handler.CreateUploadIntent)))

	// POST upload-intent with size_bytes: 0
	badPayload := []byte(`{"purpose":"PROFILE_GALLERY","media_type":"IMAGE","size_bytes":0}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/media/upload-intent", bytes.NewReader(badPayload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for size_bytes=0, got %d: %s", rec.Code, rec.Body.String())
	}

	// POST upload-intent with valid positive size_bytes
	goodPayload := []byte(`{"purpose":"PROFILE_GALLERY","media_type":"IMAGE","size_bytes":20480}`)
	goodReq := httptest.NewRequest(http.MethodPost, "/api/v1/media/upload-intent", bytes.NewReader(goodPayload))
	goodReq.Header.Set("Content-Type", "application/json")
	goodReq.Header.Set("Authorization", "Bearer "+token)
	goodRec := httptest.NewRecorder()
	mux.ServeHTTP(goodRec, goodReq)

	if goodRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for valid intent, got %d: %s", goodRec.Code, goodRec.Body.String())
	}

	var parsed media.UploadIntentResponse
	if err := json.Unmarshal(goodRec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if parsed.AssetID == "" || parsed.MediaID == "" {
		t.Errorf("expected both asset_id and media_id in response")
	}
}



