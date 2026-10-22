import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom Metrics
const successfulLogins = new Counter('successful_logins');
const messageOperations = new Counter('message_operations');
const accountDeletions = new Counter('account_deletions');
const customErrorRate = new Rate('api_error_rate');
const authLatency = new Trend('auth_duration_ms');
const chatLatency = new Trend('chat_duration_ms');

export const options = {
  stages: [
    { duration: '10s', target: 5 },   // Phase 1: Smoke / Warmup (5 users)
    { duration: '20s', target: 25 },  // Phase 2: Moderate load (25 users)
    { duration: '20s', target: 50 },  // Phase 3: Peak concurrency (50 users)
    { duration: '10s', target: 0 },   // Phase 4: Cool-down
  ],
  thresholds: {
    http_req_duration: ['p(50)<150', 'p(95)<400', 'p(99)<800'],
    http_req_failed: ['rate<0.05'], // Max 5% error rate across peak load
    api_error_rate: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:8080';

export default function () {
  const vuId = __VU;
  const iterId = __ITER;
  const timestamp = Date.now();
  const testEmail = `loadtest_vu${vuId}_iter${iterId}_${timestamp}@loadtest.aura.dating`;
  const testPassword = 'LoadPassword123!';

  // Group 1: Infrastructure & Health Probes
  group('01_Infrastructure_Health', () => {
    const healthRes = http.get(`${BASE_URL}/healthz`);
    check(healthRes, {
      'healthz status is 200': (r) => r.status === 200,
    });
    customErrorRate.add(healthRes.status !== 200);

    const readyRes = http.get(`${BASE_URL}/health/ready`);
    check(readyRes, {
      'health/ready returns valid probe response': (r) => r.status === 200 || r.status === 503,
    });
    customErrorRate.add(readyRes.status !== 200 && readyRes.status !== 503);
  });

  // Group 2: Public Product Catalog & Billing Policies
  group('02_Public_Catalog', () => {
    const policyRes = http.get(`${BASE_URL}/api/v1/billing/policy?platform=android&storefront=US`);
    check(policyRes, {
      'billing policy status is 200': (r) => r.status === 200,
    });
    customErrorRate.add(policyRes.status !== 200);

    const plansRes = http.get(`${BASE_URL}/api/v1/billing/plans`);
    check(plansRes, {
      'plans status is 200': (r) => r.status === 200,
    });
    customErrorRate.add(plansRes.status !== 200);
  });

  // Group 3: Disposable User Registration & Authentication
  let authToken = '';
  let userId = '';

  group('03_Auth_Registration', () => {
    const registerPayload = JSON.stringify({
      email: testEmail,
      password: testPassword,
      display_name: `LoadUser_${vuId}`,
      birthdate: '1996-05-12',
      gender_identities: ['non-binary'],
      sexual_orientations: ['queer'],
      pronouns: ['they/them'],
      relationship_intents: ['serious dating'],
      relationship_structure: 'MONOGAMOUS',
    });

    const regStart = Date.now();
    const regRes = http.post(`${BASE_URL}/api/v1/auth/register`, registerPayload, {
      headers: { 'Content-Type': 'application/json' },
    });
    authLatency.add(Date.now() - regStart);

    const regOk = check(regRes, {
      'register status is 201': (r) => r.status === 201,
      'register returns access_token': (r) => {
        try {
          return Boolean(r.json('access_token'));
        } catch {
          return false;
        }
      },
    });
    customErrorRate.add(!regOk);

    if (regOk) {
      successfulLogins.add(1);
      authToken = regRes.json('access_token');
      userId = regRes.json('user.id');
    }
  });

  // Group 4: Authenticated Profile & Discovery Operations
  if (authToken) {
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    };

    group('04_Profile_And_Discovery', () => {
      const profileRes = http.get(`${BASE_URL}/api/v1/profiles/me`, { headers: authHeaders });
      check(profileRes, {
        'get my profile status is 200': (r) => r.status === 200,
      });

      const feedRes = http.get(`${BASE_URL}/api/v1/discovery/feed?limit=10`, { headers: authHeaders });
      check(feedRes, {
        'discovery feed returns 200': (r) => r.status === 200,
      });

      const convsRes = http.get(`${BASE_URL}/api/v1/conversations`, { headers: authHeaders });
      check(convsRes, {
        'list conversations returns 200': (r) => r.status === 200,
      });
    });

    // Group 5: Web Deletion Request (Google Play Compliance)
    group('05_External_Web_Deletion_Request', () => {
      const deletionPayload = JSON.stringify({
        email: testEmail,
        reason: 'k6_automated_load_test_cleanup',
        confirm_deletion: true,
      });

      const reqStart = Date.now();
      const delRes = http.post(`${BASE_URL}/api/v1/auth/deletion-request`, deletionPayload, {
        headers: { 'Content-Type': 'application/json' },
      });

      const delOk = check(delRes, {
        'deletion-request status is 200': (r) => r.status === 200,
        'deletion-request success is true': (r) => {
          try {
            return r.json('success') === true;
          } catch {
            return false;
          }
        },
      });
      customErrorRate.add(!delOk);
      if (delOk) {
        accountDeletions.add(1);
      }
    });
  }

  sleep(0.5);
}
