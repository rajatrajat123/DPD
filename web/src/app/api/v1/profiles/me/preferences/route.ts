import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function GET(req: NextRequest) {
  return proxyToBackend(req, '/api/v1/profiles/me/preferences', () => {
    return new Response(
      JSON.stringify({
        min_age: 21,
        max_age: 45,
        max_distance_km: 50,
        preferred_genders: ['non-binary', 'transgender woman', 'cisgender woman', 'queer'],
        preferred_intents: ['serious dating', 'long-term partner'],
        verified_profiles_only: false,
        non_smoker_only: false,
        require_monogamous: false,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });
}

export async function PUT(req: NextRequest) {
  try {
    const raw = await req.json();
    const sanitized: Record<string, any> = {};

    if (raw.min_age !== undefined) sanitized.min_age = raw.min_age;
    if (raw.max_age !== undefined) sanitized.max_age = raw.max_age;
    if (raw.max_distance_km !== undefined) sanitized.max_distance_km = raw.max_distance_km;
    if (raw.preferred_genders !== undefined) sanitized.preferred_genders = raw.preferred_genders;
    if (raw.preferred_intents !== undefined) sanitized.preferred_intents = raw.preferred_intents;
    if (raw.verified_profiles_only !== undefined) sanitized.verified_profiles_only = raw.verified_profiles_only;
    if (raw.notification_preferences !== undefined) sanitized.notification_preferences = raw.notification_preferences;

    // Handle dealbreakers: support both nested dealbreakers and flat non_smoker_only / require_monogamous
    const dealbreakers: Record<string, any> = { ...(raw.dealbreakers || {}) };
    if (raw.non_smoker_only !== undefined && dealbreakers.non_smoker_only === undefined) {
      dealbreakers.non_smoker_only = raw.non_smoker_only;
    }
    if (raw.require_monogamous !== undefined && dealbreakers.require_monogamous === undefined) {
      dealbreakers.require_monogamous = raw.require_monogamous;
    }
    if (raw.verified_profiles_only !== undefined && dealbreakers.require_verified === undefined) {
      dealbreakers.require_verified = raw.verified_profiles_only;
    }
    if (Object.keys(dealbreakers).length > 0) {
      sanitized.dealbreakers = dealbreakers;
    }

    return proxyToBackend(
      req,
      '/api/v1/profiles/me/preferences',
      () => {
        return new Response(
          JSON.stringify({ success: true, message: 'Preferences updated' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
      JSON.stringify(sanitized)
    );
  } catch {
    return proxyToBackend(req, '/api/v1/profiles/me/preferences');
  }
}
