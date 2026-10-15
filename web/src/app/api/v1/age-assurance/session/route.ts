import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

const BACKEND_URL = process.env.AURA_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080';
const isProduction = process.env.NODE_ENV === 'production';

export async function POST(req: NextRequest) {
  const backendRes = await proxyToBackend(req, '/api/v1/age-assurance/session', () => {
    if (isProduction) {
      return NextResponse.json(
        {
          code: 'AGE_ASSURANCE_UNAVAILABLE',
          message: 'Age assurance service is temporarily unavailable',
          status: 'PENDING',
        },
        { status: 503 }
      );
    }

    // In local development fallback when backend is unavailable, fail-closed with pending status
    return NextResponse.json(
      {
        session_id: 'dev_inq_' + crypto.randomUUID().slice(0, 8),
        provider: 'DEV_MOCK',
        verification_url: 'https://dev-verify.aura.local/session',
        status: 'PENDING',
        message: 'Dev age assurance session initiated. Awaiting verification.',
      },
      { status: 200 }
    );
  });

  if (!backendRes.ok) {
    return backendRes;
  }

  // Strictly non-production: DevAgeAssuranceProvider mock webhook dispatch
  if (!isProduction) {
    try {
      const data = await backendRes.clone().json();
      if (data?.session_id && data.session_id.startsWith('dev_inq_')) {
        try {
          await fetch(`${BACKEND_URL}/api/v1/age-assurance/webhook/`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Age-Signature': 'dev-mock-valid-sig',
            },
            body: JSON.stringify({
              event_id: 'evt_dev_' + crypto.randomUUID(),
              session_id: data.session_id,
              status: 'VERIFIED',
              risk_score: 0,
            }),
          });
        } catch {
          // webhook dispatch non-fatal
        }
      }
    } catch {
      // pass through
    }
  }

  return backendRes;
}

