import { api, ApiError } from '../api/client';
import { secureStorage } from '../storage/secureStore';
import { chatWebSocket } from '../chat/chatService';
import { mediaUploader } from '../media/mediaUploader';
import { User, Profile } from '../../types';

export interface RegisterPayload {
  display_name: string;
  email: string;
  password: string;
  birthdate: string; // YYYY-MM-DD
  gender_identities: string[];
  sexual_orientations: string[];
  preferred_genders?: string[];
  looking_for?: string[];
  referral_code?: string;
  height_cm?: number;
  weight_kg?: number;
}

export interface LoginPayload {
  email: string;
  password: string;
}

/**
 * Google Sign-In sends ONLY the Google-issued ID token. Profile information
 * (display name, birthdate, gender identities, orientations) is never supplied
 * by the client for a Google account: it is collected through the onboarding
 * flow and validated by the backend.
 */
export interface GoogleAuthPayload {
  id_token: string;
}

export interface LinkGooglePayload {
  id_token: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: User;
  profile?: Profile | null;
  /**
   * True when the account has no profile yet (for example a brand new Google
   * account). The client must run the profile onboarding flow before the app
   * can be used.
   */
  onboarding_required?: boolean;
}

export interface AgeAssuranceSession {
  session_id: string;
  vendor_url?: string;
  expires_at?: string;
  status?: string;
}

export interface AgeAssuranceStatus {
  id?: string;
  user_id?: string;
  provider?: string;
  provider_session_id?: string;
  status: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'MANUAL_REVIEW';
  risk_score?: number;
  verified_at?: string;
  expires_at?: string;
  metadata?: {
    media_id?: string;
    [key: string]: any;
  };
}

