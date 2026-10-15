import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function GET(req: NextRequest) {
  return proxyToBackend(req, '/api/v1/billing/subscription', () => {
    return new Response(
      JSON.stringify({
        tier: 'MEMBER',
        status: 'ACTIVE',
        is_paid: false,
        entitlements: ['BASIC_DISCOVERY', 'MUTUAL_CHAT'],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });
}
