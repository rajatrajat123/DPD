package media

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	ErrAssetNotReady = errors.New("media asset is not ready or has not passed moderation")
)

type ProfileStatusChecker func(ctx context.Context, userID string) (isActive bool, err error)

type Service struct {
	repo           Repository
	storage        StorageEngine
	processor      *Processor
	logger         *slog.Logger
	profileChecker ProfileStatusChecker

	jobQueue chan string
	stopOnce sync.Once
	wg       sync.WaitGroup
	ctx      context.Context
	cancel   context.CancelFunc
}

func (s *Service) SetProfileStatusChecker(checker ProfileStatusChecker) {
	s.profileChecker = checker
}

func NewService(repo Repository, storage StorageEngine, processor *Processor, logger *slog.Logger) *Service {
	ctx, cancel := context.WithCancel(context.Background())
	s := &Service{
		repo:      repo,
		storage:   storage,
		processor: processor,
		logger:    logger,
		jobQueue:  make(chan string, 1000),
		ctx:       ctx,
		cancel:    cancel,
	}

	// Start 2 background worker goroutines
	s.startWorkers(2)
	return s
}

func (s *Service) startWorkers(numWorkers int) {
	for i := 0; i < numWorkers; i++ {
		s.wg.Add(1)
		go func(workerID int) {
			defer s.wg.Done()
			for {
				select {
				case <-s.ctx.Done():
					return
				case assetID, ok := <-s.jobQueue:
					if !ok {
						return
					}
					s.logger.Info("media_worker_processing_job",
						slog.Int("worker_id", workerID),
						slog.String("asset_id", assetID),
					)
					if err := s.ProcessAsset(context.Background(), assetID); err != nil {
						s.logger.Error("media_worker_processing_failed",
							slog.String("asset_id", assetID),
							slog.String("error", err.Error()),
						)
					}
				}
			}
		}(i + 1)
	}
}

func (s *Service) Stop() {
	s.stopOnce.Do(func() {
		s.cancel()
		close(s.jobQueue)
		s.wg.Wait()
	})
}

func (s *Service) CreateUploadIntent(ctx context.Context, ownerUserID string, req UploadIntentRequest) (*UploadIntentResponse, error) {
	purpose, err := ValidatePurpose(req.Purpose)
	if err != nil {
		return nil, err
	}
	mediaType, err := ValidateMediaType(req.MediaType)
	if err != nil {
		return nil, err
	}

	maxBytes := s.processor.maxImageBytes
	if mediaType == MediaTypeVideo {
		maxBytes = s.processor.maxVideoBytes
	}

	if req.SizeBytes <= 0 {
		return nil, fmt.Errorf("%w: size_bytes must be greater than zero", ErrInvalidFileSize)
	}

	if req.SizeBytes > maxBytes {
		return nil, fmt.Errorf("%w: maximum allowed is %d bytes", ErrFileTooLarge, maxBytes)
	}

	idempotencyKey := strings.TrimSpace(req.IdempotencyKey)
	if idempotencyKey == "" {
		idempotencyKey = fmt.Sprintf("intent-%s-%d", ownerUserID, time.Now().UnixNano())
	}

	// Check if already created
	if existing, err := s.repo.GetAssetByIdempotencyKey(ctx, idempotencyKey); err == nil && existing != nil {
		token, exp := s.storage.GenerateSignedToken("quarantine", existing.QuarantineKey, 15*time.Minute)
		uploadURL := fmt.Sprintf("/api/v1/media/stream/quarantine/%s?token=%s", existing.QuarantineKey, token)
		return &UploadIntentResponse{
			AssetID:       existing.ID,
			MediaID:       existing.ID,
			UploadURL:     uploadURL,
			QuarantineKey: existing.QuarantineKey,
			ExpiresAt:     exp,
			MaxSizeBytes:  maxBytes,
		}, nil
	}

	randomID := generateUUIDv4()
	ext := strings.ToLower(filepath.Ext(req.Filename))
	if ext == "" {
		if mediaType == MediaTypeVideo {
			ext = ".mp4"
		} else {
			ext = ".jpg"
		}
	}
	quarantineKey := fmt.Sprintf("%s/%s%s", ownerUserID, randomID, ext)

	asset := &MediaAsset{
		ID:                randomID,
		OwnerUserID:       ownerUserID,
		MediaType:         mediaType,
		Purpose:           purpose,
		Status:            StatusPendingUpload,
		QuarantineBucket:  "aura-media-quarantine",
		QuarantineKey:     quarantineKey,
		OriginalSizeBytes: req.SizeBytes,
		OriginalMIME:      req.MimeType,
		IdempotencyKey:    idempotencyKey,
	}

	if err := s.repo.CreateAsset(ctx, asset); err != nil {
		return nil, fmt.Errorf("failed to register upload intent: %w", err)
	}

	token, exp := s.storage.GenerateSignedToken("quarantine", quarantineKey, 15*time.Minute)
	uploadURL := fmt.Sprintf("/api/v1/media/stream/quarantine/%s?token=%s", quarantineKey, token)

	return &UploadIntentResponse{
		AssetID:       asset.ID,
		MediaID:       asset.ID,
		UploadURL:     uploadURL,
		QuarantineKey: quarantineKey,
		ExpiresAt:     exp,
		MaxSizeBytes:  maxBytes,
	}, nil
}

