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
  avatar_url?: string;
  has_super_liked?: boolean;
  is_super_like?: boolean;
  is_favourite?: boolean;
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

export interface IncomingLikeCard {
  user_id: string;
  display_name: string;
  age: number;
  bio: string;
  approximate_distance_km: number;
  is_photo_verified: boolean;
  is_revealed: boolean;
  liked_at: string;
  photos: PhotoCard[];
  blurred_photo_url?: string;
  interaction_type?: string;
  is_super_like?: boolean;
}

export interface LikesYouResponse {
  total_likes: number;
  revealed_count: number;
  unrevealed_count: number;
  free_reveals_remaining: number;
  bonus_reveals_remaining: number;
  cooldown_active: boolean;
  cooldown_remaining_seconds: number;
  rewarded_ad_enabled: boolean;
  likes: IncomingLikeCard[];
}

export interface FavouriteProfileCard {
  user_id: string;
  display_name: string;
  age: number;
  bio: string;
  photo_url?: string;
  added_at: string;
}

export interface ListFavouritesResponse {
  count: number;
  favourites: FavouriteProfileCard[];
}

export interface AddFavouriteResponse {
  success: boolean;
  target_user_id: string;
  added_at: string;
}

export interface RemoveFavouriteResponse {
  success: boolean;
  target_user_id: string;
}

/**
 * Fetch incoming likes for the current member.
 */
export async function getLikesYou(limit: number = 20, offset: number = 0): Promise<LikesYouResponse> {
  const params = new URLSearchParams({ limit: limit.toString(), offset: offset.toString() });
  const res = await fetch(`/api/v1/discovery/likes-you?${params.toString()}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = errorBody?.error?.message || errorBody?.message || `Failed to fetch incoming likes (${res.status})`;
    const err = new Error(message);
    (err as any).status = res.status;
    (err as any).code = errorBody?.error?.code || errorBody?.code;
    throw err;
  }

  return res.json();
}

/**
 * Reveal an incoming like.
 */
export async function revealLike(targetUserId: string): Promise<{ status: string; card: IncomingLikeCard; source: string }> {
  const res = await fetch('/api/v1/discovery/likes-you/reveal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ target_user_id: targetUserId }),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = errorBody?.error?.message || errorBody?.message || `Failed to reveal profile (${res.status})`;
    const err = new Error(message);
    (err as any).status = res.status;
    (err as any).code = errorBody?.error?.code || errorBody?.code;
    throw err;
  }

  return res.json();
}

/**
 * List all saved favourite profiles.
 */
export async function getFavourites(): Promise<ListFavouritesResponse> {
  const res = await fetch('/api/v1/discovery/favourites', {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = errorBody?.error?.message || errorBody?.message || `Failed to fetch favourites (${res.status})`;
    const err = new Error(message);
    (err as any).status = res.status;
    (err as any).code = errorBody?.error?.code || errorBody?.code;
    throw err;
  }

  return res.json();
}

/**
 * Add a profile to favourites.
 */
export async function addFavourite(targetUserId: string): Promise<AddFavouriteResponse> {
  const res = await fetch('/api/v1/discovery/favourites', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ target_user_id: targetUserId }),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = errorBody?.error?.message || errorBody?.message || `Failed to save favourite (${res.status})`;
    const err = new Error(message);
    (err as any).status = res.status;
    (err as any).code = errorBody?.error?.code || errorBody?.code;
    throw err;
  }

  return res.json();
}

/**
 * Remove a profile from favourites.
 */
export async function removeFavourite(targetUserId: string): Promise<RemoveFavouriteResponse> {
  const res = await fetch(`/api/v1/discovery/favourites/${encodeURIComponent(targetUserId)}`, {
    method: 'DELETE',
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = errorBody?.error?.message || errorBody?.message || `Failed to remove favourite (${res.status})`;
    const err = new Error(message);
    (err as any).status = res.status;
    (err as any).code = errorBody?.error?.code || errorBody?.code;
    throw err;
  }

  return res.json();
}

