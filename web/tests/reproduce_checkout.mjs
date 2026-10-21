const BASE_URL = 'http://localhost:3000';

async function testCheckoutFlow() {
  console.log('--- REPRODUCING LOCALHOST CHECKOUT FLOW ---\n');

  // Step 1: Register/Login test user
  const email = `stripe_test_${Date.now()}@example.com`;
  console.log(`1. Registering test user (${email})...`);
  const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Passw0r!Valid',
      display_name: 'Stripe Tester',
      birthdate: '1996-05-20',
      gender_identities: ['non-binary'],
      sexual_orientations: ['queer'],
    }),
  });

  const regBody = await regRes.text();
  console.log(`   Registration status: ${regRes.status}, body: ${regBody}`);
  const regCookies = regRes.headers.get('set-cookie') || '';
  const sessionMatch = regCookies.match(/aura_session=([^;]+)/);
  if (!sessionMatch) {
    console.error('   ❌ No aura_session cookie returned');
    return;
  }
  const token = sessionMatch[1];
  console.log(`   ✓ Received aura_session cookie (length: ${token.length})`);

  // Step 2: Request billing plans via Next.js proxy
  console.log('\n2. Fetching available billing plans via /api/v1/billing/plans...');
  const plansRes = await fetch(`${BASE_URL}/api/v1/billing/plans`, {
    headers: { Cookie: `aura_session=${token}` },
  });
  console.log(`   Plans status: ${plansRes.status}`);
  const plansData = await plansRes.json();
  const plans = plansData.plans || plansData;
  console.log(`   ✓ Received ${plans.length} plans:`, plans.map(p => `${p.plan_code} ($${(p.price_cents/100).toFixed(2)})`).join(', '));

  // Step 3: Check current subscription status
  console.log('\n3. Fetching subscription status via /api/v1/billing/subscription...');
  const subRes = await fetch(`${BASE_URL}/api/v1/billing/subscription`, {
    headers: {
      Cookie: `aura_session=${token}`,
      Authorization: `Bearer ${token}`,
    },
  });
  console.log(`   Subscription status: ${subRes.status}`);
  const subData = await subRes.json();
  console.log('   Subscription data:', JSON.stringify(subData));

  // Step 4: Initiate checkout for AURA_PLUS_MONTHLY
  console.log('\n4. Initiating checkout via POST /api/v1/billing/checkout...');
  const checkoutPayload = {
    plan_code: 'AURA_PLUS_MONTHLY',
    provider: 'STRIPE',
    success_url: 'http://localhost:3000/membership?status=success',
    cancel_url: 'http://localhost:3000/membership?status=cancelled',
    terms_accepted: true,
    terms_version: '2026-10-v1',
    storefront: 'US',
  };

  const checkoutRes = await fetch(`${BASE_URL}/api/v1/billing/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `aura_session=${token}`,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(checkoutPayload),
  });

  console.log(`   Checkout response status: ${checkoutRes.status}`);
  const checkoutData = await checkoutRes.json();
  console.log('   Checkout response body:', JSON.stringify(checkoutData, null, 2));

  // Step 5: Also test direct call to Go backend on port 8080
  console.log('\n5. Direct call to Go backend at http://127.0.0.1:8080/api/v1/billing/checkout...');
  const directRes = await fetch('http://127.0.0.1:8080/api/v1/billing/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(checkoutPayload),
  });
  console.log(`   Direct backend checkout status: ${directRes.status}`);
  const directData = await directRes.json();
  console.log('   Direct backend checkout body:', JSON.stringify(directData, null, 2));
}

testCheckoutFlow().catch(console.error);
