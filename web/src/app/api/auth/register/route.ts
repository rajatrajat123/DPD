import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken } from '@/lib/auth/session';
import { validatePasswordPolicy } from '@/lib/validation/password';

const BACKEND_URL = process.env.AURA_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      email,
      password,
      display_name,
      birthdate,
      gender_identities,
      sexual_orientations,
      pronouns,
      relationship_intents,
      relationship_structure,
    } = body;

    // Client/BFF preliminary validations
    if (!email || !password || !display_name || !birthdate) {
      return NextResponse.json(
        { error: 'Email, password, display name, and birthdate are required' },
        { status: 400 }
      );
    }

    const pwValidation = validatePasswordPolicy(password);
    if (!pwValidation.valid) {
      return NextResponse.json(
        { error: pwValidation.error || 'Password does not meet security requirements' },
        { status: 400 }
      );
    }

    // Age validation (18+)
    const bDate = new Date(birthdate);
    const today = new Date();
    let age = today.getFullYear() - bDate.getFullYear();
    const m = today.getMonth() - bDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < bDate.getDate())) {
      age--;
    }
    if (age < 18) {
      return NextResponse.json(
        { error: 'Aura is strictly for adults aged 18 and older' },
        { status: 400 }
      );
    }

    const payload = {
      email,
      password,
      display_name,
      birthdate,
      gender_identities: gender_identities || ['non-binary'],
      sexual_orientations: sexual_orientations || ['queer'],
      pronouns: pronouns || ['they/them'],
      relationship_intents: relationship_intents || ['serious dating'],
      relationship_structure: relationship_structure || 'MONOGAMOUS',
    };

    try {
      const backendRes = await fetch(`${BACKEND_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });

      const data = await backendRes.json();

      if (!backendRes.ok) {
        return NextResponse.json(
          { error: data.message || data.error || 'Registration failed' },
          { status: backendRes.status }
        );
      }

      // Success: backend returned AuthResponse with real JWT
      const accessToken = data.access_token;
      const res = NextResponse.json({
        success: true,
        user: data.user,
        profile: data.profile,
        redirect: '/onboarding',
      });

      res.cookies.set('aura_session', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: data.expires_in || 86400 * 7,
      });

      res.cookies.set('aura_auth_state', '1', {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: data.expires_in || 86400 * 7,
      });

      if (data.refresh_token) {
        res.cookies.set('aura_refresh', data.refresh_token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 86400 * 30,
        });
      }

      return res;
    } catch (fetchErr) {
      // Backend offline fallback in development
      if (process.env.NODE_ENV !== 'production') {
        const devUserId = 'usr_' + Buffer.from(email).toString('hex').slice(0, 12);
        const token = createSessionToken(devUserId, email);
        if (!token) {
          return NextResponse.json(
            { error: 'Session signing secret is unconfigured and backend is offline' },
            { status: 500 }
          );
        }

        const res = NextResponse.json({
          success: true,
          user: { id: devUserId, email, role: 'MEMBER' },
          warning: 'Backend API offline; created local developer session',
          redirect: '/onboarding',
        });

        res.cookies.set('aura_session', token, {
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          path: '/',
          maxAge: 86400 * 7,
        });

        res.cookies.set('aura_auth_state', '1', {
          httpOnly: false,
          secure: false,
          sameSite: 'lax',
          path: '/',
          maxAge: 86400 * 7,
        });

        return res;
      }

      return NextResponse.json(
        { error: 'Authentication service temporarily unreachable' },
        { status: 503 }
      );
    }
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request payload' },
      { status: 400 }
    );
  }
}
