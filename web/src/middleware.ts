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

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

interface SessionClaims {
  sub: string;
  role?: string;
  email?: string;
  exp: number;
}

const ADMIN_ROLES = [
  'SUPER_ADMIN',
  'TRUST_AND_SAFETY',
  'FINANCE_ADMIN',
  'EDITORIAL_CMS',
  'CUSTOMER_SUPPORT',
  'AFFILIATE_MANAGER',
];

const ADMIN_SUBPATH_ROLES: Record<string, string[]> = {
  '/admin/super': ['SUPER_ADMIN'],
  '/admin/finance': ['SUPER_ADMIN', 'FINANCE_ADMIN'],
  '/admin/moderation': ['SUPER_ADMIN', 'TRUST_AND_SAFETY'],
  '/admin/affiliate': ['SUPER_ADMIN', 'AFFILIATE_MANAGER'],
  '/admin/cms': ['SUPER_ADMIN', 'EDITORIAL_CMS'],
  '/admin/support': ['SUPER_ADMIN', 'CUSTOMER_SUPPORT'],
};

/**
 * Cryptographically verifies and parses the HS256 JWT access token.
 */
async function verifyAndDecodeSession(token: string, secret: string): Promise<SessionClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, claimsB64, signatureB64] = parts;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${headerB64}.${claimsB64}`));

  if (!constantTimeEqual(bytesToBase64Url(new Uint8Array(signature)), signatureB64)) {
    return null;
  }

  try {
    const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(claimsB64)));
    const expMs = (claims.exp || 0) * 1000;
    if (!claims.sub || expMs <= Date.now()) {
      return null;
    }
    return {
      sub: claims.sub,
      role: claims.role || 'MEMBER',
      email: claims.email,
      exp: expMs,
    };
  } catch {
    return null;
  }
}

/**
 * Verifies the HS256 signature and expiry of the Aura access token. The private
 * route guard must never grant access merely because a cookie is present.
 */
async function isSessionTokenValid(token: string, secret: string): Promise<boolean> {
  const claims = await verifyAndDecodeSession(token, secret);
  return claims !== null;
}

export async function middleware(request: NextRequest) {
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
    const signingSecret = process.env.JWT_SIGNING_SECRET || process.env.AURA_SESSION_HMAC_SECRET;

    // A cookie is only accepted when it carries a valid, unexpired signature.
    const sessionClaims =
      sessionToken && signingSecret && signingSecret.length >= 32
        ? await verifyAndDecodeSession(sessionToken, signingSecret)
        : null;

    const hasValidSession = Boolean(sessionClaims);

    if (!hasValidSession && !pathname.startsWith('/auth')) {
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

    // Role-based Access Control for /admin routes
    if (pathname.startsWith('/admin')) {
      const userRole = sessionClaims?.role || 'MEMBER';
      if (!ADMIN_ROLES.includes(userRole)) {
        const unauthorizedUrl = new URL('/auth/unauthorized', request.url);
        const redirectResponse = NextResponse.redirect(unauthorizedUrl, 302);
        redirectResponse.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
        redirectResponse.headers.set(
          'Cache-Control',
          'private, no-cache, no-store, max-age=0, must-revalidate'
        );
        return redirectResponse;
      }

      // Check specific admin subpath access
      for (const [subpath, allowedRoles] of Object.entries(ADMIN_SUBPATH_ROLES)) {
        if (pathname.startsWith(subpath) && !allowedRoles.includes(userRole)) {
          const fallbackUrl = new URL('/admin', request.url);
          const redirectResponse = NextResponse.redirect(fallbackUrl, 302);
          redirectResponse.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
          redirectResponse.headers.set(
            'Cache-Control',
            'private, no-cache, no-store, max-age=0, must-revalidate'
          );
          return redirectResponse;
        }
      }
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
