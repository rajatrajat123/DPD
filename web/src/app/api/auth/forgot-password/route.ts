import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.AURA_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'Email address is required' }, { status: 400 });
    }

    let backendRes: Response;
    try {
      backendRes = await fetch(`${BACKEND_URL}/api/v1/auth/password-reset/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ email }),
        cache: 'no-store',
      });
    } catch {
      // The backend is the only authority that may dispatch a reset message.
      // Never report success when nothing was actually sent.
      return NextResponse.json(
        { error: 'Password reset service is temporarily unavailable' },
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
        { error: data.message || data.error || 'Unable to process password reset request' },
        { status: backendRes.status }
      );
    }

    return NextResponse.json({
      success: true,
      message:
        data.message ||
        'If an account exists for this email, password reset instructions have been dispatched.',
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request' },
      { status: 400 }
    );
  }
}
