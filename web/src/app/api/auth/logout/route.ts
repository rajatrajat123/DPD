import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const referer = req.headers.get('referer');
  const isFormSubmit = req.headers.get('content-type')?.includes('application/x-www-form-urlencoded');

  let res: NextResponse;
  if (isFormSubmit) {
    res = NextResponse.redirect(new URL('/', req.url), 303);
  } else {
    res = NextResponse.json({ success: true, redirect: '/' });
  }

  res.cookies.set('aura_session', '', {
    path: '/',
    maxAge: 0,
    expires: new Date(0),
    httpOnly: true,
  });

  res.cookies.set('aura_refresh', '', {
    path: '/',
    maxAge: 0,
    expires: new Date(0),
    httpOnly: true,
  });

  res.cookies.set('aura_auth_state', '', {
    path: '/',
    maxAge: 0,
    expires: new Date(0),
    httpOnly: false,
  });

  return res;
}

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/', req.url), 302);
  res.cookies.set('aura_session', '', {
    path: '/',
    maxAge: 0,
    expires: new Date(0),
    httpOnly: true,
  });
  res.cookies.set('aura_refresh', '', {
    path: '/',
    maxAge: 0,
    expires: new Date(0),
    httpOnly: true,
  });
  res.cookies.set('aura_auth_state', '', {
    path: '/',
    maxAge: 0,
    expires: new Date(0),
    httpOnly: false,
  });
  return res;
}
