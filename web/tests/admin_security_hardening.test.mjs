import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import ts from 'typescript';

const WEB_ROOT = process.cwd();

function loadTsModule(relPath, requireShim) {
  const source = readFileSync(join(WEB_ROOT, relPath), 'utf-8');
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const module = { exports: {} };
  const fn = new Function(
    'require',
    'module',
    'exports',
    'process',
    'crypto',
    js
  );
  fn(requireShim, module, module.exports, process, globalThis.crypto);
  return module.exports;
}

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function makeToken(secret, claims, header = { alg: 'HS256', typ: 'JWT' }) {
  const encodedHeader = b64url(JSON.stringify(header));
  const encodedClaims = b64url(JSON.stringify(claims));
  const signature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedClaims}`)
    .digest('base64url');
  return `${encodedHeader}.${encodedClaims}.${signature}`;
}

const STRONG_SECRET = 'aura-security-hardening-test-secret-at-least-32b';

function createNextResponseStub() {
  class StubResponse {
    constructor(body = null, init = {}) {
      this.body = body;
      this.status = init.status || 200;
      this._setCookies = [];
      const headerStore = new Map();
      this.headers = {
        set: (name, value) => headerStore.set(name, value),
        get: (name) => headerStore.get(name),
      };
      this.cookies = {
        set: (name, value, opts) => this._setCookies.push({ name, value, opts }),
      };
    }
    async json() {
      return this.body;
    }
    static json(body, init) {
      return new StubResponse(body, init);
    }
    static next() {
      return new StubResponse(null, { status: 200 });
    }
    static redirect(url, status) {
      const res = new StubResponse(null, { status });
      res.url = typeof url === 'string' ? url : url.toString();
      return res;
    }
  }
  return StubResponse;
}

function loadMiddleware() {
  return loadTsModule('src/middleware.ts', (id) => {
    if (id === 'next/server') return { NextResponse: createNextResponseStub() };
    if (id === '@/lib/seo/config')
      return { SITE_CONFIG: { enableRegionalRestrictions: false }, MARKET_CLEARANCE_REGISTRY: {} };
    throw new Error(`Unexpected import in middleware.ts: ${id}`);
  });
}

function makeRequest({ pathname, cookies = {} }) {
  return {
    url: `https://aura.example${pathname}`,
    nextUrl: { pathname, search: '' },
    cookies: { get: (name) => (name in cookies ? { value: cookies[name] } : undefined) },
  };
}

// ---------------------------------------------------------------------------
// 1. Open Redirect Sanitization Tests
// ---------------------------------------------------------------------------

test('Open Redirect Protection: sanitizeRedirectPath enforces strict internal paths', async (t) => {
  const { sanitizeRedirectPath } = loadTsModule('src/lib/validation/redirect.ts', () => ({}));

  await t.test('accepts safe relative application routes', () => {
    assert.equal(sanitizeRedirectPath('/app/discovery'), '/app/discovery');
    assert.equal(sanitizeRedirectPath('/membership?plan=AURA_PLUS'), '/membership?plan=AURA_PLUS');
    assert.equal(sanitizeRedirectPath('/admin/super'), '/admin/super');
    assert.equal(sanitizeRedirectPath('/profile/edit'), '/profile/edit');
  });

  await t.test('rejects protocol-relative URLs (//example.com)', () => {
    assert.equal(sanitizeRedirectPath('//attacker.example.com'), '/app/discovery');
    assert.equal(sanitizeRedirectPath('//attacker.example.com/evil'), '/app/discovery');
  });

  await t.test('rejects absolute URLs with protocol scheme', () => {
    assert.equal(sanitizeRedirectPath('https://attacker.example.com'), '/app/discovery');
    assert.equal(sanitizeRedirectPath('http://evil.com/phish'), '/app/discovery');
    assert.equal(sanitizeRedirectPath('javascript:alert(1)'), '/app/discovery');
    assert.equal(sanitizeRedirectPath('data:text/html,<script>evil()</script>'), '/app/discovery');
  });

  await t.test('rejects backslash and Windows network path tricks', () => {
    assert.equal(sanitizeRedirectPath('/\\attacker.com'), '/app/discovery');
    assert.equal(sanitizeRedirectPath('\\\\attacker.com\\share'), '/app/discovery');
    assert.equal(sanitizeRedirectPath('/app\\discovery'), '/app/discovery');
  });

  await t.test('rejects CRLF and ASCII control characters', () => {
    assert.equal(sanitizeRedirectPath('/app/discovery\r\nSet-Cookie:evil=1'), '/app/discovery');
    assert.equal(sanitizeRedirectPath('/app\x00/discovery'), '/app/discovery');
  });

  await t.test('returns custom fallback when specified', () => {
    assert.equal(sanitizeRedirectPath('https://evil.com', '/admin'), '/admin');
    assert.equal(sanitizeRedirectPath(null, '/login'), '/login');
  });
});

// ---------------------------------------------------------------------------
// 2. Next.js Middleware Admin Route Guard & RBAC Tests
// ---------------------------------------------------------------------------

