import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function POST(req: NextRequest) {
  return proxyToBackend(req, '/api/v1/reports', () => {
    return new Response(
      JSON.stringify({
        success: true,
        report_id: 'rep_' + crypto.randomUUID().slice(0, 8),
        status: 'SUBMITTED',
        message: 'Your report has been submitted to the Trust & Safety team. The reported member has been temporarily hidden from your discovery feed.',
      }),
      { status: 201, headers: { 'content-type': 'application/json' } }
    );
  });
}
