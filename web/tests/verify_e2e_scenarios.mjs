import assert from 'node:assert/strict';

const BASE_URL = 'http://localhost:3000';

async function main() {
  console.log('--- STARTING REAL HTTP VERIFICATION SCENARIOS ---\n');

  // Scenario 1: Signup with valid password
  console.log('1. Testing registration with valid password (Passw0r!Valid)...');
  const email1 = `test_valid_${Date.now()}@example.com`;
  const res1 = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email1,
      password: 'Passw0r!Valid',
      display_name: 'Test Member',
      birthdate: '1995-04-12',
    }),
  });

  assert.equal(res1.status, 200, `Expected 200 OK, got ${res1.status}`);
  const data1 = await res1.json();
  assert.equal(data1.success, true);
  assert.equal(data1.redirect, '/onboarding');

  const setCookie1 = res1.headers.get('set-cookie') || '';
  assert.match(setCookie1, /aura_session=/);
  assert.match(setCookie1, /aura_auth_state=1/);
  console.log('   ✓ Registration succeeded, set aura_session and aura_auth_state cookies');

  // Extract cookies for authenticated tests
  const sessionMatch = setCookie1.match(/aura_session=([^;]+)/);
  const authStateMatch = setCookie1.match(/aura_auth_state=([^;]+)/);
  const authCookies = `aura_session=${sessionMatch ? sessionMatch[1] : ''}; aura_auth_state=${authStateMatch ? authStateMatch[1] : ''}`;

  // Scenario 2: Weak password - too short (< 8 chars)
  console.log('2. Testing weak password (< 8 characters: Short1!)...');
  const res2 = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `test_short_${Date.now()}@example.com`,
      password: 'Short1!',
      display_name: 'Short PW',
      birthdate: '1995-04-12',
    }),
  });
  assert.equal(res2.status, 400);
  const data2 = await res2.json();
  assert.match(data2.error, /at least 8 characters/);
  console.log(`   ✓ Rejected as expected: "${data2.error}"`);

  // Scenario 3: Missing digit
  console.log('3. Testing password missing digit (Password!@#)...');
  const res3 = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `test_nodigit_${Date.now()}@example.com`,
      password: 'Password!@#',
      display_name: 'No Digit',
      birthdate: '1995-04-12',
    }),
  });
  assert.equal(res3.status, 400);
  const data3 = await res3.json();
  assert.match(data3.error, /numeric digit/);
  console.log(`   ✓ Rejected as expected: "${data3.error}"`);

  // Scenario 4: Missing special character
  console.log('4. Testing password missing special character (Password1234)...');
  const res4 = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `test_nospecial_${Date.now()}@example.com`,
      password: 'Password1234',
      display_name: 'No Special',
      birthdate: '1995-04-12',
    }),
  });
  assert.equal(res4.status, 400);
  const data4 = await res4.json();
  assert.match(data4.error, /special character/);
  console.log(`   ✓ Rejected as expected: "${data4.error}"`);

  // Scenario 5: Valid exactly 8 characters (Passw0r!)
  console.log('5. Testing valid exactly 8-character password (Passw0r!)...');
  const res5 = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `test_exact8_${Date.now()}@example.com`,
      password: 'Passw0r!',
      display_name: 'Exact 8',
      birthdate: '1995-04-12',
    }),
  });
  assert.equal(res5.status, 200);
  console.log('   ✓ Exactly 8 characters accepted successfully');

  // Scenario 6: Valid 64+ characters (no truncation)
  console.log('6. Testing valid 64-character password...');
  const pw64 = 'K9#' + 'x'.repeat(61);
  const res6 = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `test_pw64_${Date.now()}@example.com`,
      password: pw64,
      display_name: 'Long PW Member',
      birthdate: '1995-04-12',
    }),
  });
  assert.equal(res6.status, 200);
  console.log('   ✓ 64-character password accepted successfully');

  // Scenario 7: Verify /api/auth/session with session cookie
  console.log('7. Testing /api/auth/session endpoint...');
  const sessionRes = await fetch(`${BASE_URL}/api/auth/session`, {
    headers: { Cookie: authCookies },
  });
  assert.equal(sessionRes.status, 200);
  const sessionData = await sessionRes.json();
  assert.equal(sessionData.authenticated, true);
  assert.ok(sessionData.user.userId);
  console.log(`   ✓ Authenticated session confirmed: userId=${sessionData.user.userId}`);

  // Scenario 8: Pricing page for authenticated user
  console.log('8. Testing /pricing HTML for authenticated user...');
  const pricingAuthRes = await fetch(`${BASE_URL}/pricing`, {
    headers: { Cookie: authCookies },
  });
  assert.equal(pricingAuthRes.status, 200);
  const pricingHtml = await pricingAuthRes.text();
  assert.match(pricingHtml, /\/membership\?plan=AURA_PLUS/);
  assert.match(pricingHtml, /\/membership\?plan=AURA_ELITE/);
  assert.doesNotMatch(pricingHtml, /href="\/auth\/register\?tier=plus"/);
  console.log('   ✓ Pricing page links directly to /membership?plan=... for authenticated users');

  // Scenario 9: Authenticated user hitting /auth/register is redirected
  console.log('9. Testing /auth/register redirect for authenticated user...');
  const registerAuthRes = await fetch(`${BASE_URL}/auth/register?tier=plus`, {
    headers: { Cookie: authCookies },
    redirect: 'manual',
  });
  assert.equal(registerAuthRes.status, 307, `Expected 307 redirect, got ${registerAuthRes.status}`);
  const redirectLocation = registerAuthRes.headers.get('location') || '';
  assert.equal(redirectLocation, '/membership?plan=AURA_PLUS');
  console.log(`   ✓ Authenticated member automatically redirected to: ${redirectLocation}`);

  // Scenario 10: Authenticated user accessing /membership
  console.log('10. Testing /membership access for authenticated user...');
  const membershipAuthRes = await fetch(`${BASE_URL}/membership`, {
    headers: { Cookie: authCookies },
    redirect: 'manual',
  });
  assert.equal(membershipAuthRes.status, 200);
  const membershipHtml = await membershipAuthRes.text();
  assert.match(membershipHtml, /Aura Membership/);
  console.log('   ✓ /membership portal loaded successfully (HTTP 200)');

  // Scenario 11: Unauthenticated user accessing /membership is redirected to login
  console.log('11. Testing /membership redirect for unauthenticated user...');
  const membershipUnauthRes = await fetch(`${BASE_URL}/membership`, {
    redirect: 'manual',
  });
  assert.equal(membershipUnauthRes.status, 307);
  const loginRedirect = membershipUnauthRes.headers.get('location') || '';
  assert.match(loginRedirect, /\/auth\/login\?redirect=%2Fmembership/);
  console.log(`   ✓ Unauthenticated user redirected to: ${loginRedirect}`);

  // Scenario 12: Route alias /signup redirect
  console.log('12. Testing route alias /signup redirect...');
  const signupAliasRes = await fetch(`${BASE_URL}/signup`, {
    redirect: 'manual',
  });
  assert.equal(signupAliasRes.status, 307);
  const signupLocation = signupAliasRes.headers.get('location') || '';
  assert.match(signupLocation, /\/auth\/register/);
  console.log(`   ✓ /signup redirected to: ${signupLocation}`);

  console.log('\n=== ALL 12 VERIFICATION SCENARIOS PASSED WITH FLYING COLORS! ===');
}

main().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
