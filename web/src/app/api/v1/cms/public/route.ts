import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function GET(req: NextRequest) {
  const query = req.nextUrl.search || '';
  return proxyToBackend(req, `/api/v1/cms/public${query}`);
}
