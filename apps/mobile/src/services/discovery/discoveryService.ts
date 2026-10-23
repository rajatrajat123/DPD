import { api, ApiError } from '../api/client';
import { SwipeAllowance } from '../ads/admobService';
import {
  DiscoveryCandidate,
  DiscoveryPreferences,
  SwipeDirection,
  SwipeResponse,
  RewindResponse,
  ProfilePhoto,
  DiscoveryMessagingQuota,
  LikesYouResponse,
  LikesYouUnlockAdResponse,
  FavouriteProfileCard,
  ListFavouritesResponse,
  AddFavouriteResponse,
  RemoveFavouriteResponse,
} from '../../types';
import { buildMediaUrl } from '../media/mediaUploader';

export interface FeedResponse {
  candidates: DiscoveryCandidate[];
  next_cursor?: string;
  count?: number;
  empty_state_reason?: string;
  dealbreakers_applied?: boolean;
}

export interface MatchingSummaryResponse {
  nearby_count_bracket: string;
  verified_percentage: number;
  dealbreakers_active: boolean;
}

export function normalizeCandidate(raw: any): DiscoveryCandidate {
  const rawPhotos = Array.isArray(raw.photos) ? raw.photos : [];
  const photos: ProfilePhoto[] = rawPhotos.map((p: any, idx: number) => {
    const rawUrl = p.card_url || p.full_url || p.url || p.thumb_url || '';
    const rawThumb = p.thumb_url || p.card_url || p.url || '';
    return {
      id: p.asset_id || p.id || `photo_${idx}`,
      url: buildMediaUrl(rawUrl),
      thumb_url: rawThumb ? buildMediaUrl(rawThumb) : undefined,
      is_primary: idx === 0,
      order: p.order ?? idx,
    };
  });

  if (photos.length === 0 && (raw.avatar_url || raw.photo_url)) {
    const fallbackUrl = raw.avatar_url || raw.photo_url;
    photos.push({
      id: 'photo_avatar',
      url: buildMediaUrl(fallbackUrl),
      thumb_url: buildMediaUrl(fallbackUrl),
      is_primary: true,
      order: 0,
    });
  }

  return {
    id: raw.user_id || raw.id,
    user_id: raw.user_id || raw.id,
    display_name: raw.display_name || '',
    age: raw.age || 0,
    bio: raw.bio || '',
    pronouns: raw.pronouns || [],
    gender_identities: raw.gender_identities || [],
    sexual_orientations: raw.sexual_orientations || [],
    relationship_intents: raw.relationship_intents || [],
    smoking_preference: raw.smoking_habit || raw.smoking_preference || 'NON_SMOKER',
    distance_bucket_km: raw.approximate_distance_km ?? raw.distance_bucket_km ?? 1,
    photos,
    compatibility_score: raw.compatibility_score || 0,
    is_verified: Boolean(raw.is_photo_verified || raw.is_verified),
    relationship_structure: raw.relationship_structure,
    height_cm: raw.height_cm,
    weight_kg: raw.weight_kg,
    is_online: raw.is_online !== undefined ? Boolean(raw.is_online) : true,
  };
}

export interface ClaimSwipeRewardResult extends SwipeAllowance {
  isPending?: boolean;
  status?: string;
}

