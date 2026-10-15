import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

const isProduction = process.env.NODE_ENV === 'production';

export async function GET(req: NextRequest) {
  return proxyToBackend(req, '/api/v1/age-assurance/status', () => {
    if (isProduction) {
      return NextResponse.json(
        {
          code: 'AGE_ASSURANCE_UNAVAILABLE',
          message: 'Age assurance service is temporarily unavailable',
          is_verified: false,
          status: 'PENDING',
        },
        { status: 503 }
      );
    }

    // In non-production development fallback, strictly fail-closed: not verified
    return NextResponse.json(
      {
        is_verified: false,
        status: 'PENDING',
        method: 'DEV_MOCK',
      },
      { status: 200 }
    );
  });
}
