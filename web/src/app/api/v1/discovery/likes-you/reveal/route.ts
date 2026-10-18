import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function POST(req: NextRequest) {
  return proxyToBackend(req, '/api/v1/discovery/likes-you/reveal');
}
