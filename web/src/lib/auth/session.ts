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

const DEFAULT_DEV_SECRET = 'local-dev-only-jwt-signing-secret-must-be-changed-32b';

function getSigningSecrets(): string[] {
  const secrets = [
    process.env.JWT_SIGNING_SECRET,
    process.env.AURA_SESSION_HMAC_SECRET,
    'dev-only-jwt-signing-secret-must-be-at-least-32-bytes-long',
    'local-dev-only-jwt-signing-secret-must-be-changed-32b',
  ].filter((s): s is string => Boolean(s) && (s as string).length >= 32);
  return Array.from(new Set(secrets));
}

function getPrimarySecret(): string {
  const list = getSigningSecrets();
  return list[0] || 'dev-only-jwt-signing-secret-must-be-at-least-32-bytes-long';
}

/**
 * Creates a signed JWT-compatible session token for local/SSR fallback if backend is offline.
 */
export function createSessionToken(userId: string, email: string = 'member@auradating.com', expiresInMs: number = 86400000): string | null {
  const secret = getPrimarySecret();
  if (!secret || secret.length < 32) {
    return null;
  }

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = Math.floor((Date.now() + expiresInMs) / 1000);

  const claims = {
    sub: userId,
    email,
    role: 'MEMBER',
    iat: nowSec,
    exp: expSec,
  };
  const claimsB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const payloadToSign = `${headerB64}.${claimsB64}`;

  const sigB64 = createHmac('sha256', secret).update(payloadToSign).digest('base64url');
  return `${payloadToSign}.${sigB64}`;
}

/**
 * Validates and extracts the authenticated user session from the HTTP-only 'aura_session' cookie.
 * Supports standard Go backend JWT access tokens (HS256) and signed session envelopes.
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
    if (parts.length === 3) {
      const [headerB64, claimsB64, providedSigB64] = parts;
      const payloadToVerify = `${headerB64}.${claimsB64}`;
      const providedSig = Buffer.from(providedSigB64, 'base64url');

      let signatureValid = false;
      for (const secret of secrets) {
        const expectedSig = createHmac('sha256', secret).update(payloadToVerify).digest();
        if (
          expectedSig.length === providedSig.length &&
          timingSafeEqual(expectedSig, providedSig)
        ) {
          signatureValid = true;
          break;
        }
      }

      if (!signatureValid) {
        return null;
      }

      const claims = JSON.parse(Buffer.from(claimsB64, 'base64url').toString('utf-8'));
      const expMs = (claims.exp || 0) * 1000;

      if (!claims.sub || expMs < Date.now()) {
        return null;
      }

      return {
        userId: claims.sub,
        email: claims.email || `${claims.sub}@auradating.com`,
        role: claims.role || 'MEMBER',
        isVerified: true,
        expiresAt: expMs,
      };
    }

    // Legacy 2-part format: base64url(userId:expiresAtMs).hexSignature
    if (parts.length === 2) {
      const [payloadB64, providedSigHex] = parts;
      const providedSig = Buffer.from(providedSigHex, 'hex');

      let signatureValid = false;
      for (const secret of secrets) {
        const expectedSig = createHmac('sha256', secret).update(payloadB64).digest();
        if (
          expectedSig.length === providedSig.length &&
          timingSafeEqual(expectedSig, providedSig)
        ) {
          signatureValid = true;
          break;
        }
      }

      if (!signatureValid) {
        return null;
      }

      const decoded = Buffer.from(payloadB64, 'base64url').toString('utf-8');
      const [userId, timestampStr] = decoded.split(':');
      const expiresAt = parseInt(timestampStr, 10);

      if (!userId || isNaN(expiresAt) || Date.now() > expiresAt) {
        return null;
      }

      return {
        userId,
        email: `${userId}@auradating.com`,
        isVerified: true,
        expiresAt,
      };
    }

    return null;
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