func (s *Service) UploadDirect(ctx context.Context, ownerUserID string, purposeStr, mediaTypeStr string, filename string, r io.Reader, size int64, idempotencyKey string) (*MediaAssetResponse, error) {
	purpose, err := ValidatePurpose(purposeStr)
	if err != nil {
		return nil, err
	}
	mediaType, err := ValidateMediaType(mediaTypeStr)
	if err != nil {
		return nil, err
	}

	maxBytes := s.processor.maxImageBytes
	if mediaType == MediaTypeVideo {
		maxBytes = s.processor.maxVideoBytes
	}
	if size > maxBytes {
		return nil, fmt.Errorf("%w: max allowed %d bytes", ErrFileTooLarge, maxBytes)
	}

	// Read into memory or temp buffer to compute hash and validate
	data, err := io.ReadAll(io.LimitReader(r, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("failed to read upload data: %w", err)
	}
	if int64(len(data)) > maxBytes {
		return nil, ErrFileTooLarge
	}

	if idempotencyKey == "" {
		idempotencyKey = fmt.Sprintf("direct-%s-%d", ownerUserID, time.Now().UnixNano())
	}

	// Idempotency check
	if existing, err := s.repo.GetAssetByIdempotencyKey(ctx, idempotencyKey); err == nil && existing != nil {
		return s.GetAssetWithDerivatives(ctx, existing.ID, ownerUserID)
	}

	assetID := generateUUIDv4()
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" {
		if mediaType == MediaTypeVideo {
			ext = ".mp4"
		} else {
			ext = ".jpg"
		}
	}
	quarantineKey := fmt.Sprintf("%s/%s%s", ownerUserID, assetID, ext)

	// Save raw upload to quarantine storage
	if err := s.storage.SaveQuarantine(ctx, quarantineKey, bytes.NewReader(data), int64(len(data))); err != nil {
		return nil, fmt.Errorf("failed to store quarantine payload: %w", err)
	}

	asset := &MediaAsset{
		ID:                assetID,
		OwnerUserID:       ownerUserID,
		MediaType:         mediaType,
		Purpose:           purpose,
		Status:            StatusUploaded,
		QuarantineBucket:  "aura-media-quarantine",
		QuarantineKey:     quarantineKey,
		OriginalSizeBytes: int64(len(data)),
		IdempotencyKey:    idempotencyKey,
	}

	if err := s.repo.CreateAsset(ctx, asset); err != nil {
		_ = s.storage.DeleteQuarantine(ctx, quarantineKey)
		return nil, fmt.Errorf("failed to persist asset record: %w", err)
	}

	// Execute processing synchronously to guarantee immediate availability for caller
	if err := s.processData(ctx, asset, data); err != nil {
		s.logger.Error("direct_upload_processing_failed",
			slog.String("asset_id", asset.ID),
			slog.String("error", err.Error()),
		)
		asset.Status = StatusFailed
		_ = s.repo.UpdateAsset(ctx, asset)
		return nil, err
	}

	return s.GetAssetWithDerivatives(ctx, asset.ID, ownerUserID)
}

