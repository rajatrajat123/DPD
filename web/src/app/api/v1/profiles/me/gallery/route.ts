import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function GET(req: NextRequest) {
  return proxyToBackend(req, `/api/v1/profiles/me/gallery${req.nextUrl.search}`);
}
