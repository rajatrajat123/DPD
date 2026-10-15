import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SITE_CONFIG, MARKET_CLEARANCE_REGISTRY } from '@/lib/seo/config';

// Sensitive / private paths that must NEVER be crawled or exposed
const PRIVATE_ROUTE_PREFIXES = [
  '/app',
  '/onboarding',
  '/api/private',
  '/auth',
  '/messages',
  '/matches',
  '/profile',
  '/settings',
  '/account',
  '/admin',
  '/affiliate',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Check for restricted country matchmaking paths (disabled by default until legal/safety review)
  if (SITE_CONFIG.enableRegionalRestrictions) {
    const segments = pathname.split('/').filter(Boolean);
    const potentialMarket = segments[0]?.toLowerCase();

    if (potentialMarket && MARKET_CLEARANCE_REGISTRY[potentialMarket]) {
      const market = MARKET_CLEARANCE_REGISTRY[potentialMarket];
      if (market.legalStatus === 'RESTRICTED_SAFETY_ONLY') {
        const isDatingLander = segments.length > 1 && (segments[1] === 'dating' || segments[1].includes('dating'));
        if (isDatingLander) {
          const safetyUrl = new URL(`/${potentialMarket}/safety`, request.url);
          const redirectResponse = NextResponse.redirect(safetyUrl, 307);
          redirectResponse.headers.set('X-Robots-Tag', 'noindex, nofollow');
          return redirectResponse;
        }
      }
    }
  }

  // 2. Private & Authenticated Route Security Enforcement
  const isPrivateRoute = PRIVATE_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (isPrivateRoute) {
    const sessionToken = request.cookies.get('aura_session')?.value;

    // If attempting to access member-only content without an active session
    if (!sessionToken && !pathname.startsWith('/auth')) {
      const loginUrl = new URL('/auth/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      const redirectResponse = NextResponse.redirect(loginUrl, 302);

      // Defend against search crawlers even during redirects
      redirectResponse.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
      redirectResponse.headers.set(
        'Cache-Control',
        'private, no-cache, no-store, max-age=0, must-revalidate'
      );
      return redirectResponse;
    }

    // Authenticated private page response
    const response = NextResponse.next();
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
    response.headers.set('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    return response;
  }

  // 3. Trailing Slash Normalization (consistent trailing-slash policy: no trailing slash)
  if (pathname.length > 1 && pathname.endsWith('/')) {
    const cleanUrl = new URL(pathname.slice(0, -1), request.url);
    cleanUrl.search = request.nextUrl.search;
    return NextResponse.redirect(cleanUrl, 308);
  }

  // 4. URL Uppercase Normalization (enforce lowercase URLs for SEO consistency)
  if (/[A-Z]/.test(pathname)) {
    const lowercaseUrl = new URL(pathname.toLowerCase(), request.url);
    lowercaseUrl.search = request.nextUrl.search;
    return NextResponse.redirect(lowercaseUrl, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)'],
};
