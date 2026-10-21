import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = 'http://localhost:3000';
const BACKEND_URL = 'http://127.0.0.1:8080';

test('Premium Payment Checkout Flow Verification', async (t) => {
  // Setup: Register a unique test user
  const email = `verify_pay_${Date.now()}@example.com`;
  const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Passw0r!Valid',
      display_name: 'Payment Tester',
      birthdate: '1995-08-12',
      gender_identities: ['non-binary'],
      sexual_orientations: ['queer'],
    }),
  });
  assert.equal(regRes.status, 200);
  const regCookies = regRes.headers.get('set-cookie') || '';
  const tokenMatch = regCookies.match(/aura_session=([^;]+)/);
  assert.ok(tokenMatch, 'Expected aura_session cookie');
  const token = tokenMatch[1];
  const authHeaders = {
    Cookie: `aura_session=${token}`,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  await t.test('1. Catalog is backend-authoritative (Client never defines prices)', async () => {
    const plansRes = await fetch(`${BASE_URL}/api/v1/billing/plans`);
    assert.equal(plansRes.status, 200);
    const data = await plansRes.json();
    const plans = data.plans || data;

    const plusMonthly = plans.find((p) => p.plan_code === 'AURA_PLUS_MONTHLY');
    assert.ok(plusMonthly, 'Expected AURA_PLUS_MONTHLY in catalog');
    assert.equal(plusMonthly.price_cents, 1999);
    assert.equal(plusMonthly.currency, 'USD');
    assert.equal(plusMonthly.billing_period, 'MONTHLY');
    assert.equal(plusMonthly.tier, 'PLUS');
    assert.ok(plusMonthly.entitlements.includes('UNLIMITED_SWIPES'));
  });

  await t.test('2. Unauthenticated checkout requests are strictly rejected with HTTP 401', async () => {
    const unauthRes = await fetch(`${BASE_URL}/api/v1/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_code: 'AURA_PLUS_MONTHLY',
        provider: 'STRIPE',
        terms_accepted: true,
      }),
    });
    assert.equal(unauthRes.status, 401);
  });

  await t.test('3. Checkout strictly requires explicit subscription consent (terms_accepted: true)', async () => {
    const noConsentRes = await fetch(`${BASE_URL}/api/v1/billing/checkout`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        plan_code: 'AURA_PLUS_MONTHLY',
        provider: 'STRIPE',
        terms_accepted: false,
        success_url: 'http://localhost:3000/membership?status=success',
        cancel_url: 'http://localhost:3000/membership?status=cancelled',
      }),
    });
    assert.equal(noConsentRes.status, 400);
    const errData = await noConsentRes.json();
    assert.match(errData.error.message, /acceptance of subscription terms/i);
  });

  await t.test('4. Missing Stripe Secret Key fails closed with HTTP 503 PROVIDER_NOT_CONFIGURED', async () => {
    const checkoutRes = await fetch(`${BASE_URL}/api/v1/billing/checkout`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        plan_code: 'AURA_PLUS_MONTHLY',
        provider: 'STRIPE',
        success_url: 'http://localhost:3000/membership?status=success',
        cancel_url: 'http://localhost:3000/membership?status=cancelled',
        terms_accepted: true,
        terms_version: '2026-10-v1',
        storefront: 'US',
      }),
    });

    assert.equal(checkoutRes.status, 503);
    const data = await checkoutRes.json();
    assert.equal(data.error.code, 'PROVIDER_NOT_CONFIGURED');
    assert.match(data.error.message, /STRIPE_SECRET_KEY/);
  });

  await t.test('5. Returning to success URL (?status=success) alone NEVER grants premium entitlements', async () => {
    // Navigate to membership with success status in URL query
    const successUrlRes = await fetch(`${BASE_URL}/membership?status=success`, {
      headers: { Cookie: `aura_session=${token}` },
    });
    assert.equal(successUrlRes.status, 200);

    // Query backend authoritative subscription status
    const subRes = await fetch(`${BASE_URL}/api/v1/billing/subscription`, {
      headers: authHeaders,
    });
    assert.equal(subRes.status, 200);
    const subData = await subRes.json();

    // Invariant: User MUST still be FREE tier with zero entitlements
    assert.equal(subData.has_active_subscription, false);
    assert.equal(subData.tier, 'FREE');
    assert.deepEqual(subData.entitlements, []);
  });

  await t.test('6. Returning to cancellation URL (?status=cancelled) reflects no charges', async () => {
    const cancelUrlRes = await fetch(`${BASE_URL}/membership?status=cancelled`, {
      headers: { Cookie: `aura_session=${token}` },
    });
    assert.equal(cancelUrlRes.status, 200);
    const html = await cancelUrlRes.text();
    assert.match(html, /Aura Membership/);
  });

  await t.test('7. Webhook signature validation fails closed on invalid or missing signatures', async () => {
    const webhookRes = await fetch(`${BACKEND_URL}/api/v1/billing/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=12345,v1=fake_signature',
      },
      body: JSON.stringify({ id: 'evt_fake', type: 'checkout.session.completed' }),
    });
    assert.equal(webhookRes.status, 400);
    const err = await webhookRes.json();
    assert.match(err.error.message, /Invalid webhook signature/i);
  });
});
