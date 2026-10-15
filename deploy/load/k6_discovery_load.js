import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },  // Ramp up to 20 users
    { duration: '1m', target: 50 },   // Sustained load at 50 users
    { duration: '30s', target: 100 }, // Peak stress at 100 users
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(99)<350'], // 95% of requests under 200ms
    http_req_failed: ['rate<0.01'],                 // Under 1% error rate
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:8080';

export default function () {
  // 1. Healthcheck probe
  const healthRes = http.get(`${BASE_URL}/healthz`);
  check(healthRes, {
    'healthz status is 200': (r) => r.status === 200,
  });

  // 2. Public Storefront Billing Policy
  const policyRes = http.get(`${BASE_URL}/api/v1/billing/policy?platform=ios&storefront=US`);
  check(policyRes, {
    'policy status is 200': (r) => r.status === 200,
    'supported methods present': (r) => r.json('supported_billing_methods') !== undefined,
  });

  // 3. Public Plans Catalog
  const plansRes = http.get(`${BASE_URL}/api/v1/billing/plans`);
  check(plansRes, {
    'plans status is 200': (r) => r.status === 200,
    'plans count >= 4': (r) => r.json('plans').length >= 4,
  });

  sleep(1);
}
