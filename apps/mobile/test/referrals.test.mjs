import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('Referral & Rewards: Screen file existence and route registration', () => {
  const referralsScreenPath = path.join(rootDir, 'app', 'referrals.tsx');
  assert.ok(fs.existsSync(referralsScreenPath), 'app/referrals.tsx must exist');

  const layoutPath = path.join(rootDir, 'app', '_layout.tsx');
  const layoutContent = fs.readFileSync(layoutPath, 'utf8');
  assert.ok(
    layoutContent.includes('name="referrals"'),
    'app/_layout.tsx must register the referrals stack screen'
  );
});

test('Referral & Rewards: Service methods and API endpoints contract', () => {
  const servicePath = path.join(rootDir, 'src', 'services', 'referral', 'referralService.ts');
  assert.ok(fs.existsSync(servicePath), 'referralService.ts must exist');

  const serviceContent = fs.readFileSync(servicePath, 'utf8');
  assert.ok(
    serviceContent.includes('/api/v1/referrals/me'),
    'referralService must call /api/v1/referrals/me'
  );
  assert.ok(
    serviceContent.includes('/api/v1/referrals/refresh'),
    'referralService must call /api/v1/referrals/refresh'
  );
  assert.ok(
    serviceContent.includes('shareInviteLink'),
    'referralService must export shareInviteLink'
  );
});

test('Referral & Rewards: In-app navigation shortcuts exist', () => {
  // Check Profile screen shortcut
  const profilePath = path.join(rootDir, 'app', '(tabs)', 'profile.tsx');
  const profileContent = fs.readFileSync(profilePath, 'utf8');
  assert.ok(
    profileContent.includes('/referrals'),
    'profile.tsx must link to /referrals'
  );

  // Check Settings screen shortcut
  const settingsPath = path.join(rootDir, 'app', '(tabs)', 'settings.tsx');
  const settingsContent = fs.readFileSync(settingsPath, 'utf8');
  assert.ok(
    settingsContent.includes('/referrals'),
    'settings.tsx must link to /referrals'
  );

  // Check Membership screen banner
  const membershipPath = path.join(rootDir, 'app', '(tabs)', 'membership.tsx');
  const membershipContent = fs.readFileSync(membershipPath, 'utf8');
  assert.ok(
    membershipContent.includes('/referrals'),
    'membership.tsx must link to /referrals'
  );
});

test('Referral & Rewards: Milestone logic and distinction from paid VIP', () => {
  const screenPath = path.join(rootDir, 'app', 'referrals.tsx');
  const screenContent = fs.readFileSync(screenPath, 'utf8');

  // Milestone 1 (1 referral = 30 days) and Milestone 2 (3 referrals = 60 days total)
  assert.ok(
    screenContent.includes('30 days of ad-supported free access'),
    'Screen must display 30 days milestone for 1 referral'
  );
  assert.ok(
    screenContent.includes('60 days total ad-supported free access'),
    'Screen must display 60 days total milestone for 3 referrals'
  );

  // Clear distinction between ad-supported access and VIP
  assert.ok(
    screenContent.includes('Ad-supported free access includes standard advertisements and does not grant paid Aura Plus / Aura Black ad-free privileges'),
    'Screen must display notice distinguishing ad-supported free access from paid VIP'
  );
});
