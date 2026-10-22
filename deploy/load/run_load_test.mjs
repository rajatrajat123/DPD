import { performance } from 'node:perf_hooks';

const BASE_URL = process.env.TARGET_URL || 'http://localhost:8080';

// Configuration stages
const STAGES = [
  { name: 'Warmup', vus: 5, durationMs: 5000 },
  { name: 'Sustained', vus: 20, durationMs: 15000 },
  { name: 'Peak', vus: 40, durationMs: 10000 },
];

const latencies = [];
let totalRequests = 0;
let failedRequests = 0;
const endpointMetrics = {};

function recordMetric(endpoint, durationMs, success) {
  latencies.push(durationMs);
  totalRequests++;
  if (!success) failedRequests++;

  if (!endpointMetrics[endpoint]) {
    endpointMetrics[endpoint] = { total: 0, failed: 0, latencies: [] };
  }
  endpointMetrics[endpoint].total++;
  if (!success) endpointMetrics[endpoint].failed++;
  endpointMetrics[endpoint].latencies.push(durationMs);
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function executeIteration(vuId, iterId) {
  const timestamp = Date.now();
  const testEmail = `load_vu${vuId}_iter${iterId}_${timestamp}@loadtest.aura.dating`;
  const testPassword = 'LoadPassword123!';

  // 1. Healthcheck
  try {
    const t0 = performance.now();
    const res = await fetch(`${BASE_URL}/healthz`);
    const dt = performance.now() - t0;
    recordMetric('GET /healthz', dt, res.status === 200);
  } catch (err) {
    recordMetric('GET /healthz', 0, false);
  }

  // 2. Billing policy & Plans catalog
  try {
    const t0 = performance.now();
    const res = await fetch(`${BASE_URL}/api/v1/billing/plans`);
    const dt = performance.now() - t0;
    recordMetric('GET /api/v1/billing/plans', dt, res.status === 200);
  } catch {
    recordMetric('GET /api/v1/billing/plans', 0, false);
  }

  // 3. User Registration
  let token = null;
  try {
    const t0 = performance.now();
    const res = await fetch(`${BASE_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        display_name: `LoadUser_${vuId}`,
        birthdate: '1995-04-12',
        gender_identities: ['non-binary'],
        sexual_orientations: ['queer'],
        pronouns: ['they/them'],
        relationship_intents: ['serious dating'],
        relationship_structure: 'MONOGAMOUS',
      }),
    });
    const dt = performance.now() - t0;
    const ok = res.status === 201;
    recordMetric('POST /api/v1/auth/register', dt, ok);
    if (ok) {
      const data = await res.json().catch(() => ({}));
      token = data.access_token;
    }
  } catch {
    recordMetric('POST /api/v1/auth/register', 0, false);
  }

  // 4. Authenticated profile & discovery
  if (token) {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    try {
      const t0 = performance.now();
      const res = await fetch(`${BASE_URL}/api/v1/profiles/me`, { headers });
      const dt = performance.now() - t0;
      recordMetric('GET /api/v1/profiles/me', dt, res.status === 200);
    } catch {
      recordMetric('GET /api/v1/profiles/me', 0, false);
    }

    try {
      const t0 = performance.now();
      const res = await fetch(`${BASE_URL}/api/v1/discovery/feed?limit=10`, { headers });
      const dt = performance.now() - t0;
      recordMetric('GET /api/v1/discovery/feed', dt, res.status === 200);
    } catch {
      recordMetric('GET /api/v1/discovery/feed', 0, false);
    }

    // 5. Google Play Compliance Account Deletion Request
    try {
      const t0 = performance.now();
      const res = await fetch(`${BASE_URL}/api/v1/auth/deletion-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          reason: 'k6_automated_load_test',
          confirm_deletion: true,
        }),
      });
      const dt = performance.now() - t0;
      recordMetric('POST /api/v1/auth/deletion-request', dt, res.status === 200);
    } catch {
      recordMetric('POST /api/v1/auth/deletion-request', 0, false);
    }
  }
}

async function runStage(stage) {
  console.log(`\n=== Running Stage: ${stage.name} (${stage.vus} VUs, ${stage.durationMs / 1000}s) ===`);
  const endTime = Date.now() + stage.durationMs;
  let iterCounter = 0;

  async function worker(vuId) {
    while (Date.now() < endTime) {
      iterCounter++;
      await executeIteration(vuId, iterCounter);
      await new Promise((r) => setTimeout(r, 100)); // 100ms think time
    }
  }

  const workers = [];
  for (let vu = 1; vu <= stage.vus; vu++) {
    workers.push(worker(vu));
  }
  await Promise.all(workers);
}

async function main() {
  console.log(`Starting Aura Capacity & Load Test against ${BASE_URL}`);
  const startTime = Date.now();

  for (const stage of STAGES) {
    await runStage(stage);
  }

  const totalTimeSec = (Date.now() - startTime) / 1000;
  const throughputRps = totalRequests / totalTimeSec;
  const errorRate = (failedRequests / totalRequests) * 100;

  console.log('\n======================================================');
  console.log('             AURA LOAD TEST RESULTS REPORT            ');
  console.log('======================================================');
  console.log(`Target Backend:       ${BASE_URL}`);
  console.log(`Test Duration:        ${totalTimeSec.toFixed(2)} seconds`);
  console.log(`Total Requests:       ${totalRequests}`);
  console.log(`Failed Requests:      ${failedRequests}`);
  console.log(`Error Rate:           ${errorRate.toFixed(2)}%`);
  console.log(`Throughput:           ${throughputRps.toFixed(2)} req/sec`);
  console.log('------------------------------------------------------');
  console.log(`p50 Latency (median): ${percentile(latencies, 50).toFixed(2)} ms`);
  console.log(`p90 Latency:          ${percentile(latencies, 90).toFixed(2)} ms`);
  console.log(`p95 Latency:          ${percentile(latencies, 95).toFixed(2)} ms`);
  console.log(`p99 Latency:          ${percentile(latencies, 99).toFixed(2)} ms`);
  console.log(`Max Latency:          ${Math.max(...latencies).toFixed(2)} ms`);
  console.log('------------------------------------------------------');
  console.log('Endpoint Breakdown:');
  for (const [ep, data] of Object.entries(endpointMetrics)) {
    const epP50 = percentile(data.latencies, 50).toFixed(1);
    const epP95 = percentile(data.latencies, 95).toFixed(1);
    const epErr = ((data.failed / data.total) * 100).toFixed(1);
    console.log(`  ${ep.padEnd(35)} Count: ${String(data.total).padEnd(6)} Errors: ${epErr}%   p50: ${epP50}ms  p95: ${epP95}ms`);
  }
  console.log('======================================================');
}

main().catch(console.error);
