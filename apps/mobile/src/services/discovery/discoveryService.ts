import { api, ApiError } from '../api/client';
import {
  DiscoveryCandidate,
  DiscoveryPreferences,
  SwipeDirection,
  SwipeResponse,
  RewindResponse,
} from '../../types';

export interface FeedResponse {
  candidates: DiscoveryCandidate[];
  next_cursor?: string;
  dealbreakers_applied?: boolean;
}

export interface MatchingSummaryResponse {
  nearby_count_bracket: string;
  verified_percentage: number;
  dealbreakers_active: boolean;
}

export const discoveryService = {
  /**
   * Fetches discovery feed adhering strictly to server-side dealbreakers
   */
  async getFeed(limit = 20, cursor?: string): Promise<FeedResponse> {
    return api.get<FeedResponse>('/api/v1/discovery/feed', {
      limit,
      cursor,
    });
  },

  /**
   * Submits a swipe action to backend
   */
  async swipe(targetUserId: string, direction: SwipeDirection, introNote?: string): Promise<SwipeResponse> {
    return api.post<SwipeResponse>('/api/v1/swipes', {
      target_user_id: targetUserId,
      direction,
      intro_note: introNote,
    });
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
};
