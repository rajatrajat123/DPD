import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function POST(req: NextRequest) {
  try {
    const res = await proxyToBackend(req, '/api/v1/auth/delete-account');
    if (res.ok) {
      const json = await res.json().catch(() => ({ success: true }));
      const response = NextResponse.json(json, { status: res.status });
      response.cookies.set('aura_session', '', { path: '/', maxAge: 0, expires: new Date(0), httpOnly: true });
      response.cookies.set('aura_refresh', '', { path: '/', maxAge: 0, expires: new Date(0), httpOnly: true });
      response.cookies.set('aura_auth_state', '', { path: '/', maxAge: 0, expires: new Date(0), httpOnly: false });
      return response;
    }
    return res;
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Failed to process account deletion' },
      { status: 500 }
    );
  }
}