func (s *Service) ProcessAsset(ctx context.Context, assetID string) error {
	asset, err := s.repo.GetAssetByID(ctx, assetID)
	if err != nil {
		return err
	}

	asset.Status = StatusProcessing
	_ = s.repo.UpdateAsset(ctx, asset)

	r, err := s.storage.OpenQuarantine(ctx, asset.QuarantineKey)
	if err != nil {
		asset.Status = StatusFailed
		_ = s.repo.UpdateAsset(ctx, asset)
		return fmt.Errorf("failed to open quarantine object: %w", err)
	}
	defer r.Close()

	data, err := io.ReadAll(r)
	if err != nil {
		asset.Status = StatusFailed
		_ = s.repo.UpdateAsset(ctx, asset)
		return fmt.Errorf("failed to read quarantine object: %w", err)
	}

	return s.processData(ctx, asset, data)
}

func (s *Service) processData(ctx context.Context, asset *MediaAsset, data []byte) error {
	var result *ProcessResult
	var err error

	if asset.MediaType == MediaTypeVideo {
		result, err = s.processor.ProcessVideo(ctx, data, asset.Purpose)
	} else {
		result, err = s.processor.ProcessImage(ctx, data, asset.Purpose)
	}

	if err != nil {
		if errors.Is(err, ErrTranscodingWorkerUnavailable) {
			asset.Status = StatusProcessing // Leave in processing state queued for transcoding worker
		} else if errors.Is(err, ErrMediaModerationRejected) {
			asset.Status = StatusRejected
			v := VerdictRejectedNSFW
			asset.ModerationVerdict = &v
		} else {
			asset.Status = StatusRejected
		}
		_ = s.repo.UpdateAsset(ctx, asset)
		return err
	}

	// Persist derivatives to storage and database
	approvedBucket := "aura-media-approved"
	for _, deriv := range result.Derivatives {
		ext := ".webp"
		if strings.Contains(deriv.MimeType, "mp4") {
			ext = ".mp4"
		} else if strings.Contains(deriv.MimeType, "jpeg") {
			ext = ".jpg"
		} else if strings.Contains(deriv.MimeType, "png") {
			ext = ".png"
		}
		storageKey := fmt.Sprintf("%s/%s/%s%s", asset.OwnerUserID, asset.ID, strings.ToLower(string(deriv.Variant)), ext)

		if err := s.storage.SaveDerivative(ctx, approvedBucket, storageKey, bytes.NewReader(deriv.Data), deriv.SizeBytes, deriv.MimeType); err != nil {
			asset.Status = StatusFailed
			_ = s.repo.UpdateAsset(ctx, asset)
			return fmt.Errorf("failed to store derivative %s: %w", deriv.Variant, err)
		}

		w := deriv.Width
		h := deriv.Height
		dModel := &MediaDerivative{
			ID:            generateUUIDv4(),
			MediaAssetID:  asset.ID,
			Variant:       deriv.Variant,
			StorageBucket: approvedBucket,
			StorageKey:    storageKey,
			MimeType:      deriv.MimeType,
			SizeBytes:     deriv.SizeBytes,
			WidthPx:       &w,
			HeightPx:      &h,
		}
		if err := s.repo.SaveDerivative(ctx, dModel); err != nil {
			return fmt.Errorf("failed to save derivative record %s: %w", deriv.Variant, err)
		}
	}

	// Update asset metadata and moderation status
	asset.OriginalSHA256 = result.OriginalSHA256
	asset.OriginalMIME = result.OriginalMIME
	asset.WidthPx = result.WidthPx
	asset.HeightPx = result.HeightPx
	asset.DurationMs = result.DurationMs
	asset.ExifStripped = result.ExifStripped
	asset.ModerationVerdict = &result.ModerationVerdict

	if result.ModerationVerdict == VerdictApproved {
		asset.Status = StatusReady
	} else {
		asset.Status = StatusRejected
	}

	// Retain quarantine original for 7 days
	purgeAfter := time.Now().Add(7 * 24 * time.Hour).UTC()
	asset.OriginalPurgeAfter = &purgeAfter

	return s.repo.UpdateAsset(ctx, asset)
}

func (s *Service) CompleteUpload(ctx context.Context, assetID, ownerUserID string) error {
	asset, err := s.repo.GetAssetByID(ctx, assetID)
	if err != nil {
		return err
	}
	if asset.OwnerUserID != ownerUserID {
		return ErrUnauthorizedMedia
	}

	asset.Status = StatusUploaded
	if err := s.repo.UpdateAsset(ctx, asset); err != nil {
		return err
	}

	// Queue for async background worker processing
	select {
	case s.jobQueue <- asset.ID:
	default:
		// Queue full: execute inline synchronously
		go func(id string) {
			_ = s.ProcessAsset(context.Background(), id)
		}(asset.ID)
	}
	return nil
}

