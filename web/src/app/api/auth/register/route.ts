import { NextRequest, NextResponse } from 'next/server';
import { validatePasswordPolicy } from '@/lib/validation/password';

const BACKEND_URL = process.env.AURA_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080';

/**
 * Production must never silently fall back to a localhost/LAN API URL.
 */
function backendUrlMisconfigured(): boolean {
  return (
    process.env.NODE_ENV === 'production' &&
    !process.env.AURA_API_URL &&
    !process.env.NEXT_PUBLIC_API_URL
  );
}

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

    // Profile identity fields are supplied by the member, never invented here.
    if (!Array.isArray(gender_identities) || gender_identities.length === 0) {
      return NextResponse.json(
        { error: 'At least one gender identity must be selected' },
        { status: 400 }
      );
    }

    if (!Array.isArray(sexual_orientations) || sexual_orientations.length === 0) {
      return NextResponse.json(
        { error: 'At least one sexual orientation must be selected' },
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

    if (backendUrlMisconfigured()) {
      return NextResponse.json(
        { error: 'Authentication service is not configured' },
        { status: 503 }
      );
    }

    const payload: Record<string, unknown> = {
      email,
      password,
      display_name,
      birthdate,
      gender_identities,
      sexual_orientations,
    };
    if (pronouns !== undefined) payload.pronouns = pronouns;
    if (relationship_intents !== undefined) payload.relationship_intents = relationship_intents;
    if (relationship_structure !== undefined) payload.relationship_structure = relationship_structure;

    let backendRes: Response;
    try {
      backendRes = await fetch(`${BACKEND_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
    } catch {
      // The backend is the only authority that may create an account. Never
      // fabricate a user, a session or a success response when it is down.
      return NextResponse.json(
        { error: 'Authentication service temporarily unreachable' },
        { status: 503 }
      );
    }

    let data: any = {};
    try {
      data = await backendRes.json();
    } catch {
      data = {};
    }

    if (!backendRes.ok) {
      return NextResponse.json(
        { error: data.message || data.error || 'Registration failed' },
        { status: backendRes.status }
      );
    }

    const accessToken = data.access_token;
    if (!accessToken) {
      return NextResponse.json(
        { error: 'Authentication service returned an invalid session' },
        { status: 502 }
      );
    }

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
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request payload' },
      { status: 400 }
    );
  }
}
