import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function POST(req: NextRequest) {
  return proxyToBackend(req, '/api/v1/notifications/push-token', () => {
    return NextResponse.json(
      { status: 'REGISTERED' },
      { status: 201 }
    );
  });
}
