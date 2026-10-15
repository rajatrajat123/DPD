import { NextRequest, NextResponse } from 'next/server';
import { validatePasswordPolicy } from '@/lib/validation/password';

const BACKEND_URL = process.env.AURA_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080';

export async function POST(req: NextRequest) {
  try {
    const { token, new_password } = await req.json();
    if (!token || !new_password) {
      return NextResponse.json(
        { error: 'Token and new password are required' },
        { status: 400 }
      );
    }

    const pwValidation = validatePasswordPolicy(new_password);
    if (!pwValidation.valid) {
      return NextResponse.json(
        { error: pwValidation.error || 'Password does not meet security requirements' },
        { status: 400 }
      );
    }

    try {
      const backendRes = await fetch(`${BACKEND_URL}/api/v1/auth/password-reset/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ token, new_password }),
        cache: 'no-store',
      });

      const data = await backendRes.json();
      return NextResponse.json(data, { status: backendRes.status });
    } catch {
      return NextResponse.json(
        { error: 'Password reset service is temporarily unavailable' },
        { status: 503 }
      );
    }
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request' },
      { status: 400 }
    );
  }
}
