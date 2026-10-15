import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const backendPath = `/api/v1/matches/${encodeURIComponent(id)}/unmatch`;

  return proxyToBackend(req, backendPath, () => {
    return NextResponse.json({
      status: 'UNMATCHED',
      match_id: id,
    });
  });
}
