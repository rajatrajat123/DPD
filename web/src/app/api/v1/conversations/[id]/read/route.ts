import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const backendPath = `/api/v1/conversations/${encodeURIComponent(id)}/read`;

  return proxyToBackend(req, backendPath, () => {
    return NextResponse.json({
      status: 'READ',
      conversation_id: id,
    });
  });
}
