# Privacy-Preserving SEO & Sensitive Data Protection

## 1. Threat Model & Privacy Principles

In an LGBTQ+ dating platform, user profiles, sexual orientation, gender identity, real-time geolocation, private messages, and health/lifestyle data constitute **Special Category Data** under GDPR Article 9, CCPA, and international human rights frameworks. Leaking any such data to public search indexers poses immediate risks of outing, harassment, discrimination, or physical danger in restrictive jurisdictions.

### Core Architecture Rules:
1. **Zero Indexing of Private Profiles**: No user profile, match queue, member search result, or private chat is ever accessible to search engines or anonymous users.
2. **Never Rely on robots.txt Alone**: Robots.txt is an advisory crawler protocol, not an access control barrier. Private endpoints are defended at the edge and application tiers with strict authentication and cache suppression.
3. **Defense-in-Depth Header Injection**: HTTP headers `X-Robots-Tag: noindex, nofollow, noarchive` and `Cache-Control: private, no-store` are injected by Next.js Edge Middleware for all private route segments.
4. **No Synthetic / Fake Data**: The platform strictly prohibits creating fake member profiles, fabricated testimonials, or fake local member counts for SEO bait.

---

## 2. Route Segmentation & Security Boundaries

```
[Incoming Request]
        |
        v
[Next.js Edge Middleware]
        |
        +---> Path starts with `/app`, `/api`, `/auth`, `/admin`, `/profile`?
        |            |
        |            YES:
        |            1. Verify Session / JWT Token
        |            2. Inject `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`
        |            3. Inject `Cache-Control: private, no-cache, no-store, must-revalidate`
        |            4. If unauthenticated -> Immediate HTTP 302 Redirect to `/auth/login`
        |               (ZERO HTML or profile payload returned)
        |
        +---> Path is Public (`/`, `/dating/*`, `/safety/*`, `/blog/*`)?
                     |
                     YES:
                     1. Allow Crawlers (Googlebot, Bingbot)
                     2. Pre-render SSG/ISR cached HTML
                     3. Inject Canonical URL and OpenGraph Tags
                     4. Ensure ZERO User PII exists in HTML markup
```

---

## 3. Edge Middleware Implementation Spec

```typescript
// src/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/request';

const PRIVATE_PREFIXES = [
  '/app',
  '/api/private',
  '/auth',
  '/messages',
  '/matches',
  '/profile',
  '/settings',
  '/admin',
  '/affiliate',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Check if route is private
  const isPrivate = PRIVATE_PREFIXES.some(prefix => pathname.startsWith(prefix));

  if (isPrivate) {
    const sessionToken = request.cookies.get('aura_session')?.value;

    // A. Unauthenticated request to private area
    if (!sessionToken && !pathname.startsWith('/auth')) {
      const loginUrl = new URL('/auth/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      const redirectResponse = NextResponse.redirect(loginUrl);
      
      // Inject strict crawler suppression headers even on redirect
      redirectResponse.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
      redirectResponse.headers.set('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate');
      return redirectResponse;
    }

    // B. Authenticated private response
    const response = NextResponse.next();
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
    response.headers.set('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    return response;
  }

  // 2. Trailing slash & casing normalizer for public SEO routes
  if (pathname.length > 1 && pathname.endsWith('/')) {
    const cleanUrl = new URL(pathname.slice(0, -1), request.url);
    cleanUrl.search = request.nextUrl.search;
    return NextResponse.redirect(cleanUrl, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

---

## 4. User-Generated Content (UGC) Publishing Guardrails

1. **Explicit Publishing Authorization**:
   Any member story, blog guest essay, or quote featured on the public website requires an active, signed UGC Consent Record in the database (`ugc_consent_records`).
2. **PII Sanitization**:
   Before publication, all UGC is scrubbed of real full names, email addresses, phone handles, exact employer names, and micro-locations.
3. **Revocation Mechanism**:
   Members can revoke public publishing consent at any time from their account settings. Upon revocation, the CMS triggers immediate on-demand ISR revalidation (`revalidatePath`), purging the quote from public HTML within seconds.