export const authService = {
  /**
   * Registers new member with strict 18+ validation and display name verification
   */
  async register(payload: RegisterPayload): Promise<AuthResponse> {
    if (!payload.display_name || !payload.display_name.trim()) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'display name cannot be blank', undefined, {
        display_name: 'Display name cannot be blank',
      });
    }

    // Client-side preflight check: ensure birthdate is at least 18 years ago
    const birthDate = new Date(payload.birthdate);
    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    const isAdult = m > 0 || (m === 0 && today.getDate() >= birthDate.getDate()) ? age >= 18 : age - 1 >= 18;

    if (!isAdult) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'Members must be at least 18 years old to join Aura.', undefined, {
        birthdate: 'Must be 18 years or older',
      });
    }

    if (!payload.gender_identities || payload.gender_identities.length === 0) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'At least one gender identity must be selected.', undefined, {
        gender_identities: 'At least one gender identity required',
      });
    }

    if (!payload.sexual_orientations || payload.sexual_orientations.length === 0) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'At least one sexual orientation must be selected.', undefined, {
        sexual_orientations: 'At least one sexual orientation required',
      });
    }

    const preferredGenders = payload.preferred_genders || payload.looking_for || [];

    const res = await api.post<AuthResponse>('/api/v1/auth/register', {
      ...payload,
      display_name: payload.display_name.trim(),
      preferred_genders: preferredGenders,
      looking_for: preferredGenders,
    });
    await secureStorage.saveTokens(res.access_token, res.refresh_token);
    await secureStorage.saveUserData(res.user as unknown as Record<string, unknown>);
    return res;
  },

  /**
   * Authenticates user credentials and securely stores JWT access & refresh tokens
   */
  async login(payload: LoginPayload): Promise<AuthResponse> {
    const res = await api.post<AuthResponse>('/api/v1/auth/login', payload);
    await secureStorage.saveTokens(res.access_token, res.refresh_token);
    await secureStorage.saveUserData(res.user as unknown as Record<string, unknown>);
    return res;
  },

  /**
   * Authenticates via Google OAuth ID token, supporting instant signup and safe account linking
   */
  async loginWithGoogle(payload: GoogleAuthPayload): Promise<AuthResponse> {
    const res = await api.post<AuthResponse>('/api/v1/auth/google', payload);
    await secureStorage.saveTokens(res.access_token, res.refresh_token);
    await secureStorage.saveUserData(res.user as unknown as Record<string, unknown>);
    return res;
  },

  /**
   * Links a verified Google identity to the currently authenticated account.
   * Used when the email already belongs to an Aura account: the authenticated
   * session proves ownership before the identity is attached.
   */
  async linkGoogleIdentity(idToken: string): Promise<void> {
    await api.post('/api/v1/auth/google/link', { id_token: idToken });
  },

  /**
   * Securely revokes session tokens on server and clears device keychain
   */
  async logout(): Promise<void> {
    const refreshToken = await secureStorage.getRefreshToken();
    try {
      if (refreshToken) {
        await api.post('/api/v1/auth/logout', { refresh_token: refreshToken });
      }
    } catch {
      // Proceed with local wipe even if server is unreachable
    } finally {
      chatWebSocket.disconnect();
      await secureStorage.clearTokens();
    }
  },

  /**
   * Fetches full authenticated user profile, preferences, and verified gallery photos.
   *
   * `profile` is null and `onboarding_required` is true for accounts that have not
   * completed profile onboarding (for example a brand new Google account). No
   * profile data is ever fabricated on the client.
   */
  async getMyProfile(): Promise<{
    user: User;
    profile: Profile | null;
    onboarding_required: boolean;
  }> {
    const res = await api.get<{
      user: User;
      profile: Profile | null;
      onboarding_required?: boolean;
      location?: any;
      is_complete?: boolean;
      preferences?: {
        preferred_genders?: string[];
        dealbreakers?: {
          non_smoker_only?: boolean;
          require_verified?: boolean;
          require_monogamous?: boolean;
        };
      };
    }>('/api/v1/profiles/me');

    const onboardingRequired = Boolean(res.onboarding_required) || !res.profile;
    if (onboardingRequired || !res.profile) {
      return { user: res.user, profile: null, onboarding_required: true };
    }

    const rawProfile = { ...res.profile } as any;

    if (res.preferences?.preferred_genders) {
      rawProfile.preferred_genders = res.preferences.preferred_genders;
      rawProfile.looking_for = res.preferences.preferred_genders;
    }

    // Normalize smoking habit and preference
    if (rawProfile.smoking_habit && !rawProfile.smoking_preference) {
      rawProfile.smoking_preference = rawProfile.smoking_habit;
    } else if (rawProfile.smoking_preference && !rawProfile.smoking_habit) {
      rawProfile.smoking_habit = rawProfile.smoking_preference;
    }

    // Normalize dealbreakers and non-smoker dealbreaker from preferences
    if (res.preferences?.dealbreakers) {
      rawProfile.dealbreakers = {
        non_smoker_only: Boolean(res.preferences.dealbreakers.non_smoker_only),
        require_verified: Boolean(res.preferences.dealbreakers.require_verified),
        require_monogamous: Boolean(res.preferences.dealbreakers.require_monogamous),
      };
    }

    if (res.preferences?.dealbreakers?.non_smoker_only !== undefined) {
      rawProfile.non_smoker_dealbreaker = Boolean(res.preferences.dealbreakers.non_smoker_only);
    } else if (rawProfile.non_smoker_dealbreaker === undefined) {
      rawProfile.non_smoker_dealbreaker = true;
    }

    rawProfile.is_complete = res.is_complete ?? (Boolean(rawProfile.height_cm) && Boolean(rawProfile.weight_kg));

    // Populate profile gallery photos from media service
    try {
      const photos = await mediaUploader.getMyGallery();
      rawProfile.photos = photos;
    } catch {
      if (!Array.isArray(rawProfile.photos)) {
        rawProfile.photos = [];
      }
    }

    return {
      user: res.user,
      profile: rawProfile as Profile,
      onboarding_required: false,
    };
  },

  /**
   * Updates display name, bio, pronouns, intents, habits, height, and weight with strict backend DTO alignment
   */
  async updateMyProfile(updates: Partial<Profile>): Promise<Profile> {
    const payload: Record<string, unknown> = {};

    if (updates.display_name !== undefined) {
      payload.display_name = updates.display_name.trim();
    }
    // Birthdate is accepted by the backend only when the profile is created for
    // the first time (onboarding). It is immutable afterwards.
    if (updates.birthdate !== undefined) {
      payload.birthdate = updates.birthdate;
    }
    if (updates.bio !== undefined) {
      payload.bio = updates.bio;
    }
    if (updates.pronouns !== undefined) {
      payload.pronouns = updates.pronouns;
    }
    if (updates.gender_identities !== undefined) {
      payload.gender_identities = updates.gender_identities;
    }
    if (updates.sexual_orientations !== undefined) {
      payload.sexual_orientations = updates.sexual_orientations;
    }
    if (updates.preferred_genders !== undefined) {
      payload.preferred_genders = updates.preferred_genders;
      payload.looking_for = updates.preferred_genders;
    } else if (updates.looking_for !== undefined) {
      payload.preferred_genders = updates.looking_for;
      payload.looking_for = updates.looking_for;
    }
    if (updates.relationship_intents !== undefined) {
      payload.relationship_intents = updates.relationship_intents;
    }
    if (updates.height_cm !== undefined) {
      payload.height_cm = updates.height_cm;
    }
    if (updates.weight_kg !== undefined) {
      payload.weight_kg = updates.weight_kg;
    }
    if (updates.visibility_settings !== undefined) {
      const allowedVisibilityKeys = [
        'gender_identity',
        'sexual_orientation',
        'pronouns',
        'distance',
        'online_status',
        'traveler_safety',
        'height',
        'weight',
      ];
      const sanitizedVisibility: Record<string, unknown> = {};
      const rawVis = updates.visibility_settings as Record<string, unknown>;
      for (const key of allowedVisibilityKeys) {
        if (rawVis[key] !== undefined) {
          sanitizedVisibility[key] = rawVis[key];
        }
      }
      payload.visibility_settings = sanitizedVisibility;
    }

    if (updates.non_smoker_dealbreaker !== undefined) {
      payload.non_smoker_dealbreaker = updates.non_smoker_dealbreaker;
    } else if (updates.dealbreakers?.non_smoker_only !== undefined) {
      payload.non_smoker_dealbreaker = updates.dealbreakers.non_smoker_only;
    }

    // Map smoking preference to backend smoking_habit
    const habit = updates.smoking_habit || updates.smoking_preference;
    if (habit !== undefined) {
      payload.smoking_habit = habit;
    }
    if (updates.drinking_habit !== undefined) {
      payload.drinking_habit = updates.drinking_habit;
    }
    if (updates.relationship_structure !== undefined) {
      payload.relationship_structure = updates.relationship_structure;
    }
    if (updates.interests !== undefined) {
      payload.interests = updates.interests;
    }

    const updated = await api.put<Profile>('/api/v1/profiles/me', payload);

    // Normalize returned profile
    const rawUpdated = updated as any;
    if (rawUpdated.smoking_habit && !rawUpdated.smoking_preference) {
      rawUpdated.smoking_preference = rawUpdated.smoking_habit;
    }
    return rawUpdated as Profile;
  },

  /**
   * Updates user device location (fuzzed server-side for privacy)
   */
  async updateLocation(latitude: number, longitude: number): Promise<{ city: string; region: string }> {
    return api.put<{ city: string; region: string }>('/api/v1/profiles/me/location', {
      latitude,
      longitude,
    });
  },

  /**
   * Request password reset code
   */
  async requestPasswordReset(email: string): Promise<boolean> {
    await api.post('/api/v1/auth/password-reset/request', { email });
    return true;
  },

  /**
   * Confirm password reset with OTP code
   */
  async confirmPasswordReset(token: string, newPassword: string): Promise<boolean> {
    await api.post('/api/v1/auth/password-reset/confirm', {
      token,
      new_password: newPassword,
    });
    return true;
  },

  /**
   * Initiates age assurance session with backend, associating optional selfie media ID
   */
  async startAgeAssuranceSession(mediaId?: string): Promise<AgeAssuranceSession> {
    return api.post<AgeAssuranceSession>(
      '/api/v1/age-assurance/session',
      mediaId ? { media_id: mediaId } : undefined
    );
  },

  /**
   * Fetches authoritative age assurance status from backend
   */
  async getAgeAssuranceStatus(): Promise<AgeAssuranceStatus> {
    return api.get<AgeAssuranceStatus>('/api/v1/age-assurance/status');
  },

  /**
   * Send phone or email auth verification code (OTP)
   */
  async sendAuthVerificationCode(): Promise<{ status: string }> {
    return api.post<{ status: string }>('/api/v1/auth/verify/send');
  },

  /**
   * Request age verification check (backwards compatibility wrapper)
   */
  async requestAgeVerification(): Promise<{ verification_url?: string; status: string; session_id?: string }> {
    const session = await this.startAgeAssuranceSession();
    return {
      session_id: session.session_id,
      verification_url: session.vendor_url,
      status: session.status || 'PENDING',
    };
  },

  /**
   * Permanently deletes the user account, cascading personal data erasure and revoking all sessions
   */
  async deleteAccount(password?: string, reason?: string): Promise<{ success: boolean; message: string }> {
    const res = await api.post<{ success: boolean; message: string }>('/api/v1/auth/delete-account', {
      password: password || '',
      confirm_deletion: true,
      reason: reason || 'user_requested',
    });
    await secureStorage.clearTokens();
    return res;
  },
};
