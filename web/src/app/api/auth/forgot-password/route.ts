import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.AURA_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'Email address is required' }, { status: 400 });
    }

    try {
      const backendRes = await fetch(`${BACKEND_URL}/api/v1/auth/password-reset/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ email }),
        cache: 'no-store',
      });

      const data = await backendRes.json();
      return NextResponse.json({
        success: backendRes.ok,
        message: data.message || 'If an account exists for this email, password reset instructions have been dispatched.',
      }, { status: backendRes.status });
    } catch {
      // In dev or if offline, simulate safe generic response (prevent user enumeration)
      return NextResponse.json({
        success: true,
        message: 'If an account exists for this email, password reset instructions have been dispatched.',
      });
    }
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request' },
      { status: 400 }
    );
  }
}
