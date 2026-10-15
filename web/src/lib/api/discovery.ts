/**
 * Discovery, Swiping and Matching API Client
 * Connects consumer frontend to the Aura Discovery Engine.
 */

export type SwipeDirection = 'LIKE' | 'PASS' | 'SUPER_SPARK';
export type MatchStatus = 'ACTIVE' | 'UNMATCHED' | 'BLOCKED';

export interface PhotoCard {
  asset_id: string;
  thumb_url: string;
  card_url: string;
  full_url: string;
}

export interface DiscoveryCandidate {
  user_id: string;
  display_name: string;
  age: number;
  bio: string;
  pronouns: string[];
  gender_identities: string[];
  sexual_orientations: string[];
  relationship_intents: string[];
  relationship_structure?: string;
  approximate_distance_km: number; // Privacy fuzzing: integer km, never exact GPS
  is_photo_verified: boolean;
  compatibility_score: number;
  photos: PhotoCard[];
}

export interface DiscoveryFeedResponse {
  candidates: DiscoveryCandidate[];
  next_cursor?: string;
  count: number;
  empty_state_reason?: string;
}

export interface SwipeRequest {
  target_user_id: string;
  direction: SwipeDirection;
  intro_note?: string;
}

export interface MatchResponse {
  id: string;
  matched_user_id: string;
  matched_profile?: DiscoveryCandidate;
  status: MatchStatus;
  matched_at: string;
}

export interface SwipeResponse {
  matched: boolean;
  match?: MatchResponse;
  daily_swipes_remaining?: number;
  unlimited_swipes_granted: boolean;
  reward_details?: string;
}

export interface MatchesListResponse {
  count: number;
  matches: MatchResponse[];
}

export interface BlockRequest {
  target_user_id: string;
  reason?: string;
}

export interface UnmatchRequest {
  reason?: string;
}

/**
 * Fetch candidates for current member from discovery engine.
 */
export async function getDiscoveryFeed(
  limit: number = 20,
  cursor?: string
): Promise<DiscoveryFeedResponse> {
  const params = new URLSearchParams({ limit: limit.toString() });
  if (cursor) params.set('cursor', cursor);

  const res = await fetch(`/api/v1/discovery/feed?${params.toString()}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = errorBody?.error?.message || errorBody?.message || `Failed to fetch discovery feed (${res.status})`;
    const err = new Error(message);
    (err as any).status = res.status;
    (err as any).code = errorBody?.error?.code || errorBody?.code;
    throw err;
  }

  return res.json();
}

export interface MatchingSummaryResponse {
  count: number;
  display_text: string;
  privacy_floor_applied: boolean;
  cached_at: string;
  expires_at: string;
}

/**
 * Fetch nearby matching summary with privacy floor enforcement.
 */
export async function getMatchingSummary(): Promise<MatchingSummaryResponse> {
  const res = await fetch('/api/v1/discovery/matching-summary', {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = errorBody?.error?.message || errorBody?.message || `Failed to fetch matching summary (${res.status})`;
    const err = new Error(message);
    (err as any).status = res.status;
    (err as any).code = errorBody?.error?.code || errorBody?.code;
    throw err;
  }

  return res.json();
}

/**
 * Submit an idempotent swipe action (LIKE, PASS, or SUPER_SPARK).
 */
export async function submitSwipe(req: SwipeRequest): Promise<SwipeResponse> {
  const res = await fetch('/api/v1/swipes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = errorBody?.error?.message || errorBody?.message || `Failed to record swipe (${res.status})`;
    const err = new Error(message);
    (err as any).status = res.status;
    (err as any).code = errorBody?.error?.code || errorBody?.code;
    throw err;
  }

  return res.json();
}

/**
 * List all active mutual matches.
 */
export async function getMatches(): Promise<MatchesListResponse> {
  const res = await fetch('/api/v1/matches', {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = errorBody?.error?.message || errorBody?.message || `Failed to fetch matches (${res.status})`;
    const err = new Error(message);
    (err as any).status = res.status;
    (err as any).code = errorBody?.error?.code || errorBody?.code;
    throw err;
  }

  return res.json();
}

/**
 * Dissolve a match relationship.
 */
export async function unmatch(matchId: string, reason?: string): Promise<{ status: string; match_id: string }> {
  const res = await fetch(`/api/v1/matches/${encodeURIComponent(matchId)}/unmatch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ reason }),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to unmatch (${res.status})`);
  }

  return res.json();
}

/**
 * Bilaterally block a user, revoking matches and removing candidate from feeds.
 */
export async function blockUser(targetUserId: string, reason?: string): Promise<{ status: string; user_id: string }> {
  const res = await fetch('/api/v1/blocks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ target_user_id: targetUserId, reason }),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to block user (${res.status})`);
  }

  return res.json();
}
