import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function GET(req: NextRequest) {
  return proxyToBackend(req, '/api/v1/discovery/matching-summary', () => {
    return new Response(
      JSON.stringify({
        count: 0,
        display_text: 'Fewer than 5 people match your preferences nearby.',
        privacy_floor_applied: true,
        cached_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 300000).toISOString(),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });
}
