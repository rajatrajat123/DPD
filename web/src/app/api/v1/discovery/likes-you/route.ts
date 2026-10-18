import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams.toString();
  const backendPath = `/api/v1/discovery/likes-you${searchParams ? `?${searchParams}` : ''}`;
  return proxyToBackend(req, backendPath);
}
