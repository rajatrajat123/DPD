import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken } from '@/lib/auth/session';

const BACKEND_URL = process.env.AURA_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080';

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

    try {
      const backendRes = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ email, password }),
        cache: 'no-store',
      });

      const data = await backendRes.json();

      if (!backendRes.ok) {
        return NextResponse.json(
          { error: data.message || data.error || 'Authentication failed' },
          { status: backendRes.status }
        );
      }

      // Success: backend returned AuthResponse with real JWT
      const accessToken = data.access_token;
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
    } catch (fetchErr) {
      // Backend offline fallback in development mode
      if (process.env.NODE_ENV !== 'production') {
        const devUserId = 'usr_' + Buffer.from(email).toString('hex').slice(0, 12);
        const token = createSessionToken(devUserId, email);
        if (!token) {
          return NextResponse.json(
            { error: 'Session signing secret is not configured' },
            { status: 500 }
          );
        }

        const res = NextResponse.json({
          success: true,
          user: { id: devUserId, email },
          warning: 'Backend API offline; created local developer session',
          redirect: '/app/discovery',
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
