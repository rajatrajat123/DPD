package media

import (
	"fmt"
	"strings"
	"time"
)

type MediaType string

const (
	MediaTypeImage     MediaType = "IMAGE"
	MediaTypeVideo     MediaType = "VIDEO"
	MediaTypeVoiceNote MediaType = "VOICE_NOTE"
)

type MediaPurpose string

const (
	PurposeProfileGallery     MediaPurpose = "PROFILE_GALLERY"
	PurposeSelfieVerification MediaPurpose = "SELFIE_VERIFICATION"
	PurposeChatAttachment     MediaPurpose = "CHAT_ATTACHMENT"
)

type MediaStatus string

const (
	StatusPendingUpload     MediaStatus = "PENDING_UPLOAD"
	StatusUploaded          MediaStatus = "UPLOADED"
	StatusProcessing        MediaStatus = "PROCESSING"
	StatusModerationPending MediaStatus = "MODERATION_PENDING"
	StatusReady             MediaStatus = "READY"
	StatusRejected          MediaStatus = "REJECTED"
	StatusFailed            MediaStatus = "FAILED"
	StatusPurged            MediaStatus = "PURGED"
)

type ModerationVerdict string

const (
	VerdictApproved     ModerationVerdict = "APPROVED"
	VerdictRejectedNSFW ModerationVerdict = "REJECTED_NSFW"
	VerdictRejectedCSAM ModerationVerdict = "REJECTED_CSAM"
	VerdictManualReview ModerationVerdict = "MANUAL_REVIEW"
)

type DerivativeVariant string

const (
	VariantThumbWebP   DerivativeVariant = "THUMB_WEBP"
	VariantCardWebP    DerivativeVariant = "CARD_WEBP"
	VariantFullWebP    DerivativeVariant = "FULL_WEBP"
	VariantCardAVIF    DerivativeVariant = "CARD_AVIF"
	VariantFullAVIF    DerivativeVariant = "FULL_AVIF"
	VariantHLS480P     DerivativeVariant = "HLS_480P"
	VariantHLS720P     DerivativeVariant = "HLS_720P"
	VariantHLS1080P    DerivativeVariant = "HLS_1080P"
	VariantMP4720P     DerivativeVariant = "MP4_720P"
	VariantVideoPoster DerivativeVariant = "VIDEO_POSTER"
)

type MediaAsset struct {
	ID                 string             `json:"id"`
	OwnerUserID        string             `json:"owner_user_id"`
	MediaType          MediaType          `json:"media_type"`
	Purpose            MediaPurpose       `json:"purpose"`
	Status             MediaStatus        `json:"status"`
	QuarantineBucket   string             `json:"quarantine_bucket"`
	QuarantineKey      string             `json:"quarantine_key"`
	OriginalSHA256     string             `json:"original_sha256,omitempty"`
	OriginalMIME       string             `json:"original_mime,omitempty"`
	OriginalSizeBytes  int64              `json:"original_size_bytes"`
	WidthPx            *int               `json:"width_px,omitempty"`
	HeightPx           *int               `json:"height_px,omitempty"`
	DurationMs         *int               `json:"duration_ms,omitempty"`
	ExifStripped       bool               `json:"exif_stripped"`
	ModerationVerdict  *ModerationVerdict `json:"moderation_verdict,omitempty"`
	OriginalPurgeAfter *time.Time         `json:"original_purge_after,omitempty"`
	IdempotencyKey     string             `json:"idempotency_key"`
	DisplayOrder       int                `json:"display_order"`
	CreatedAt          time.Time          `json:"created_at"`
	UpdatedAt          time.Time          `json:"updated_at"`
}

type MediaDerivative struct {
	ID            string            `json:"id"`
	MediaAssetID  string            `json:"media_asset_id"`
	Variant       DerivativeVariant `json:"variant"`
	StorageBucket string            `json:"storage_bucket"`
	StorageKey    string            `json:"storage_key"`
	MimeType      string            `json:"mime_type"`
	SizeBytes     int64             `json:"size_bytes"`
	WidthPx       *int              `json:"width_px,omitempty"`
	HeightPx      *int              `json:"height_px,omitempty"`
	CreatedAt     time.Time         `json:"created_at"`
}

type UploadIntentRequest struct {
	Purpose        string `json:"purpose"`
	MediaType      string `json:"media_type"`
	Filename       string `json:"filename"`
	SizeBytes      int64  `json:"size_bytes"`
	MimeType       string `json:"mime_type"`
	IdempotencyKey string `json:"idempotency_key"`
}

type UploadIntentResponse struct {
	AssetID       string    `json:"asset_id"`
	MediaID       string    `json:"media_id"`
	UploadURL     string    `json:"upload_url"`
	QuarantineKey string    `json:"quarantine_key"`
	ExpiresAt     time.Time `json:"expires_at"`
	MaxSizeBytes  int64     `json:"max_size_bytes"`
}

type DerivativeResponse struct {
	Variant   DerivativeVariant `json:"variant"`
	URL       string            `json:"url"`
	MimeType  string            `json:"mime_type"`
	SizeBytes int64             `json:"size_bytes"`
	WidthPx   *int              `json:"width_px,omitempty"`
	HeightPx  *int              `json:"height_px,omitempty"`
}

type MediaAssetResponse struct {
	ID                string               `json:"id"`
	OwnerUserID       string               `json:"owner_user_id"`
	MediaType         MediaType            `json:"media_type"`
	Purpose           MediaPurpose         `json:"purpose"`
	Status            MediaStatus          `json:"status"`
	OriginalSizeBytes int64                `json:"original_size_bytes"`
	WidthPx           *int                 `json:"width_px,omitempty"`
	HeightPx          *int                 `json:"height_px,omitempty"`
	DurationMs        *int                 `json:"duration_ms,omitempty"`
	ExifStripped      bool                 `json:"exif_stripped"`
	ModerationVerdict *ModerationVerdict   `json:"moderation_verdict,omitempty"`
	Derivatives       []DerivativeResponse `json:"derivatives"`
	DisplayOrder      int                  `json:"display_order"`
	CreatedAt         time.Time            `json:"created_at"`
	UpdatedAt         time.Time            `json:"updated_at"`
}

type ReorderGalleryRequest struct {
	AssetIDs []string `json:"asset_ids"`
}

func (r ReorderGalleryRequest) Validate() map[string]string {
	errs := make(map[string]string)
	if len(r.AssetIDs) == 0 {
		errs["asset_ids"] = "must provide at least one asset ID"
	}
	for i, id := range r.AssetIDs {
		if strings.TrimSpace(id) == "" {
			errs[fmt.Sprintf("asset_ids[%d]", i)] = "asset ID cannot be blank"
		}
	}
	return errs
}

func ValidatePurpose(p string) (MediaPurpose, error) {
	norm := strings.ToUpper(strings.TrimSpace(p))
	switch MediaPurpose(norm) {
	case PurposeProfileGallery, PurposeSelfieVerification, PurposeChatAttachment:
		return MediaPurpose(norm), nil
	default:
		return "", fmt.Errorf("invalid purpose %q: must be PROFILE_GALLERY, SELFIE_VERIFICATION, or CHAT_ATTACHMENT", p)
	}
}

func ValidateMediaType(t string) (MediaType, error) {
	norm := strings.ToUpper(strings.TrimSpace(t))
	switch MediaType(norm) {
	case MediaTypeImage, MediaTypeVideo, MediaTypeVoiceNote:
		return MediaType(norm), nil
	default:
		return "", fmt.Errorf("invalid media_type %q: must be IMAGE, VIDEO, or VOICE_NOTE", t)
	}
}
