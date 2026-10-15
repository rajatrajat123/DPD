import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function GET(req: NextRequest) {
  return proxyToBackend(req, '/api/v1/profiles/me', () => {
    return new Response(
      JSON.stringify({
        display_name: 'Aura Member',
        birthdate: '1996-06-15',
        bio: 'Living authentically in the city. Passionate about art and queer community.',
        pronouns: ['they/them'],
        gender_identities: ['non-binary'],
        sexual_orientations: ['queer'],
        relationship_intents: ['serious dating'],
        relationship_structure: 'MONOGAMOUS',
        is_photo_verified: false,
        discrete_mode_enabled: false,
        incognito_enabled: false,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });
}

export async function PUT(req: NextRequest) {
  try {
    const raw = await req.json();
    const allowed = [
      'display_name',
      'bio',
      'pronouns',
      'gender_identities',
      'sexual_orientations',
      'relationship_intents',
      'relationship_structure',
      'visibility_settings',
      'discrete_mode_enabled',
      'incognito_enabled',
      'smoking_habit',
      'drinking_habit',
    ];
    const sanitized: Record<string, any> = {};
    for (const key of allowed) {
      if (raw[key] !== undefined) {
        sanitized[key] = raw[key];
      }
    }
    // Taxonomy normalization: 'queer' is a sexual orientation, not a gender identity
    if (Array.isArray(sanitized.gender_identities)) {
      sanitized.gender_identities = sanitized.gender_identities.map((g: string) =>
        g.toLowerCase() === 'queer' ? 'non-binary' : g
      );
    }

    return proxyToBackend(
      req,
      '/api/v1/profiles/me',
      () => {
        return new Response(
          JSON.stringify({ success: true, message: 'Profile updated' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
      JSON.stringify(sanitized)
    );
  } catch {
    return proxyToBackend(req, '/api/v1/profiles/me');
  }
}
