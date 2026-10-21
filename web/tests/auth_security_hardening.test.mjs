import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import ts from 'typescript';

const WEB_ROOT = process.cwd();
const nodeRequire = createRequire(import.meta.url);

/**
 * Loads a real TypeScript source module from the application and evaluates it in
 * isolation with a controlled `require` shim. This exercises the genuine
 * production code (no re-implementation) while stubbing only framework edges
 * that are not available outside the Next.js server runtime.
 */
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

const SESSION_SOURCE = readFileSync(
  join(WEB_ROOT, 'src/lib/auth/session.ts'),
  'utf-8'
);

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

const STRONG_SECRET = 'aura-test-signing-secret--at-least-32-bytes-long';

/**
 * Builds an isolated copy of src/lib/auth/session.ts where the `cookies()`
 * accessor is driven by the supplied value.
 */
function loadSessionModule({ cookieValue, env }) {
  let stubbedCookies = {
    get: (name) => (name === 'aura_session' && cookieValue ? { value: cookieValue } : undefined),
  };

  const previousEnv = {};
  for (const key of ['JWT_SIGNING_SECRET', 'AURA_SESSION_HMAC_SECRET']) {
    previousEnv[key] = process.env[key];
    if (env && Object.prototype.hasOwnProperty.call(env, key)) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    } else {
      delete process.env[key];
    }
  }

  const exports = loadTsModule('src/lib/auth/session.ts', (id) => {
    if (id === 'crypto') return nodeRequire('node:crypto');
    if (id === 'next/headers') return { cookies: async () => stubbedCookies };
    if (id === 'next/navigation')
      return {
        redirect: (url) => {
          const err = new Error('NEXT_REDIRECT');
          err.digest = `NEXT_REDIRECT;${url}`;
          throw err;
        },
      };
    throw new Error(`Unexpected import in session.ts: ${id}`);
  });

  return {
    exports,
    restore() {
      for (const key of Object.keys(previousEnv)) {
        if (previousEnv[key] === undefined) delete process.env[key];
        else process.env[key] = previousEnv[key];
      }
    },
  };
}