test('Next.js Middleware: Admin Route Guard strictly enforces administrative roles', async (t) => {
  const nowSec = Math.floor(Date.now() / 1000);
  const previousSecret = process.env.JWT_SIGNING_SECRET;
  process.env.JWT_SIGNING_SECRET = STRONG_SECRET;

  try {
    const { middleware } = loadMiddleware();

    await t.test('redirects unauthenticated visitor to /auth/login with preserved redirect', async () => {
      const res = await middleware(makeRequest({ pathname: '/admin' }));
      assert.equal(res.status, 302);
      assert.match(res.url, /\/auth\/login\?redirect=%2Fadmin/);
    });

    await t.test('redirects authenticated standard MEMBER to /auth/unauthorized', async () => {
      const memberToken = makeToken(STRONG_SECRET, {
        sub: 'usr_normal_member',
        role: 'MEMBER',
        exp: nowSec + 3600,
      });

      const res = await middleware(
        makeRequest({ pathname: '/admin', cookies: { aura_session: memberToken } })
      );
      assert.equal(res.status, 302);
      assert.match(res.url, /\/auth\/unauthorized/);
    });

    await t.test('redirects non-SuperAdmin attempting /admin/super to /admin', async () => {
      const supportToken = makeToken(STRONG_SECRET, {
        sub: 'usr_support_agent',
        role: 'CUSTOMER_SUPPORT',
        exp: nowSec + 3600,
      });

      const res = await middleware(
        makeRequest({ pathname: '/admin/super', cookies: { aura_session: supportToken } })
      );
      assert.equal(res.status, 302);
      assert.equal(new URL(res.url).pathname, '/admin');
    });

    await t.test('redirects non-FinanceAdmin attempting /admin/finance to /admin', async () => {
      const cmsToken = makeToken(STRONG_SECRET, {
        sub: 'usr_cms_editor',
        role: 'EDITORIAL_CMS',
        exp: nowSec + 3600,
      });

      const res = await middleware(
        makeRequest({ pathname: '/admin/finance', cookies: { aura_session: cmsToken } })
      );
      assert.equal(res.status, 302);
      assert.equal(new URL(res.url).pathname, '/admin');
    });

    await t.test('allows SUPER_ADMIN to access /admin/super', async () => {
      const superToken = makeToken(STRONG_SECRET, {
        sub: 'usr_super_admin',
        role: 'SUPER_ADMIN',
        exp: nowSec + 3600,
      });

      const res = await middleware(
        makeRequest({ pathname: '/admin/super', cookies: { aura_session: superToken } })
      );
      assert.equal(res.status, 200);
      assert.match(res.headers.get('Cache-Control'), /no-store|no-cache/);
    });

    await t.test('allows FINANCE_ADMIN to access /admin/finance', async () => {
      const financeToken = makeToken(STRONG_SECRET, {
        sub: 'usr_finance_admin',
        role: 'FINANCE_ADMIN',
        exp: nowSec + 3600,
      });

      const res = await middleware(
        makeRequest({ pathname: '/admin/finance', cookies: { aura_session: financeToken } })
      );
      assert.equal(res.status, 200);
    });
  } finally {
    process.env.JWT_SIGNING_SECRET = previousSecret;
  }
});

// ---------------------------------------------------------------------------
// 3. Admin Sub-Layout Role Guard Invariants
// ---------------------------------------------------------------------------

test('Admin Sub-Layouts verify required roles on the server side', async (t) => {
  const layouts = [
    { file: 'src/app/admin/super/layout.tsx', role: 'SUPER_ADMIN' },
    { file: 'src/app/admin/finance/layout.tsx', role: 'FINANCE_ADMIN' },
    { file: 'src/app/admin/moderation/layout.tsx', role: 'TRUST_AND_SAFETY' },
    { file: 'src/app/admin/affiliate/layout.tsx', role: 'AFFILIATE_MANAGER' },
    { file: 'src/app/admin/cms/layout.tsx', role: 'EDITORIAL_CMS' },
    { file: 'src/app/admin/support/layout.tsx', role: 'CUSTOMER_SUPPORT' },
  ];

  for (const { file, role } of layouts) {
    await t.test(`${file} invokes requireAdminSession('${role}')`, () => {
      const code = readFileSync(join(WEB_ROOT, file), 'utf-8');
      assert.match(code, new RegExp(`requireAdminSession\\(['"]${role}['"]\\)`));
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Admin API Route Proxy RBAC Invariants
// ---------------------------------------------------------------------------

test('Admin API Proxy Route enforces server-side session and role gating', async (t) => {
  const code = readFileSync(join(WEB_ROOT, 'src/app/api/admin/[...slug]/route.ts'), 'utf-8');

  await t.test('checks getAuthSession() and rejects unauthenticated callers with 401', () => {
    assert.match(code, /getAuthSession\(\)/);
    assert.match(code, /status:\s*401/);
  });

  await t.test('checks ADMIN_ROLES and rejects non-admin users with 403', () => {
    assert.match(code, /ADMIN_ROLES/);
    assert.match(code, /status:\s*403/);
  });

  await t.test('enforces granular role checks for sensitive operations (roles, billing, moderation, cms)', () => {
    assert.match(code, /subpath\.startsWith\('users\/'\)/);
    assert.match(code, /userRole !== 'SUPER_ADMIN'/);
    assert.match(code, /subpath\.startsWith\('billing'\)/);
    assert.match(code, /userRole !== 'FINANCE_ADMIN'/);
  });
});
