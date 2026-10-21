import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export interface UserSession {
  userId: string;
  email: string;
  role?: string;
  isVerified: boolean;
  expiresAt: number;
}

/**
 * Signing secrets are supplied exclusively through the environment and must
 * match the Aura Go backend (JWT_SIGNING_SECRET). There is deliberately no
 * hardcoded fallback: if no secret is configured the website treats every
 * request as unauthenticated instead of trusting an unsigned token.
 */
function getSigningSecrets(): string[] {
  const secrets = [process.env.JWT_SIGNING_SECRET, process.env.AURA_SESSION_HMAC_SECRET].filter(
    (s): s is string => Boolean(s) && (s as string).length >= 32
  );
  return Array.from(new Set(secrets));
}

/**
 * Validates and extracts the authenticated user session from the HTTP-only 'aura_session' cookie.
 * The cookie holds the Go backend HS256 access token: the signature is verified
 * on every request, so a cookie alone is never sufficient to authenticate.
 */
export async function getAuthSession(): Promise<UserSession | null> {
  const secrets = getSigningSecrets();
  if (secrets.length === 0) {
    return null;
  }

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('aura_session')?.value;

  if (!sessionToken) {
    return null;
  }

  try {
    const parts = sessionToken.split('.');

    // Standard 3-part JWT Token: header.payload.signature
    if (parts.length !== 3) {
      return null;
    }

    const [headerB64, claimsB64, providedSigB64] = parts;
    const payloadToVerify = `${headerB64}.${claimsB64}`;
    const providedSig = Buffer.from(providedSigB64, 'base64url');

    let signatureValid = false;
    for (const secret of secrets) {
      const expectedSig = createHmac('sha256', secret).update(payloadToVerify).digest();
      if (expectedSig.length === providedSig.length && timingSafeEqual(expectedSig, providedSig)) {
        signatureValid = true;
        break;
      }
    }

    if (!signatureValid) {
      return null;
    }

    const claims = JSON.parse(Buffer.from(claimsB64, 'base64url').toString('utf-8'));
    const expMs = (claims.exp || 0) * 1000;

    if (!claims.sub || !expMs || expMs < Date.now()) {
      return null;
    }

    return {
      userId: claims.sub,
      email: claims.email || '',
      role: claims.role || 'MEMBER',
      isVerified: Boolean(claims.email_verified),
      expiresAt: expMs,
    };
  } catch {
    return null;
  }
}

/**
 * Enforces server-side authentication guard on private Next.js Server Components.
 * If user is unauthenticated, triggers immediate server-side HTTP 302 redirect.
 */
export async function requireAuthSession(returnPath: string): Promise<UserSession> {
  const session = await getAuthSession();

  if (!session) {
    redirect(`/auth/login?redirect=${encodeURIComponent(returnPath)}`);
  }

  return session;
}

export const ADMIN_ROLES = [
  'SUPER_ADMIN',
  'TRUST_AND_SAFETY',
  'FINANCE_ADMIN',
  'EDITORIAL_CMS',
  'CUSTOMER_SUPPORT',
  'AFFILIATE_MANAGER',
];

/**
 * Enforces server-side authentication & administrative role verification.
 * Non-admin roles (such as standard MEMBER) are immediately redirected or denied.
 */
export async function requireAdminSession(requiredRole?: string): Promise<UserSession> {
  const session = await getAuthSession();

  if (!session) {
    redirect(`/auth/login?redirect=${encodeURIComponent('/admin')}`);
  }

  const role = session.role || 'MEMBER';
  if (!ADMIN_ROLES.includes(role)) {
    redirect('/auth/unauthorized');
  }

  if (requiredRole && role !== 'SUPER_ADMIN' && role !== requiredRole) {
    redirect('/admin');
  }

  return session;
}