test('Session validation rejects forged, tampered, expired and unsigned sessions', async (t) => {
  const nowSec = Math.floor(Date.now() / 1000);
  const validClaims = {
    sub: 'usr_real_member',
    email: 'member@example.com',
    role: 'MEMBER',
    email_verified: true,
    iat: nowSec,
    exp: nowSec + 3600,
  };

  await t.test('accepts a correctly signed, unexpired session', async () => {
    const token = makeToken(STRONG_SECRET, validClaims);
    const { exports, restore } = loadSessionModule({
      cookieValue: token,
      env: { JWT_SIGNING_SECRET: STRONG_SECRET },
    });
    try {
      const session = await exports.getAuthSession();
      assert.ok(session, 'a valid signed token must authenticate');
      assert.equal(session.userId, 'usr_real_member');
      assert.equal(session.email, 'member@example.com');
    } finally {
      restore();
    }
  });

  await t.test('rejects a token signed with the wrong secret (forgery)', async () => {
    const forged = makeToken('attacker-controlled-secret-value-32bytes!!', validClaims);
    const { exports, restore } = loadSessionModule({
      cookieValue: forged,
      env: { JWT_SIGNING_SECRET: STRONG_SECRET },
    });
    try {
      assert.equal(await exports.getAuthSession(), null);
    } finally {
      restore();
    }
  });

  await t.test('rejects a token whose payload was tampered with after signing', async () => {
    const original = makeToken(STRONG_SECRET, validClaims);
    const [header, , signature] = original.split('.');
    const escalatedClaims = { ...validClaims, sub: 'usr_admin', role: 'SUPER_ADMIN' };
    const tampered = `${header}.${b64url(JSON.stringify(escalatedClaims))}.${signature}`;
    const { exports, restore } = loadSessionModule({
      cookieValue: tampered,
      env: { JWT_SIGNING_SECRET: STRONG_SECRET },
    });
    try {
      assert.equal(await exports.getAuthSession(), null);
    } finally {
      restore();
    }
  });

  await t.test('rejects an expired session', async () => {
    const expired = makeToken(STRONG_SECRET, { ...validClaims, exp: nowSec - 60 });
    const { exports, restore } = loadSessionModule({
      cookieValue: expired,
      env: { JWT_SIGNING_SECRET: STRONG_SECRET },
    });
    try {
      assert.equal(await exports.getAuthSession(), null);
    } finally {
      restore();
    }
  });

  await t.test('rejects a session with no subject', async () => {
    const claims = { ...validClaims };
    delete claims.sub;
    const token = makeToken(STRONG_SECRET, claims);
    const { exports, restore } = loadSessionModule({
      cookieValue: token,
      env: { JWT_SIGNING_SECRET: STRONG_SECRET },
    });
    try {
      assert.equal(await exports.getAuthSession(), null);
    } finally {
      restore();
    }
  });

  await t.test('rejects a session with no expiry claim', async () => {
    const claims = { ...validClaims };
    delete claims.exp;
    const token = makeToken(STRONG_SECRET, claims);
    const { exports, restore } = loadSessionModule({
      cookieValue: token,
      env: { JWT_SIGNING_SECRET: STRONG_SECRET },
    });
    try {
      assert.equal(await exports.getAuthSession(), null);
    } finally {
      restore();
    }
  });

  await t.test('rejects malformed and legacy 2-part tokens', async () => {
    for (const value of ['not-a-token', 'header.payload', 'a.b.c.d', '']) {
      const { exports, restore } = loadSessionModule({
        cookieValue: value,
        env: { JWT_SIGNING_SECRET: STRONG_SECRET },
      });
      try {
        assert.equal(await exports.getAuthSession(), null, `must reject "${value}"`);
      } finally {
        restore();
      }
    }
  });

  await t.test('fails securely when no signing secret is configured', async () => {
    const token = makeToken(STRONG_SECRET, validClaims);
    const { exports, restore } = loadSessionModule({
      cookieValue: token,
      env: { JWT_SIGNING_SECRET: undefined, AURA_SESSION_HMAC_SECRET: undefined },
    });
    try {
      assert.equal(
        await exports.getAuthSession(),
        null,
        'an unconfigured deployment must not trust any cookie'
      );
    } finally {
      restore();
    }
  });

  await t.test('fails securely when the configured secret is too short', async () => {
    const shortSecret = 'too-short';
    const token = makeToken(shortSecret, validClaims);
    const { exports, restore } = loadSessionModule({
      cookieValue: token,
      env: { JWT_SIGNING_SECRET: shortSecret },
    });
    try {
      assert.equal(await exports.getAuthSession(), null);
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Middleware private-route guard
// ---------------------------------------------------------------------------

function createNextResponseStub() {
  class StubResponse {
    constructor(body, init = {}) {
      this.body = body;
      this.status = init.status ?? 200;
      this.url = undefined;
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

test('Private route middleware requires a validly signed session cookie', async (t) => {
  const nowSec = Math.floor(Date.now() / 1000);
  const claims = { sub: 'usr_real_member', email: 'member@example.com', exp: nowSec + 3600 };
  const previousSecret = process.env.JWT_SIGNING_SECRET;

  process.env.JWT_SIGNING_SECRET = STRONG_SECRET;
  try {
    const { middleware } = loadMiddleware();

    await t.test('redirects an anonymous request to the login page', async () => {
      const res = await middleware(makeRequest({ pathname: '/app/discovery' }));
      assert.equal(res.status, 302);
      assert.match(res.url, /\/auth\/login/);
      assert.match(res.url, /redirect=%2Fapp%2Fdiscovery/);
    });

    await t.test('rejects a forged cookie instead of trusting its presence', async () => {
      const forged = makeToken('attacker-controlled-secret-value-32bytes!!', claims);
      const res = await middleware(
        makeRequest({ pathname: '/app/discovery', cookies: { aura_session: forged } })
      );
      assert.equal(res.status, 302, 'a forged cookie must not grant access');
      assert.match(res.url, /\/auth\/login/);
    });

    await t.test('rejects a correctly signed but expired cookie', async () => {
      const expired = makeToken(STRONG_SECRET, { ...claims, exp: nowSec - 60 });
      const res = await middleware(
        makeRequest({ pathname: '/settings', cookies: { aura_session: expired } })
      );
      assert.equal(res.status, 302);
      assert.match(res.url, /\/auth\/login/);
    });

    await t.test('rejects a cookie with a valid signature but no subject', async () => {
      const noSub = makeToken(STRONG_SECRET, { email: 'member@example.com', exp: nowSec + 3600 });
      const res = await middleware(
        makeRequest({ pathname: '/settings', cookies: { aura_session: noSub } })
      );
      assert.equal(res.status, 302);
    });

    await t.test('allows a validly signed, unexpired cookie through', async () => {
      const valid = makeToken(STRONG_SECRET, claims);
      const res = await middleware(
        makeRequest({ pathname: '/app/discovery', cookies: { aura_session: valid } })
      );
      assert.equal(res.status, 200);
      assert.equal(res.url, undefined, 'a valid session must not be redirected');
    });

    await t.test('still serves the login route to anonymous visitors', async () => {
      const res = await middleware(makeRequest({ pathname: '/auth/login' }));
      assert.equal(res.status, 200);
    });
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SIGNING_SECRET;
    else process.env.JWT_SIGNING_SECRET = previousSecret;
  }
});

test('Private route middleware fails closed when no signing secret is configured', async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const previousSecret = process.env.JWT_SIGNING_SECRET;
  const previousAlt = process.env.AURA_SESSION_HMAC_SECRET;
  delete process.env.JWT_SIGNING_SECRET;
  delete process.env.AURA_SESSION_HMAC_SECRET;

  try {
    const { middleware } = loadMiddleware();
    const token = makeToken(STRONG_SECRET, { sub: 'usr_x', exp: nowSec + 3600 });
    const res = await middleware(
      makeRequest({ pathname: '/app/discovery', cookies: { aura_session: token } })
    );
    assert.equal(res.status, 302, 'without a configured secret every private route must redirect');
  } finally {
    if (previousSecret !== undefined) process.env.JWT_SIGNING_SECRET = previousSecret;
    if (previousAlt !== undefined) process.env.AURA_SESSION_HMAC_SECRET = previousAlt;
  }
});

// ---------------------------------------------------------------------------
// BFF authentication routes: backend outage handling
// ---------------------------------------------------------------------------

function loadPasswordPolicy() {
  return loadTsModule('src/lib/validation/password.ts', (id) => {
    throw new Error(`Unexpected import in password.ts: ${id}`);
  });
}

function loadAuthRoute(relPath) {
  const passwordModule = loadPasswordPolicy();
  return loadTsModule(relPath, (id) => {
    if (id === 'next/server') return { NextRequest: class {}, NextResponse: createNextResponseStub() };
    if (id === '@/lib/validation/password') return passwordModule;
    throw new Error(`Unexpected import in ${relPath}: ${id}`);
  });
}

async function withFailingBackend(fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('Auth BFF routes never fabricate a session when the backend is unavailable', async (t) => {
  await t.test('POST /api/auth/login returns 503 and sets no cookies', async () => {
    const { POST } = loadAuthRoute('src/app/api/auth/login/route.ts');
    const res = await withFailingBackend(() =>
      POST({ json: async () => ({ email: 'member@example.com', password: 'Passw0r!Valid' }) })
    );

    assert.equal(res.status, 503, 'a backend outage must surface as 503');
    assert.equal(res._setCookies.length, 0, 'no authentication cookie may be issued');
    const body = await res.json();
    assert.notEqual(body.success, true, 'must never report fabricated success');
    assert.equal(body.user, undefined, 'must never fabricate a user');
    assert.match(body.error, /unreachable/i);
  });

  await t.test('POST /api/auth/register returns 503 and sets no cookies', async () => {
    const { POST } = loadAuthRoute('src/app/api/auth/register/route.ts');
    const res = await withFailingBackend(() =>
      POST({
        json: async () => ({
          email: 'new_member@example.com',
          password: 'Passw0r!Valid',
          display_name: 'New Member',
          birthdate: '1995-04-12',
          gender_identities: ['non-binary'],
          sexual_orientations: ['queer'],
        }),
      })
    );

    assert.equal(res.status, 503);
    assert.equal(res._setCookies.length, 0, 'no authentication cookie may be issued');
    const body = await res.json();
    assert.notEqual(body.success, true);
    assert.equal(body.user, undefined);
  });

  await t.test('registration still requires real identity fields (no invented defaults)', async () => {
    const { POST } = loadAuthRoute('src/app/api/auth/register/route.ts');

    const missingGenders = await POST({
      json: async () => ({
        email: 'a@example.com',
        password: 'Passw0r!Valid',
        display_name: 'A',
        birthdate: '1995-04-12',
        sexual_orientations: ['queer'],
      }),
    });
    assert.equal(missingGenders.status, 400);

    const missingOrientations = await POST({
      json: async () => ({
        email: 'b@example.com',
        password: 'Passw0r!Valid',
        display_name: 'B',
        birthdate: '1995-04-12',
        gender_identities: ['non-binary'],
      }),
    });
    assert.equal(missingOrientations.status, 400);
  });

  await t.test('production misconfiguration fails closed before contacting any backend', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousApiUrl = process.env.AURA_API_URL;
    const previousPublicUrl = process.env.NEXT_PUBLIC_API_URL;
    process.env.NODE_ENV = 'production';
    delete process.env.AURA_API_URL;
    delete process.env.NEXT_PUBLIC_API_URL;

    try {
      const { POST } = loadAuthRoute('src/app/api/auth/login/route.ts');
      const res = await POST({ json: async () => ({ email: 'a@example.com', password: 'Passw0r!Valid' }) });
      assert.equal(res.status, 503);
      assert.equal(res._setCookies.length, 0);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousApiUrl !== undefined) process.env.AURA_API_URL = previousApiUrl;
      if (previousPublicUrl !== undefined) process.env.NEXT_PUBLIC_API_URL = previousPublicUrl;
    }
  });
});

// ---------------------------------------------------------------------------
// Structural guarantees: no fake authentication paths remain
// ---------------------------------------------------------------------------

test('Website source contains no fake-authentication fallbacks', async (t) => {
  const read = (rel) => readFileSync(join(WEB_ROOT, rel), 'utf-8');

  await t.test('session.ts exposes no hardcoded dev secret or token minting helper', () => {
    assert.doesNotMatch(SESSION_SOURCE, /DEFAULT_DEV_SECRET/);
    assert.doesNotMatch(SESSION_SOURCE, /dev-only-jwt-signing-secret/);
    assert.doesNotMatch(SESSION_SOURCE, /export\s+function\s+createSessionToken/);
    assert.doesNotMatch(SESSION_SOURCE, /@auradating\.com/);
    assert.match(SESSION_SOURCE, /timingSafeEqual/, 'signatures must be compared in constant time');
  });

  await t.test('login and register routes contain no developer-session fallback', () => {
    for (const rel of ['src/app/api/auth/login/route.ts', 'src/app/api/auth/register/route.ts']) {
      const code = read(rel);
      assert.doesNotMatch(code, /createSessionToken/);
      assert.doesNotMatch(code, /developer session/i);
      assert.doesNotMatch(code, /devUserId/);
      assert.match(code, /503/, 'backend outage must map to 503');
    }
  });

  await t.test('forgot-password route does not simulate success when the backend is down', () => {
    const code = read('src/app/api/auth/forgot-password/route.ts');
    assert.doesNotMatch(code, /simulate/i);
    assert.match(code, /503/);
  });

  await t.test('middleware verifies the session signature, not cookie presence', () => {
    const code = read('src/middleware.ts');
    assert.match(code, /isSessionTokenValid/);
    assert.match(code, /crypto\.subtle\.sign/);
  });

  await t.test('no mock-google identity paths exist anywhere in the website source', () => {
    assert.doesNotMatch(SESSION_SOURCE, /mock-google/);
    for (const rel of [
      'src/app/api/auth/login/route.ts',
      'src/app/api/auth/register/route.ts',
      'src/middleware.ts',
    ]) {
      assert.doesNotMatch(read(rel), /mock-google|fake-google|synthetic token/i);
    }
  });
});
