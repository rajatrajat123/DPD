import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function GET(req: NextRequest) {
  return proxyToBackend(req, '/api/v1/discovery/favourites');
}

export async function POST(req: NextRequest) {
  return proxyToBackend(req, '/api/v1/discovery/favourites');
}

export async function DELETE(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams.toString();
  const backendPath = `/api/v1/discovery/favourites${searchParams ? `?${searchParams}` : ''}`;
  return proxyToBackend(req, backendPath);
}