func (s *Service) GetAssetWithDerivatives(ctx context.Context, assetID, requesterUserID string) (*MediaAssetResponse, error) {
	asset, err := s.repo.GetAssetByID(ctx, assetID)
	if err != nil {
		return nil, err
	}

	// Access control:
	// Owner can always see their asset status.
	// Other users can ONLY see if asset is READY and moderation is APPROVED.
	if asset.OwnerUserID != requesterUserID {
		if asset.Status != StatusReady || asset.ModerationVerdict == nil || *asset.ModerationVerdict != VerdictApproved {
			return nil, ErrUnauthorizedMedia
		}
	}

	derivatives, err := s.repo.GetDerivativesByAssetID(ctx, asset.ID)
	if err != nil {
		return nil, err
	}

	derivResponses := make([]DerivativeResponse, 0, len(derivatives))
	for _, d := range derivatives {
		token, _ := s.storage.GenerateSignedToken(d.StorageBucket, d.StorageKey, 1*time.Hour)
		url := fmt.Sprintf("/api/v1/media/stream/%s/%s?token=%s", d.StorageBucket, d.StorageKey, token)
		derivResponses = append(derivResponses, DerivativeResponse{
			Variant:   d.Variant,
			URL:       url,
			MimeType:  d.MimeType,
			SizeBytes: d.SizeBytes,
			WidthPx:   d.WidthPx,
			HeightPx:  d.HeightPx,
		})
	}

	return &MediaAssetResponse{
		ID:                asset.ID,
		OwnerUserID:       asset.OwnerUserID,
		MediaType:         asset.MediaType,
		Purpose:           asset.Purpose,
		Status:            asset.Status,
		DisplayOrder:      asset.DisplayOrder,
		OriginalSizeBytes: asset.OriginalSizeBytes,
		WidthPx:           asset.WidthPx,
		HeightPx:          asset.HeightPx,
		DurationMs:        asset.DurationMs,
		ExifStripped:      asset.ExifStripped,
		ModerationVerdict: asset.ModerationVerdict,
		Derivatives:       derivResponses,
		CreatedAt:         asset.CreatedAt,
		UpdatedAt:         asset.UpdatedAt,
	}, nil
}

func (s *Service) ListUserGallery(ctx context.Context, ownerUserID string) ([]MediaAssetResponse, error) {
	purpose := PurposeProfileGallery
	assets, err := s.repo.ListUserAssets(ctx, ownerUserID, &purpose, true)
	if err != nil {
		return nil, err
	}

	res := make([]MediaAssetResponse, 0, len(assets))
	for _, a := range assets {
		resp, err := s.GetAssetWithDerivatives(ctx, a.ID, ownerUserID)
		if err == nil && resp != nil {
			res = append(res, *resp)
		}
	}
	return res, nil
}

func (s *Service) ReorderGallery(ctx context.Context, ownerUserID string, assetIDs []string) error {
	if len(assetIDs) == 0 {
		return errors.New("asset_ids cannot be empty")
	}
	return s.repo.ReorderAssets(ctx, ownerUserID, assetIDs)
}

func (s *Service) DeleteAsset(ctx context.Context, assetID, ownerUserID string) error {
	asset, err := s.repo.GetAssetByID(ctx, assetID)
	if err != nil {
		return err
	}
	if asset.OwnerUserID != ownerUserID {
		return ErrUnauthorizedMedia
	}

	// Enforce 3-approved-photo minimum for active profiles
	if asset.Purpose == PurposeProfileGallery && asset.Status == StatusReady && asset.ModerationVerdict != nil && *asset.ModerationVerdict == VerdictApproved {
		purpose := PurposeProfileGallery
		approvedAssets, err := s.repo.ListUserAssets(ctx, ownerUserID, &purpose, true)
		if err == nil && len(approvedAssets) <= 3 {
			// Check if the profile is currently active and eligible
			isActive := false
			if s.profileChecker != nil {
				active, checkErr := s.profileChecker(ctx, ownerUserID)
				if checkErr == nil {
					isActive = active
				}
			}
			if isActive {
				return ErrMinimumPhotosViolation
			}
		}
	}

	if err := s.repo.DeleteAsset(ctx, assetID, ownerUserID); err != nil {
		return err
	}
	// Asynchronously or synchronously clean up stored files
	_ = s.storage.DeleteAssetFiles(ctx, assetID)
	return nil
}

func generateUUIDv4() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40 // Version 4
	b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