export const discoveryService = {
  /**
   * Fetches discovery feed adhering strictly to server-side dealbreakers
   */
  async getFeed(limit = 20, cursor?: string, autoExpand = true): Promise<FeedResponse> {
    const res = await api.get<{
      candidates?: any[];
      next_cursor?: string;
      count?: number;
      empty_state_reason?: string;
    }>('/api/v1/discovery/feed', {
      limit,
      cursor,
      auto_expand: autoExpand,
    });

    const candidates: DiscoveryCandidate[] = (res.candidates || []).map(normalizeCandidate);

    return {
      candidates,
      next_cursor: res.next_cursor,
      count: res.count ?? candidates.length,
      empty_state_reason: res.empty_state_reason,
      dealbreakers_applied: true,
    };
  },

  /**
   * Searches public eligible profiles by query (display name, bio, tags)
   */
  async search(query: string, limit = 20): Promise<FeedResponse> {
    const trimmed = (query || '').trim();
    if (trimmed.length < 2) {
      return {
        candidates: [],
        count: 0,
        dealbreakers_applied: false,
      };
    }

    const res = await api.get<{
      candidates?: any[];
      count?: number;
      query?: string;
    }>('/api/v1/discovery/search', {
      q: trimmed,
      limit,
    });

    const candidates: DiscoveryCandidate[] = (res.candidates || []).map(normalizeCandidate);

    return {
      candidates,
      count: res.count ?? candidates.length,
      dealbreakers_applied: false,
    };
  },

  /**
   * Fetches full public profile details for another member
   */
  async getPublicProfile(userId: string): Promise<DiscoveryCandidate> {
    const res = await api.get<any>(`/api/v1/profiles/${userId}`);
    return normalizeCandidate(res);
  },


  /**
   * Submits a swipe action to backend
   */
  async swipe(targetUserId: string, direction: SwipeDirection, introNote?: string): Promise<SwipeResponse> {
    const raw = await api.post<any>('/api/v1/swipes', {
      target_user_id: targetUserId,
      direction,
      intro_note: introNote,
    });
    const isMatch = Boolean(raw.is_mutual_match || raw.matched);
    const matchId = raw.match_id || raw.match?.id;
    return {
      swipe_id: raw.swipe_id || '',
      is_mutual_match: isMatch,
      match_id: matchId,
      conversation_id: raw.conversation_id || matchId,
      remaining_likes_today: raw.remaining_likes_today ?? (raw.daily_swipes_remaining ?? 9999),
    };
  },

  /**
   * Undoes the last PASS action (Requires Plus/Black entitlement)
   */
  async rewind(): Promise<RewindResponse> {
    return api.post<RewindResponse>('/api/v1/swipes/rewind');
  },

  /**
   * Fetches anonymized matching nearby summary with privacy floor
   */
  async getMatchingSummary(): Promise<MatchingSummaryResponse> {
    return api.get<MatchingSummaryResponse>('/api/v1/discovery/matching-summary');
  },

  /**
   * Fetches user's current discovery preferences
   */
  async getPreferences(): Promise<DiscoveryPreferences> {
    return api.get<DiscoveryPreferences>('/api/v1/profiles/me/preferences');
  },

  /**
   * Updates discovery preferences (including strict non-smoker dealbreaker)
   */
  async updatePreferences(prefs: Partial<DiscoveryPreferences>): Promise<DiscoveryPreferences> {
    const payload: Record<string, unknown> = {};

    if (prefs.min_age !== undefined) payload.min_age = prefs.min_age;
    if (prefs.max_age !== undefined) payload.max_age = prefs.max_age;
    if (prefs.max_distance_km !== undefined) payload.max_distance_km = prefs.max_distance_km;
    if (prefs.preferred_genders !== undefined) payload.preferred_genders = prefs.preferred_genders;
    if (prefs.preferred_intents !== undefined) payload.preferred_intents = prefs.preferred_intents;
    if (prefs.preferred_orientations !== undefined) payload.preferred_orientations = prefs.preferred_orientations;
    if (prefs.min_height_cm !== undefined) payload.min_height_cm = prefs.min_height_cm;
    if (prefs.max_height_cm !== undefined) payload.max_height_cm = prefs.max_height_cm;
    if (prefs.min_weight_kg !== undefined) payload.min_weight_kg = prefs.min_weight_kg;
    if (prefs.max_weight_kg !== undefined) payload.max_weight_kg = prefs.max_weight_kg;
    if (prefs.verified_only !== undefined) payload.verified_profiles_only = prefs.verified_only;

    if (prefs.dealbreakers) {
      payload.dealbreakers = prefs.dealbreakers;
    } else if (prefs.dealbreaker_non_smoker !== undefined) {
      payload.dealbreakers = {
        non_smoker_only: Boolean(prefs.dealbreaker_non_smoker),
        require_verified: Boolean(prefs.verified_only),
        require_monogamous: false,
      };
    }

    const res = await api.put<any>('/api/v1/profiles/me/preferences', payload);

    return {
      min_age: res.min_age ?? 18,
      max_age: res.max_age ?? 99,
      max_distance_km: res.max_distance_km ?? 50,
      preferred_genders: res.preferred_genders ?? [],
      preferred_intents: res.preferred_intents ?? [],
      preferred_orientations: res.preferred_orientations ?? [],
      min_height_cm: res.min_height_cm,
      max_height_cm: res.max_height_cm,
      min_weight_kg: res.min_weight_kg,
      max_weight_kg: res.max_weight_kg,
      dealbreaker_non_smoker: Boolean(res.dealbreakers?.non_smoker_only),
      verified_only: Boolean(res.verified_profiles_only),
      dealbreakers: res.dealbreakers,
    };
  },

  /**
   * Blocks a user with bilateral suppression
   */
  async blockUser(blockedUserId: string, reason?: string): Promise<boolean> {
    await api.post('/api/v1/blocks', {
      blocked_user_id: blockedUserId,
      reason: reason || 'USER_INITIATED_BLOCK',
    });
    return true;
  },

  /**
   * Submits a trust and safety violation report
   */
  async reportUser(reportedUserId: string, category: string, details: string): Promise<boolean> {
    await api.post('/api/v1/reports', {
      reported_user_id: reportedUserId,
      category,
      details,
    });
    return true;
  },

  /**
   * Fetches the current user's Discovery profile messaging quota state
   */
  async getMessagingQuota(): Promise<DiscoveryMessagingQuota> {
    return await api.get<DiscoveryMessagingQuota>('/api/v1/discovery/messaging-quota');
  },

  /**
   * Unlocks 2 bonus message slots via completed rewarded ad
   */
  async unlockMessagingQuotaWithAd(transactionId?: string, rawQuery?: string): Promise<DiscoveryMessagingQuota> {
    return await api.post<DiscoveryMessagingQuota>('/api/v1/discovery/messaging-quota/unlock-ad', {
      transaction_id: transactionId,
      raw_query: rawQuery,
    });
  },

  /**
   * Fetches incoming likes and Likes You unlock state
   */
  async getLikesYou(limit = 20, offset = 0): Promise<LikesYouResponse> {
    return await api.get<LikesYouResponse>(`/api/v1/discovery/likes-you?limit=${limit}&offset=${offset}`);
  },

  /**
   * Unlocks 2 profiles via completed Likes You rewarded ad
   */
  async unlockLikesYouWithAd(transactionId?: string, rawQuery?: string): Promise<LikesYouUnlockAdResponse> {
    return await api.post<LikesYouUnlockAdResponse>('/api/v1/discovery/likes-you/unlock-ad', {
      transaction_id: transactionId,
      raw_query: rawQuery,
    });
  },

  /**
   * Claims 5 bonus likes for photo-verified profiles after rewarded ad completion
   */
  async claimSwipeAdReward(transactionId?: string, rawQuery?: string): Promise<ClaimSwipeRewardResult> {
    const res = await api.post<{
      status: string;
      user_id?: string;
      message?: string;
      daily_quota?: number;
      remaining_likes?: number;
      remaining_regular_likes?: number;
      remaining_bonus_likes?: number;
      is_unlimited?: boolean;
      is_introductory?: boolean;
      window_start?: string;
      window_reset_at?: string;
    }>('/api/v1/swipes/claim-reward', {
      transaction_id: transactionId,
      raw_query: rawQuery,
    });
    if (res.status === 'PENDING') {
      return {
        remainingLikes: 0,
        remainingRegularLikes: 0,
        remainingBonusLikes: 0,
        isUnlimited: false,
        dailyQuota: 15,
        isPending: true,
        status: 'PENDING',
      };
    }
    return {
      remainingLikes: res.remaining_likes ?? 0,
      remainingRegularLikes: res.remaining_regular_likes ?? 0,
      remainingBonusLikes: res.remaining_bonus_likes ?? 0,
      isUnlimited: Boolean(res.is_unlimited),
      isIntroductory: res.is_introductory,
      dailyQuota: res.daily_quota || 15,
      windowResetAt: res.window_reset_at,
      isPending: false,
      status: res.status || 'REWARD_CLAIMED',
    };
  },

  /**
   * Fetches the current user's saved favourite profiles
   */
  async getFavourites(): Promise<ListFavouritesResponse> {
    const res = await api.get<ListFavouritesResponse>('/api/v1/discovery/favourites');
    return {
      count: res.count ?? (res.favourites ? res.favourites.length : 0),
      favourites: res.favourites || [],
    };
  },

  /**
   * Saves a profile to current user's favourites (strictly private bookmark)
   */
  async addFavourite(targetUserId: string): Promise<AddFavouriteResponse> {
    return await api.post<AddFavouriteResponse>('/api/v1/discovery/favourites', {
      target_user_id: targetUserId,
    });
  },

  /**
   * Removes a profile from current user's favourites
   */
  async removeFavourite(targetUserId: string): Promise<RemoveFavouriteResponse> {
    return await api.delete<RemoveFavouriteResponse>(`/api/v1/discovery/favourites/${targetUserId}`);
  },
};
