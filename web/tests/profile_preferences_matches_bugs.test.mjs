import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const BACKEND_URL = process.env.AURA_API_URL || 'http://127.0.0.1:8080';

test('Aura Bugfix 01 Code Structure Contracts', async (t) => {
  await t.test('ProfileEditor.tsx constructs sanitized update payloads', () => {
    const filePath = resolve(process.cwd(), 'src/components/profile/ProfileEditor.tsx');
    assert.equal(existsSync(filePath), true, 'ProfileEditor.tsx must exist');
    const content = readFileSync(filePath, 'utf-8');

    // Gender identity default must be canonical taxonomy ('non-binary')
    assert.match(content, /gender_identities:\s*\['non-binary'\]/, 'initial gender_identities must use canonical taxonomy');

    // loadData must unpack p.profile and dealbreakers
    assert.match(content, /const\s+p\s*=\s*raw\.profile\s*\|\|\s*raw/, 'loadData must unpack raw.profile');
    assert.match(content, /dealbreakers\?\.non_smoker_only/, 'loadData must unpack dealbreakers.non_smoker_only');

    // handleSaveProfile must build updatePayload rather than sending raw profile state
    assert.match(content, /const\s+updatePayload:\s*Record<string,\s*any>/, 'handleSaveProfile must construct sanitized payload');
    assert.match(content, /body:\s*JSON\.stringify\(updatePayload\)/, 'handleSaveProfile must send sanitized updatePayload');

    // handleSavePreferences must nest dealbreakers
    assert.match(content, /dealbreakers:\s*\{[\s\S]*?non_smoker_only/, 'handleSavePreferences must structure dealbreakers object');
  });

  await t.test('MatchesList.tsx handles age assurance gating and provides verification action', () => {
    const filePath = resolve(process.cwd(), 'src/components/discovery/MatchesList.tsx');
    assert.equal(existsSync(filePath), true, 'MatchesList.tsx must exist');
    const content = readFileSync(filePath, 'utf-8');

    assert.match(content, /requiresAgeVerification/, 'MatchesList must track requiresAgeVerification');
    assert.match(content, /handleVerifyAge/, 'MatchesList must provide handleVerifyAge handler');
    assert.match(content, /\/api\/v1\/age-assurance\/session/, 'handleVerifyAge must call age assurance session endpoint');
    assert.match(content, /AGE_VERIFICATION_REQUIRED/, 'loadMatches must check for AGE_VERIFICATION_REQUIRED error');
  });

  await t.test('Next.js API proxy routes sanitize payloads and complete dev verification', () => {
    const profRoute = readFileSync(resolve(process.cwd(), 'src/app/api/v1/profiles/me/route.ts'), 'utf-8');
    assert.match(profRoute, /sanitized\[key\]\s*=\s*raw\[key\]/, 'profile PUT route must sanitize incoming payload');

    const prefRoute = readFileSync(resolve(process.cwd(), 'src/app/api/v1/profiles/me/preferences/route.ts'), 'utf-8');
    assert.match(prefRoute, /sanitized\.dealbreakers\s*=\s*dealbreakers/, 'preferences PUT route must structure dealbreakers');

    const ageRoute = readFileSync(resolve(process.cwd(), 'src/app/api/v1/age-assurance/session/route.ts'), 'utf-8');
    assert.match(ageRoute, /dev-mock-valid-sig/, 'age session route must complete dev webhook loop in development');
  });
});

test('Aura Bugfix 01 End-to-End Persistence & Gating Suite', async (t) => {
  // Test if local servers are reachable
  let serverReachable = false;
  try {
    const check = await fetch(`${BASE_URL}/api/v1/billing/plans`, { signal: AbortSignal.timeout(3000) });
    serverReachable = check.status < 500;
  } catch {
    serverReachable = false;
  }

  if (!serverReachable) {
    t.skip('Skipping live HTTP loopback tests because localhost:3000 is not reachable');
    return;
  }

  // 1. Register a test user
  const email = `test_bugfix01_${Date.now()}@example.com`;
  const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Passw0rd!Valid2026',
      display_name: 'Regression Tester',
      birthdate: '1995-08-20',
      gender_identities: ['non-binary'],
      sexual_orientations: ['queer'],
    }),
  });
  assert.equal(regRes.status, 200, 'registration must succeed with 200');
  const regCookies = regRes.headers.get('set-cookie') || '';
  const token = regCookies.match(/aura_session=([^;]+)/)?.[1];
  assert.ok(token, 'must receive aura_session cookie');

  await t.test('1. Profile update succeeds with 200 and persists changes', async () => {
    const updatePayload = {
      display_name: 'Regression Tester Updated',
      bio: 'Authentic queer creator exploring genuine connections.',
      pronouns: ['they/them'],
      gender_identities: ['non-binary'],
      sexual_orientations: ['queer'],
      relationship_intents: ['serious dating'],
      relationship_structure: 'MONOGAMOUS',
      discrete_mode_enabled: true,
      incognito_enabled: false,
      smoking_habit: 'NON_SMOKER',
      drinking_habit: 'SOCIALLY',
    };

    const res = await fetch(`${BASE_URL}/api/v1/profiles/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `aura_session=${token}`,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(updatePayload),
    });

    assert.equal(res.status, 200, 'PUT /api/v1/profiles/me must return 200 OK');
    const resData = await res.json();
    assert.equal(resData.display_name, 'Regression Tester Updated');
    assert.equal(resData.discrete_mode_enabled, true);

    // Refresh and confirm persistence via GET
    const getRes = await fetch(`${BASE_URL}/api/v1/profiles/me`, {
      headers: { Cookie: `aura_session=${token}`, Authorization: `Bearer ${token}` },
    });
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.equal(getData.profile.display_name, 'Regression Tester Updated');
    assert.equal(getData.profile.bio, 'Authentic queer creator exploring genuine connections.');
    assert.equal(getData.profile.discrete_mode_enabled, true);
  });

  await t.test('2. Dating preferences & dealbreakers update succeeds with 200 and persists', async () => {
    const prefPayload = {
      min_age: 23,
      max_age: 49,
      max_distance_km: 60,
      preferred_genders: ['non-binary', 'queer'],
      preferred_intents: ['serious dating'],
      verified_profiles_only: true,
      non_smoker_only: true,
      require_monogamous: true,
    };

    const res = await fetch(`${BASE_URL}/api/v1/profiles/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `aura_session=${token}`,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(prefPayload),
    });

    assert.equal(res.status, 200, 'PUT /api/v1/profiles/me/preferences must return 200 OK');
    const resData = await res.json();
    assert.equal(resData.min_age, 23);
    assert.equal(resData.dealbreakers?.non_smoker_only, true);
    assert.equal(resData.dealbreakers?.require_monogamous, true);

    // Refresh and confirm persistence via GET
    const getRes = await fetch(`${BASE_URL}/api/v1/profiles/me/preferences`, {
      headers: { Cookie: `aura_session=${token}`, Authorization: `Bearer ${token}` },
    });
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.equal(getData.min_age, 23);
    assert.equal(getData.max_age, 49);
    assert.equal(getData.dealbreakers?.non_smoker_only, true);
    assert.equal(getData.dealbreakers?.require_monogamous, true);
  });

  await t.test('3. Matches API gates on age assurance (403) and succeeds (200) once verified', async () => {
    // Before age verification, GET /api/v1/matches must return 403 Forbidden with AGE_VERIFICATION_REQUIRED
    const m1Res = await fetch(`${BASE_URL}/api/v1/matches`, {
      headers: {
        Cookie: `aura_session=${token}`,
        Authorization: `Bearer ${token}`,
      },
    });
    assert.equal(m1Res.status, 403, 'matches must return 403 before age assurance');
    const errBody = await m1Res.json();
    assert.equal(errBody.error?.code, 'AGE_VERIFICATION_REQUIRED', 'error code must be AGE_VERIFICATION_REQUIRED');

    // Initiate age assurance via POST /api/v1/age-assurance/session
    const ageRes = await fetch(`${BASE_URL}/api/v1/age-assurance/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `aura_session=${token}`,
        Authorization: `Bearer ${token}`,
      },
    });
    assert.equal(ageRes.status, 200, 'age session creation must return 200');
    const ageData = await ageRes.json();
    assert.equal(ageData.status, 'VERIFIED', 'dev age session must resolve status to VERIFIED');

    // After age assurance, GET /api/v1/matches must return 200 OK
    const m2Res = await fetch(`${BASE_URL}/api/v1/matches`, {
      headers: {
        Cookie: `aura_session=${token}`,
        Authorization: `Bearer ${token}`,
      },
    });
    assert.equal(m2Res.status, 200, 'matches must return 200 OK after age assurance verification');
    const m2Data = await m2Res.json();
    assert.ok(Array.isArray(m2Data.matches), 'response must include matches array');
    assert.equal(typeof m2Data.count, 'number', 'response must include count number');
  });
});
