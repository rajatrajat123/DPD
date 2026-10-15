import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function POST(req: NextRequest) {
  let body: { target_user_id?: string } | null = null;
  try {
    body = await req.clone().json();
  } catch {
    // ignore
  }

  return proxyToBackend(req, '/api/v1/blocks', () => {
    return NextResponse.json(
      {
        status: 'BLOCKED',
        user_id: body?.target_user_id || 'unknown',
      },
      { status: 201 }
    );
  });
}
