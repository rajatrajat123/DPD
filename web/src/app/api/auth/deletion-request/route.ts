import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function POST(req: NextRequest) {
  try {
    return await proxyToBackend(req, '/api/v1/auth/deletion-request', () => {
      return NextResponse.json({
        success: true,
        message: 'Deletion request received and recorded for manual review.',
      });
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Failed to process deletion request' },
      { status: 500 }
    );
  }
}
