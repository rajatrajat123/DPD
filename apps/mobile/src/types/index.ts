export type AccountStatus = 'ACTIVE' | 'PENDING_VERIFICATION' | 'SUSPENDED' | 'BANNED';

export type UserRole =
  | 'MEMBER'
  | 'SUPER_ADMIN'
  | 'TRUST_AND_SAFETY'
  | 'FINANCE_ADMIN'
  | 'EDITORIAL_CMS'
  | 'CUSTOMER_SUPPORT'
  | 'AFFILIATE_MANAGER';

export interface User {
  id: string;
  email: string;
  phone?: string;
  role: UserRole;
  status: AccountStatus;
  is_age_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProfilePhoto {
  id: string;
  url: string;
  thumb_url?: string;
  is_primary: boolean;
  order: number;
}

export type SmokingPreference = 'NON_SMOKER' | 'SOCIAL_SMOKER' | 'REGULAR_SMOKER';

export interface Profile {
  id: string;
  user_id: string;
  display_name: string;
  birthdate: string;
  age: number;
  bio: string;
  pronouns: string[];
  gender_identities: string[];
  sexual_orientations: string[];
  preferred_genders?: string[];
  looking_for?: string[];
  relationship_intents: string[];
  smoking_preference: SmokingPreference;
  smoking_habit?: SmokingPreference;
  drinking_habit?: 'NEVER' | 'SOCIALLY' | 'FREQUENTLY' | 'SOBER' | 'PREFER_NOT_TO_SAY' | string;
  relationship_structure?: 'MONOGAMOUS' | 'ENM' | 'POLYAMOROUS' | 'OPEN' | 'EXPLORING' | string;
  interests?: string[];
  non_smoker_dealbreaker: boolean;
  dealbreakers?: {
    non_smoker_only?: boolean;
    require_verified?: boolean;
    require_monogamous?: boolean;
  };
  height_cm?: number;
  weight_kg?: number;
  visibility_settings?: {
    height?: string;
    weight?: string;
    [key: string]: any;
  };
  is_complete?: boolean;
  city?: string;
  region?: string;
  photos: ProfilePhoto[];
  is_age_verified: boolean;
  is_photo_verified?: boolean;
  verification_status: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  photo_verification_status?: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
}

export interface DiscoveryPreferences {
  min_age: number;
  max_age: number;
  max_distance_km: number;
  preferred_genders: string[];
  preferred_intents: string[];
  preferred_orientations?: string[];
  min_height_cm?: number;
  max_height_cm?: number;
  min_weight_kg?: number;
  max_weight_kg?: number;
  dealbreaker_non_smoker: boolean;
  verified_only: boolean;
  verified_profiles_only?: boolean;
  dealbreakers?: {
    non_smoker_only: boolean;
    require_verified?: boolean;
    require_monogamous?: boolean;
  };
}

export interface DiscoveryCandidate {
  id: string;
  user_id: string;
  display_name: string;
  age: number;
  bio: string;
  pronouns: string[];
  gender_identities: string[];
  sexual_orientations: string[];
  relationship_intents: string[];
  smoking_preference: SmokingPreference;
  distance_bucket_km: number;
  height_cm?: number;
  weight_kg?: number;
  photos: ProfilePhoto[];
  compatibility_score: number;
  is_verified: boolean;
  relationship_structure?: string;
}

export type MessageRequestStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'BLOCKED';

export interface MessageRequest {
  id: string;
  sender_user_id: string;
  recipient_user_id: string;
  body: string;
  status: MessageRequestStatus;
  created_at: string;
  responded_at?: string;
  sender_id?: string;
  sender_name?: string;
  sender_age?: number;
  sender_avatar?: string;
  sender_is_verified?: boolean;
  sender?: {
    user_id: string;
    display_name: string;
    age: number;
    avatar_url?: string;
    is_photo_verified: boolean;
  };
}

export type SwipeDirection = 'LIKE' | 'PASS' | 'SUPER_SPARK';

export interface SwipeRequest {
  target_user_id: string;
  direction: SwipeDirection;
  intro_note?: string;
}

export interface SwipeResponse {
  swipe_id: string;
  is_mutual_match: boolean;
  match_id?: string;
  conversation_id?: string;
  remaining_likes_today: number;
}

export interface RewindResponse {
  success: boolean;
  restored_user_id: string;
  remaining_rewinds?: number;
}

export interface Match {
  id: string;
  user_id: string;
  target_user_id: string;
  target_profile: {
    user_id: string;
    display_name: string;
    avatar_url?: string;
    is_verified: boolean;
    gender_identities?: string[];
  };
  matched_at: string;
}

export interface Conversation {
  id: string;
  match_id: string;
  participant_id: string;
  participant_name: string;
  participant_avatar?: string;
  participant_verified: boolean;
  last_message?: {
    id: string;
    sender_id: string;
    content: string;
    created_at: string;
    read: boolean;
  };
  unread_count: number;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  client_message_id?: string;
  body: string;
  message_type?: string;
  media_asset_id?: string;
  delivered_at?: string | null;
  read_at?: string | null;
  created_at: string;

  // Backwards compatibility aliases
  sender_id?: string;
  recipient_id?: string;
  content?: string;
  media_url?: string;
  audio_duration_ms?: number;
  status?: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: User;
  profile?: Profile;
}

export interface BillingPlan {
  id: string;
  plan_code: string;
  name: string;
  description: string;
  tier: 'PLUS' | 'BLACK';
  billing_period: 'MONTHLY' | 'ANNUAL';
  price_cents: number;
  currency: string;
  entitlements: string[];
  boost_credits: number;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan_code: string;
  provider: 'APPLE_APP_STORE' | 'GOOGLE_PLAY' | 'STRIPE';
  status: 'ACTIVE' | 'TRIALING' | 'GRACE_PERIOD' | 'CANCELED' | 'EXPIRED';
  currency: string;
  price_cents: number;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
}

export interface EntitlementsResponse {
  has_active_subscription: boolean;
  tier: string;
  subscription?: Subscription;
  entitlements: string[];
  boost_credits_remaining: number;
  active_boost?: {
    id: string;
    duration_minutes: number;
    multiplier: number;
    activated_at: string;
    expires_at: string;
    status: string;
  };
}

export interface NotificationPreferences {
  push_enabled: boolean;
  matches_push: boolean;
  messages_push: boolean;
  likes_push: boolean;
  marketing_push: boolean;
  hide_sensitive_preview: boolean;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id?: string;
    timestamp?: string;
    fields?: Record<string, string>;
  };
}
