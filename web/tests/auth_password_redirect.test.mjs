import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Extract the password validation implementation from src/lib/validation/password.ts
const tsContent = readFileSync(join(process.cwd(), 'src/lib/validation/password.ts'), 'utf-8');

// Strip TypeScript type annotations for direct execution in Node runner
const jsCode = tsContent
  .replace(/export\s+interface\s+[\s\S]*?}/g, '')
  .replace(/:\s*PasswordRequirementsStatus/g, '')
  .replace(/:\s*PasswordValidationResult/g, '')
  .replace(/:\s*string\[\]/g, '')
  .replace(/:\s*string/g, '')
  .replace(/export\s+/g, '');

const fnModule = new Function(jsCode + `
  return {
    PASSWORD_MIN_LENGTH,
    PASSWORD_MAX_LENGTH,
    checkPasswordRequirements,
    validatePasswordPolicy
  };
`)();

const {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  checkPasswordRequirements,
  validatePasswordPolicy,
} = fnModule;

test('Password Policy: validation constants and policy enforcement', async (t) => {
  await t.test('enforces length boundaries: 8 to 128 characters', () => {
    assert.equal(PASSWORD_MIN_LENGTH, 8);
    assert.equal(PASSWORD_MAX_LENGTH, 128);

    // Below minimum (< 8)
    const shortRes = validatePasswordPolicy('Short1!');
    assert.equal(shortRes.valid, false);
    assert.match(shortRes.error, /at least 8 characters/);

    // Above maximum (> 128)
    const longPw = 'A1!' + 'a'.repeat(126);
    const longRes = validatePasswordPolicy(longPw);
    assert.equal(longRes.valid, false);
    assert.match(longRes.error, /cannot exceed 128 characters/);
  });

  await t.test('enforces numeric digit requirement', () => {
    const noDigit = validatePasswordPolicy('Password!@#');
    assert.equal(noDigit.valid, false);
    assert.match(noDigit.error, /at least one numeric digit/);
  });

  await t.test('enforces special character requirement (including symbols, punctuation, underscore)', () => {
    const noSpecial = validatePasswordPolicy('Password1234');
    assert.equal(noSpecial.valid, false);
    assert.match(noSpecial.error, /at least one special character/);

    // Underscore counts as special character
    const withUnderscore = validatePasswordPolicy('Password_123');
    assert.equal(withUnderscore.valid, true);
    assert.equal(withUnderscore.error, null);

    // Various standard symbols
    for (const sym of ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '-', '+', '=', '{', '}', '[', ']', ':', ';', '<', '>', ',', '.', '?', '/', '~']) {
      const res = validatePasswordPolicy(`Secret${sym}99`);
      assert.equal(res.valid, true, `Expected symbol ${sym} to be accepted`);
    }
  });

  await t.test('accepts valid passwords across wide length ranges without truncation', () => {
    // Exactly 8 chars
    assert.equal(validatePasswordPolicy('Passw0r!').valid, true);

    // 16 chars
    assert.equal(validatePasswordPolicy('AuraSecure2026!#').valid, true);

    // 64 chars
    const pw64 = 'K9#' + 'x'.repeat(61);
    assert.equal(validatePasswordPolicy(pw64).valid, true);

    // 128 chars
    const pw128 = 'M7$' + 'z'.repeat(125);
    assert.equal(validatePasswordPolicy(pw128).valid, true);
  });

  await t.test('checkPasswordRequirements returns correct granular breakdown for UI checklists', () => {
    const partial = checkPasswordRequirements('pass');
    assert.equal(partial.hasMinLength, false);
    assert.equal(partial.hasDigit, false);
    assert.equal(partial.hasSpecial, false);
    assert.equal(partial.hasValidMax, true);

    const withNum = checkPasswordRequirements('pass1234');
    assert.equal(withNum.hasMinLength, true);
    assert.equal(withNum.hasDigit, true);
    assert.equal(withNum.hasSpecial, false);

    const complete = checkPasswordRequirements('Passw0rd_!');
    assert.equal(complete.hasMinLength, true);
    assert.equal(complete.hasDigit, true);
    assert.equal(complete.hasSpecial, true);
    assert.equal(complete.hasValidMax, true);
  });
});

test('Auth & Session Cookies: security and client detection', async (t) => {
  await t.test('Register route sets httpOnly aura_session and non-httpOnly aura_auth_state', () => {
    const routeCode = readFileSync(join(process.cwd(), 'src/app/api/auth/register/route.ts'), 'utf-8');
    assert.match(routeCode, /res\.cookies\.set\('aura_session',/);
    assert.match(routeCode, /httpOnly:\s*true/);
    assert.match(routeCode, /res\.cookies\.set\('aura_auth_state',\s*'1'/);
    assert.match(routeCode, /httpOnly:\s*false/);
  });

  await t.test('Login route sets httpOnly aura_session and non-httpOnly aura_auth_state', () => {
    const routeCode = readFileSync(join(process.cwd(), 'src/app/api/auth/login/route.ts'), 'utf-8');
    assert.match(routeCode, /res\.cookies\.set\('aura_session',/);
    assert.match(routeCode, /httpOnly:\s*true/);
    assert.match(routeCode, /res\.cookies\.set\('aura_auth_state',\s*'1'/);
    assert.match(routeCode, /httpOnly:\s*false/);
  });

  await t.test('Logout route clears both aura_session and aura_auth_state cookies', () => {
    const routeCode = readFileSync(join(process.cwd(), 'src/app/api/auth/logout/route.ts'), 'utf-8');
    assert.match(routeCode, /res\.cookies\.set\('aura_session',\s*'',/);
    assert.match(routeCode, /res\.cookies\.set\('aura_auth_state',\s*'',/);
  });
});

test('Subscription Routing & Redirect Preservation', async (t) => {
  await t.test('Pricing page directs authenticated members directly to /membership with plan query', () => {
    const pricingCode = readFileSync(join(process.cwd(), 'src/app/pricing/page.tsx'), 'utf-8');
    assert.match(pricingCode, /const session = await getAuthSession\(\)/);
    assert.match(pricingCode, /\/membership\?plan=AURA_PLUS/);
    assert.match(pricingCode, /\/membership\?plan=AURA_ELITE/);
    assert.match(pricingCode, /\/app\/discovery/);
  });

  await t.test('Register page checks getAuthSession and immediately redirects authenticated members', () => {
    const registerCode = readFileSync(join(process.cwd(), 'src/app/auth/register/page.tsx'), 'utf-8');
    assert.match(registerCode, /const session = await getAuthSession\(\)/);
    assert.match(registerCode, /if \(session\) \{[\s\n]*redirect\(targetDestination\);/);
  });

  await t.test('Onboarding forwards user to preserved redirectTarget upon completion', () => {
    const onboardingCode = readFileSync(join(process.cwd(), 'src/app/onboarding/page.tsx'), 'utf-8');
    assert.match(onboardingCode, /const redirectTarget = searchParams\.get\('redirect'\) \|\| '\/app\/discovery'/);
    assert.match(onboardingCode, /router\.push\(redirectTarget\)/);
  });

  await t.test('next.config.mjs provides alias redirects for /signup, /register, and /login', () => {
    const configCode = readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf-8');
    assert.match(configCode, /source:\s*'\/signup'/);
    assert.match(configCode, /destination:\s*'\/auth\/register'/);
    assert.match(configCode, /source:\s*'\/register'/);
    assert.match(configCode, /source:\s*'\/login'/);
    assert.match(configCode, /destination:\s*'\/auth\/login'/);
  });
});
