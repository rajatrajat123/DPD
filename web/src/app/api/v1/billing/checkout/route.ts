import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function POST(req: NextRequest) {
  return proxyToBackend(req, '/api/v1/billing/checkout', () => {
    return new Response(
      JSON.stringify({
        status: 'UNCONFIGURED',
        message: 'Live payment provider credentials (e.g. Stripe) are not configured in this environment.',
      }),
      { status: 501, headers: { 'content-type': 'application/json' } }
    );
  });
}
