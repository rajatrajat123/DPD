import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

test('Membership Route: Next.js page.tsx exists and exports valid dynamic config', () => {
  const pagePath = resolve(process.cwd(), 'src/app/membership/page.tsx');
  assert.equal(existsSync(pagePath), true, 'membership page.tsx must exist');

  const content = readFileSync(pagePath, 'utf-8');
  assert.match(content, /requireAuthSession\('\/membership'\)/, 'must enforce server-side auth guard');
  assert.match(content, /MembershipClient/, 'must render MembershipClient component');
});

test('Membership Client: handles store linkouts, consent, and self-service cancellation', () => {
  const clientPath = resolve(process.cwd(), 'src/app/membership/MembershipClient.tsx');
  assert.equal(existsSync(clientPath), true, 'MembershipClient.tsx must exist');

  const content = readFileSync(clientPath, 'utf-8');
  assert.match(content, /handleCancelRenewal/, 'must have self-service cancellation handler');
  assert.match(content, /\/api\/v1\/billing\/subscription\/cancel/, 'must call backend cancellation API');
  assert.match(content, /terms_accepted:\s*true/, 'must enforce terms_accepted in checkout payload');
  assert.match(content, /consentChecked/, 'must gate checkout button on explicit user consent');
  assert.match(content, /billing@auradating\.com/, 'must display dispute interception support contact');
});

test('Membership API Proxy: handles /api/v1/billing catch-all route', () => {
  const routePath = resolve(process.cwd(), 'src/app/api/v1/billing/[...path]/route.ts');
  assert.equal(existsSync(routePath), true, 'billing catch-all route.ts must exist');

  const content = readFileSync(routePath, 'utf-8');
  assert.match(content, /proxyToBackend/, 'must proxy billing calls to Go backend');
});

test('Terms of Service: includes mandatory Sections 3 & 4 covering auto-renewal & refund terms', () => {
  const termsPath = resolve(process.cwd(), 'src/app/legal/terms/page.tsx');
  assert.equal(existsSync(termsPath), true, 'terms page.tsx must exist');

  const content = readFileSync(termsPath, 'utf-8');
  assert.match(content, /Subscriptions, Automatic Renewal &amp; Cancellation/, 'Section 3 title required');
  assert.match(content, /Statutory Rights, Refunds &amp; Dispute Resolution/, 'Section 4 title required');
  assert.match(content, /billing@auradating\.com/, 'Billing contact email required');
  assert.match(content, /AURA\*DATING/, 'Recognizable billing descriptor required');
});
