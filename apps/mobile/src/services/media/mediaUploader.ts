import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api, ApiError } from '../api/client';
import { config } from '../../config/env';
import { ProfilePhoto } from '../../types';

export interface PickedMedia {
  uri: string;
  width: number;
  height: number;
  fileSize?: number;
  mimeType: string;
}

export interface UploadedAsset {
  media_id: string;
  status: 'PENDING_UPLOAD' | 'PROCESSING' | 'READY' | 'REJECTED';
  thumb_url?: string;
  card_url?: string;
  full_url?: string;
}

export type UploadStep = 'STRIPPING_EXIF' | 'REQUESTING_INTENT' | 'UPLOADING' | 'PROCESSING' | 'DONE';

export const mediaUploader = {
  /**
   * Request camera or gallery permissions
   */
  async requestPermissions(): Promise<boolean> {
    const { status: libStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return libStatus === 'granted';
  },

  /**
   * Pick an image from device gallery
   */
  async pickImageFromGallery(): Promise<PickedMedia | null> {
    const hasPerm = await this.requestPermissions();
    if (!hasPerm) {
      throw new ApiError(403, 'PERMISSION_DENIED', 'Media library access is required to choose photos.');
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.9,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    return {
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      fileSize: asset.fileSize,
      mimeType: asset.mimeType || 'image/jpeg',
    };
  },

  /**
   * Capture a selfie for 18+ age verification or profile photo
   */
  async capturePhoto(): Promise<PickedMedia | null> {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      throw new ApiError(403, 'PERMISSION_DENIED', 'Camera access is required to take verification photos.');
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.9,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    return {
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      fileSize: asset.fileSize,
      mimeType: asset.mimeType || 'image/jpeg',
    };
  },

  /**
   * Strips all EXIF, GPS and hardware metadata by re-encoding through ImageManipulator,
   * while resizing to maximum high-definition constraints (1080x1440).
   */
  async stripExifAndOptimize(imageUri: string, maxWidth = 1080): Promise<string> {
    // Re-encoding creates a clean pixel buffer with zero metadata
    const manipulated = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: maxWidth } }],
      {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );

    return manipulated.uri;
  },

  /**
   * Executes the authenticated direct multipart upload workflow to backend:
   * 1. Strip EXIF / GPS locally
   * 2. Validate file size limits
   * 3. Construct authenticated FormData with file, purpose, and idempotency key
   * 4. Upload to POST /api/v1/media/upload
   * 5. If response is immediately READY, return derivatives
   * 6. Otherwise poll documented GET /api/v1/media/${assetId} until READY or REJECTED
   */
  async uploadPhoto(
    sourceUri: string,
    purpose: 'PROFILE_GALLERY' | 'SELFIE_VERIFICATION' = 'PROFILE_GALLERY',
    onProgress?: (step: UploadStep) => void
  ): Promise<UploadedAsset> {
    onProgress?.('STRIPPING_EXIF');
    const sanitizedUri = await this.stripExifAndOptimize(sourceUri);

    // Fetch blob from sanitized local file URI when supported (e.g. web) or to obtain size_bytes
    let sizeBytes = 0;
    let fileBlob: Blob | null = null;
    try {
      const blobRes = await fetch(sanitizedUri);
      fileBlob = await blobRes.blob();
      sizeBytes = fileBlob?.size || 0;
    } catch {
      // In React Native native runtimes (Android/iOS), fetch() may not support local file:// URIs
      fileBlob = null;
    }

    if (sizeBytes > 0 && sizeBytes > config.maxImageSizeBytes) {
      throw new ApiError(400, 'FILE_TOO_LARGE', 'Image exceeds the maximum 15MB limit.');
    }

    onProgress?.('UPLOADING');
    const idempotencyKey = `up_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const formData = new FormData();
    if (Platform.OS === 'web') {
      if (!fileBlob || fileBlob.size <= 0) {
        throw new ApiError(400, 'INVALID_FILE', 'Photo payload is empty or invalid.');
      }
      const file = new File([fileBlob], 'photo.jpg', { type: 'image/jpeg' });
      formData.append('file', file);
    } else {
      // In React Native native runtimes (Android & iOS), FormData requires an object with { uri, name, type }
      formData.append('file', {
        uri: sanitizedUri,
        name: 'photo.jpg',
        type: 'image/jpeg',
      } as any);
    }
    formData.append('purpose', purpose);
    formData.append('media_type', 'IMAGE');
    formData.append('idempotency_key', idempotencyKey);

    try {
      const uploadRes = await api.postFormData<{
        id: string;
        media_id?: string;
        status: 'PENDING_UPLOAD' | 'UPLOADED' | 'PROCESSING' | 'READY' | 'REJECTED';
        derivatives?: Array<{ variant: string; url: string }>;
        thumb_url?: string;
        card_url?: string;
        full_url?: string;
      }>('/api/v1/media/upload', formData);

      const assetId = uploadRes.id || uploadRes.media_id;
      if (!assetId) {
        throw new ApiError(500, 'UPLOAD_FAILED', 'Server failed to return asset ID.');
      }

      if (uploadRes.status === 'READY') {
        const thumb = uploadRes.derivatives?.find((d) => d.variant === 'THUMB_WEBP')?.url || uploadRes.thumb_url;
        const card = uploadRes.derivatives?.find((d) => d.variant === 'CARD_WEBP' || d.variant === 'CARD_AVIF')?.url || uploadRes.card_url;
        const full = uploadRes.derivatives?.find((d) => d.variant === 'FULL_WEBP' || d.variant === 'FULL_AVIF')?.url || uploadRes.full_url;

        onProgress?.('DONE');
        return {
          media_id: assetId,
          status: uploadRes.status,
          thumb_url: thumb,
          card_url: card,
          full_url: full,
        };
      }

      if (uploadRes.status === 'REJECTED') {
        throw new ApiError(422, 'MEDIA_REJECTED', 'Image rejected by automated safety/moderation scan.');
      }

      onProgress?.('PROCESSING');

      // Poll documented GET /api/v1/media/${assetId} with exponential backoff (up to 5 attempts)
      let attempts = 0;
      while (attempts < 5) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(1.5, attempts)));
        const statusRes = await api.get<{
          id?: string;
          media_id?: string;
          status: 'PENDING_UPLOAD' | 'UPLOADED' | 'PROCESSING' | 'READY' | 'REJECTED';
          derivatives?: Array<{ variant: string; url: string }>;
          thumb_url?: string;
          card_url?: string;
          full_url?: string;
        }>(`/api/v1/media/${assetId}`);

        if (statusRes.status === 'READY') {
          const thumb = statusRes.derivatives?.find((d) => d.variant === 'THUMB_WEBP')?.url || statusRes.thumb_url;
          const card = statusRes.derivatives?.find((d) => d.variant === 'CARD_WEBP' || d.variant === 'CARD_AVIF')?.url || statusRes.card_url;
          const full = statusRes.derivatives?.find((d) => d.variant === 'FULL_WEBP' || d.variant === 'FULL_AVIF')?.url || statusRes.full_url;

          onProgress?.('DONE');
          return {
            media_id: statusRes.id || statusRes.media_id || assetId,
            status: statusRes.status,
            thumb_url: thumb,
            card_url: card,
            full_url: full,
          };
        }
        if (statusRes.status === 'REJECTED') {
          throw new ApiError(422, 'MEDIA_REJECTED', 'Image rejected by automated safety/moderation scan.');
        }
        attempts++;
      }

      return {
        media_id: assetId,
        status: 'PROCESSING',
      };
    } catch (uploadErr) {
      if (__DEV__) {
        console.error('[mediaUploader.uploadPhoto] Failure:', {
          purpose,
          errorName: uploadErr instanceof Error ? uploadErr.name : 'UnknownError',
          errorMessage: uploadErr instanceof Error ? uploadErr.message : String(uploadErr),
          stack: uploadErr instanceof Error ? uploadErr.stack : undefined,
        });
      }
      throw uploadErr;
    }
  },

  /**
   * Upload profile gallery photo (public on verified match/discovery)
   */
  async uploadProfilePhoto(
    sourceUri: string,
    onProgress?: (step: UploadStep) => void
  ): Promise<UploadedAsset> {
    return this.uploadPhoto(sourceUri, 'PROFILE_GALLERY', onProgress);
  },

  /**
   * Upload private selfie verification asset (strictly internal, never public)
   */
  async uploadVerificationSelfie(
    sourceUri: string,
    onProgress?: (step: UploadStep) => void
  ): Promise<UploadedAsset> {
    return this.uploadPhoto(sourceUri, 'SELFIE_VERIFICATION', onProgress);
  },

  /**
   * Fetches current user's profile gallery assets from backend and maps to ProfilePhoto[]
   */
  async getMyGallery(): Promise<ProfilePhoto[]> {
    try {
      const res = await api.get<{ count: number; assets: MediaAssetApi[] }>('/api/v1/media/gallery/me');
      if (!res || !Array.isArray(res.assets)) {
        return [];
      }
      return res.assets
        .filter((a) => a.purpose === 'PROFILE_GALLERY' && a.status === 'READY')
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
        .map((asset, idx) => mapAssetToProfilePhoto(asset, idx));
    } catch (err) {
      if (__DEV__) {
        console.warn('[mediaUploader.getMyGallery] Failed to fetch gallery:', err);
      }
      return [];
    }
  },

  /**
   * Deletes a gallery media asset
   */
  async deletePhoto(photoId: string): Promise<boolean> {
    await api.delete(`/api/v1/media/${photoId}`);
    return true;
  },

  /**
   * Reorders profile gallery assets
   */
  async reorderGallery(assetIds: string[]): Promise<boolean> {
    await api.put('/api/v1/media/gallery/reorder', { asset_ids: assetIds });
    return true;
  },
};

export interface MediaDerivativeApi {
  variant: string;
  url: string;
  mime_type?: string;
  size_bytes?: number;
  width_px?: number;
  height_px?: number;
}

export interface MediaAssetApi {
  id: string;
  owner_user_id: string;
  media_type: string;
  purpose: string;
  status: string;
  display_order: number;
  derivatives?: MediaDerivativeApi[];
  created_at?: string;
  updated_at?: string;
}

/**
 * Builds an absolute authorized media streaming URL from a relative path
 */
export function buildMediaUrl(path: string): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const baseUrl = config.apiUrl.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${cleanPath}`;
}

/**
 * Maps backend MediaAssetApi into mobile ProfilePhoto with full streaming URLs
 */
export function mapAssetToProfilePhoto(asset: MediaAssetApi, index: number): ProfilePhoto {
  const card = asset.derivatives?.find((d) => d.variant === 'CARD_WEBP' || d.variant === 'CARD_AVIF');
  const full = asset.derivatives?.find((d) => d.variant === 'FULL_WEBP' || d.variant === 'FULL_AVIF');
  const thumb = asset.derivatives?.find((d) => d.variant === 'THUMB_WEBP');
  const fallback = asset.derivatives?.[0];

  const primaryUrl = card?.url || full?.url || fallback?.url || '';
  const thumbUrl = thumb?.url || card?.url || fallback?.url || '';

  return {
    id: asset.id,
    url: buildMediaUrl(primaryUrl),
    thumb_url: thumbUrl ? buildMediaUrl(thumbUrl) : undefined,
    is_primary: asset.display_order === 0 || index === 0,
    order: asset.display_order ?? index,
  };
}

