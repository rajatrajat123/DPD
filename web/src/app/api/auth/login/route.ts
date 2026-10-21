import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.AURA_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080';

/**
 * Production must never silently fall back to a localhost/LAN API URL: a
 * misconfigured deployment should fail loudly instead of pointing at a
 * developer machine.
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
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    if (backendUrlMisconfigured()) {
      return NextResponse.json(
        { error: 'Authentication service is not configured' },
        { status: 503 }
      );
    }

    let backendRes: Response;
    try {
      backendRes = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ email, password }),
        cache: 'no-store',
      });
    } catch {
      // The backend is the only authentication authority. If it cannot be
      // reached we must never invent a user, a session or a success response.
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
        { error: data.message || data.error || 'Authentication failed' },
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
      redirect: '/app/discovery',
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
