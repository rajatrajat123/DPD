import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const backendPath = `/api/v1/billing/${path.join('/')}${req.nextUrl.search}`;
  return proxyToBackend(req, backendPath);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const backendPath = `/api/v1/billing/${path.join('/')}${req.nextUrl.search}`;
  return proxyToBackend(req, backendPath);
}
