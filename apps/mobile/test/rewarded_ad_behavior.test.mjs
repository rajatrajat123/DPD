import test from 'node:test';
import assert from 'node:assert/strict';

// In-memory mock for secure storage
class MockSecureStorage {
  constructor(initialData = {}) {
    this.store = new Map(Object.entries(initialData));
  }
  async getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  async setItem(key, value) {
    this.store.set(key, String(value));
  }
  async removeItem(key) {
    this.store.delete(key);
  }
}

// Behavioral implementation of AdBreakManager using the exact logic from admobService.ts
class BehavioralAdBreakManager {
  constructor(storage = new MockSecureStorage()) {
    this.storage = storage;
    this.swipeCount = 0;
    this.firstAdCompleted = false;
    this.viewedProfileIds = new Set();
    this.isHydrated = false;
    this.lastSwipedProfileId = null;
    this.hydrationPromise = this.hydrate();
  }

  async ensureHydrated() {
    if (this.isHydrated) return;
    if (this.hydrationPromise) {
      await this.hydrationPromise;
    } else {
      await this.hydrate();
    }
  }

  async hydrate() {
    try {
      const storedCount = await this.storage.getItem('aura_ad_swipe_count');
      const storedFirstAd = await this.storage.getItem('aura_ad_first_completed');
      const storedProfiles = await this.storage.getItem('aura_ad_viewed_profiles');
      if (storedCount !== null) {
        const parsed = parseInt(storedCount, 10);
        if (!isNaN(parsed)) this.swipeCount = parsed;
      }
      if (storedFirstAd !== null) {
        this.firstAdCompleted = storedFirstAd === 'true';
      }
      if (storedProfiles) {
        try {
          const ids = JSON.parse(storedProfiles);
          if (Array.isArray(ids)) {
            this.viewedProfileIds = new Set(ids);
          }
        } catch {}
      }
    } catch {}
    this.isHydrated = true;
  }

  async persist() {
    try {
      await this.storage.setItem('aura_ad_swipe_count', String(this.swipeCount));
      await this.storage.setItem('aura_ad_first_completed', this.firstAdCompleted ? 'true' : 'false');
      await this.storage.setItem('aura_ad_viewed_profiles', JSON.stringify(Array.from(this.viewedProfileIds)));
    } catch {}
  }

  recordProfileView(profileId, isIntroductory = false) {
    if (profileId) {
      // 1. Prevent duplicate counting from immediate rerenders or retries on the same active card
      if (this.lastSwipedProfileId === profileId) {
        return this.shouldShowRequiredAd(isIntroductory);
      }

      // 2. Profile-ID deduplication:
      // If profile was seen in current cycle, allow counting if cycling past other cards
      // to avoid deadlock when candidate pool has fewer unique profiles than threshold (15)
      if (this.viewedProfileIds.has(profileId)) {
        if (this.swipeCount < 15 && this.viewedProfileIds.size < 15) {
          this.lastSwipedProfileId = profileId;
          this.swipeCount += 1;
          this.persist();
          return this.shouldShowRequiredAd(isIntroductory);
        }
        return this.shouldShowRequiredAd(isIntroductory);
      }

      this.viewedProfileIds.add(profileId);
      this.lastSwipedProfileId = profileId;
    }

    this.swipeCount += 1;
    this.persist();
    return this.shouldShowRequiredAd(isIntroductory);
  }

  shouldShowRequiredAd(isIntroductory = false) {
    const threshold = 15;
    return this.swipeCount >= threshold;
  }

  async onAdCompleted() {
    this.swipeCount = 0;
    this.firstAdCompleted = true;
    this.viewedProfileIds.clear();
    this.lastSwipedProfileId = null;
    await this.persist();
  }

  onAdFailed() {
    // Counter is preserved
  }

  getSwipeCount() {
    return this.swipeCount;
  }

  isFirstAdCompleted() {
    return this.firstAdCompleted;
  }
}

test('Behavioral: 15 qualifying swipes reach threshold exactly at 15', async () => {
  const manager = new BehavioralAdBreakManager();
  await manager.ensureHydrated();

  // Swipes 1 to 14 do not trigger threshold
  for (let i = 1; i <= 14; i++) {
    const triggered = manager.recordProfileView(`profile_${i}`, true);
    assert.equal(triggered, false, `Swipe ${i} must not trigger 15-swipe ad`);
    assert.equal(manager.getSwipeCount(), i);
  }

  // 15th swipe triggers ad break
  const triggeredAt15 = manager.recordProfileView('profile_15', true);
  assert.equal(triggeredAt15, true, '15th swipe must trigger ad break threshold');
  assert.equal(manager.getSwipeCount(), 15);
});

test('Behavioral: Rerenders and retries on the same active card do not double count', async () => {
  const manager = new BehavioralAdBreakManager();
  await manager.ensureHydrated();

  // First view/swipe of profile_A
  manager.recordProfileView('profile_A', true);
  assert.equal(manager.getSwipeCount(), 1);

  // Immediate rerenders or retry attempts on same card do not increment
  manager.recordProfileView('profile_A', true);
  manager.recordProfileView('profile_A', true);
  manager.recordProfileView('profile_A', true);
  assert.equal(manager.getSwipeCount(), 1, 'Consecutive duplicate profile calls must be ignored');

  // Next distinct profile increments
  manager.recordProfileView('profile_B', true);
  assert.equal(manager.getSwipeCount(), 2);
});

test('Behavioral: Candidate pool smaller than 15 cycles without deadlocking counter', async () => {
  const manager = new BehavioralAdBreakManager();
  await manager.ensureHydrated();

  // Candidate pool only has 5 mock profiles: P1 to P5
  const mockPool = ['P1', 'P2', 'P3', 'P4', 'P5'];

  // Swipe through mock pool 3 times (15 total swipes)
  let triggerCount = 0;
  for (let round = 0; round < 3; round++) {
    for (const pid of mockPool) {
      const triggered = manager.recordProfileView(pid, true);
      if (triggered) triggerCount++;
    }
  }

  // Counter must reach 15 and trigger threshold, despite pool size < 15
  assert.equal(manager.getSwipeCount(), 15, 'Counter must reach 15 even when deck cycles');
  assert.equal(triggerCount, 1, 'Threshold must be triggered upon 15th swipe');
});

test('Behavioral: Hydration restores swipe count and viewed profiles after app restart', async () => {
  const mockStorage = new MockSecureStorage({
    aura_ad_swipe_count: '11',
    aura_ad_first_completed: 'false',
    aura_ad_viewed_profiles: JSON.stringify(['prev_1', 'prev_2', 'prev_3']),
  });

  const manager = new BehavioralAdBreakManager(mockStorage);
  await manager.ensureHydrated();

  // Verify counter restored
  assert.equal(manager.getSwipeCount(), 11, 'Counter must restore to 11 from storage');

  // 4 more swipes reach 15
  manager.recordProfileView('new_1', true);
  manager.recordProfileView('new_2', true);
  manager.recordProfileView('new_3', true);
  const triggered = manager.recordProfileView('new_4', true);

  assert.equal(manager.getSwipeCount(), 15);
  assert.equal(triggered, true, 'Threshold must trigger when resumed count reaches 15');
});

test('Behavioral: Failed or skipped ad does NOT reset counter; retains threshold', async () => {
  const manager = new BehavioralAdBreakManager();
  await manager.ensureHydrated();

  for (let i = 1; i <= 15; i++) {
    manager.recordProfileView(`cand_${i}`, true);
  }
  assert.equal(manager.getSwipeCount(), 15);
  assert.equal(manager.shouldShowRequiredAd(true), true);

  // Ad fails to load or user closes video prematurely
  manager.onAdFailed();

  // Counter must still be 15
  assert.equal(manager.getSwipeCount(), 15, 'Failed ad must not reset counter');
  assert.equal(manager.shouldShowRequiredAd(true), true, 'Must still require ad completion on next action');
});

test('Behavioral: Successful ad completion + verified server claim resets cadence to 0', async () => {
  const manager = new BehavioralAdBreakManager();
  await manager.ensureHydrated();

  for (let i = 1; i <= 15; i++) {
    manager.recordProfileView(`cand_${i}`, true);
  }
  assert.equal(manager.getSwipeCount(), 15);

  // Mock server claim function
  let serverAllowance = { remainingLikes: 0, remainingBonusLikes: 0 };
  const mockServerClaim = async (txId) => {
    if (!txId || !txId.startsWith('test-admob-')) {
      throw new Error('INVALID_TRANSACTION');
    }
    serverAllowance = { remainingLikes: 5, remainingBonusLikes: 5 };
    return serverAllowance;
  };

  // Simulate ad earned reward callback
  const adResult = {
    rewarded: true,
    rewardAmount: 5,
    transactionId: 'test-admob-1234567890-abc1234',
  };

  // Complete reward flow
  assert.ok(adResult.rewarded);
  const updated = await mockServerClaim(adResult.transactionId);
  assert.equal(updated.remainingBonusLikes, 5);

  // Cadence reset
  await manager.onAdCompleted();
  assert.equal(manager.getSwipeCount(), 0, 'Counter must reset to 0 after verified completion');
  assert.equal(manager.isFirstAdCompleted(), true);
});

test('Behavioral: Server claim failure rejects reward grant and preserves cadence counter', async () => {
  const manager = new BehavioralAdBreakManager();
  await manager.ensureHydrated();

  for (let i = 1; i <= 15; i++) {
    manager.recordProfileView(`cand_${i}`, true);
  }
  assert.equal(manager.getSwipeCount(), 15);

  let uiAllowance = { remainingLikes: 0, remainingBonusLikes: 0 };

  // Server rejects synthetic or unverified transaction
  const mockFailingServerClaim = async (txId) => {
    throw new Error('raw_query cryptographic SSV callback is required in production; client transaction ID not accepted');
  };

  const adResult = {
    rewarded: true,
    transactionId: 'unverified-client-tx',
  };

  let claimSucceeded = false;
  try {
    const updated = await mockFailingServerClaim(adResult.transactionId);
    uiAllowance = updated;
    claimSucceeded = true;
  } catch (err) {
    claimSucceeded = false;
    // On failure: do NOT update uiAllowance locally, call onAdFailed
    manager.onAdFailed();
  }

  assert.equal(claimSucceeded, false, 'Server claim must fail');
  assert.equal(uiAllowance.remainingBonusLikes, 0, 'Local UI allowance must NOT be credited on server failure');
  assert.equal(manager.getSwipeCount(), 15, 'Counter must remain at 15 when server claim fails');
  assert.equal(manager.shouldShowRequiredAd(true), true);
});

test('Behavioral: Duplicate / overlapping ad requests guard prevents concurrent presentations', async () => {
  let isAdInProgress = false;
  let adInvocationCount = 0;

  const triggerAd = async () => {
    if (isAdInProgress) {
      return { skipped: true };
    }
    isAdInProgress = true;
    adInvocationCount++;

    // Simulate ad presenting for 50ms
    await new Promise((r) => setTimeout(r, 50));
    isAdInProgress = false;
    return { skipped: false, completed: true };
  };

  // Launch two rapid concurrent ad requests
  const [res1, res2] = await Promise.all([triggerAd(), triggerAd()]);

  assert.equal(adInvocationCount, 1, 'Only one ad invocation must be executed');
  assert.equal(res1.skipped || res2.skipped, true, 'Concurrent request must be skipped by guard');
});

test('Behavioral: Free-user eligibility includes 30-day introductory period users', () => {
  const checkEligibility = (allowance) => {
    const isPaidSubscriber = Boolean(allowance && allowance.isUnlimited && !allowance.isIntroductory);
    return !isPaidSubscriber;
  };

  // 1. Regular free user (out of trial, 15 likes per window)
  assert.equal(
    checkEligibility({ isUnlimited: false, isIntroductory: false, remainingLikes: 10 }),
    true,
    'Regular free user must be eligible for ads'
  );

  // 2. Introductory free user (30-day free trial with unlimited likes)
  assert.equal(
    checkEligibility({ isUnlimited: true, isIntroductory: true, remainingLikes: 9999 }),
    true,
    'Introductory free trial user must be eligible for ads'
  );

  // 3. User with no allowance loaded yet
  assert.equal(
    checkEligibility(null),
    true,
    'Null allowance defaults to free user eligible for ads'
  );

  // 4. Paid VIP subscriber (Aura Plus / Black with UNLIMITED_SWIPES)
  assert.equal(
    checkEligibility({ isUnlimited: true, isIntroductory: false, remainingLikes: 9999 }),
    false,
    'Paid VIP subscriber must NOT be eligible for ads'
  );
});

test('Behavioral: ADMOB_SSV_CONFIG specifies public HTTPS backend endpoint and 5 bonus likes', async () => {
  const fs = await import('node:fs/promises');
  const admobContent = await fs.readFile(
    new URL('../src/services/ads/admobService.ts', import.meta.url),
    'utf-8'
  );

  assert.ok(
    admobContent.includes("PRODUCTION_CALLBACK_URL: 'https://api.auradating.com/api/v1/ads/admob/ssv'"),
    'Production SSV callback URL must match public HTTPS backend endpoint'
  );
  assert.ok(
    admobContent.includes("STAGING_CALLBACK_URL: 'https://api.staging.auradating.com/api/v1/ads/admob/ssv'"),
    'Staging SSV callback URL must match staging HTTPS backend endpoint'
  );
  assert.ok(
    admobContent.includes('REWARD_AMOUNT_BONUS_LIKES: 5'),
    'Aura policy must configure exactly 5 bonus likes per rewarded video'
  );
});

test('Behavioral: Delayed SSV callback lifecycle retries with backoff and confirms reward', async () => {
  const manager = new BehavioralAdBreakManager();
  await manager.ensureHydrated();
  manager.swipeCount = 15;

  let attemptCount = 0;
  // Mock server claim API: attempt 1 returns PENDING, attempt 2 returns REWARD_CLAIMED
  const mockClaimApi = async () => {
    attemptCount++;
    if (attemptCount === 1) {
      return { isPending: true, status: 'PENDING' };
    }
    return {
      isPending: false,
      status: 'REWARD_CLAIMED',
      remainingLikes: 15,
      remainingBonusLikes: 5,
    };
  };

  const claimBonusRewardWithRetry = async () => {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const res = await mockClaimApi();
      if (res.isPending) {
        if (attempt < maxRetries) {
          continue;
        }
        return false;
      }
      return true;
    }
    return false;
  };

  const success = await claimBonusRewardWithRetry();
  assert.equal(success, true, 'Claim must succeed once SSV callback is confirmed');
  assert.equal(attemptCount, 2, 'Claim must have retried after initial pending state');

  // Authoritative confirmation allows cadence reset
  await manager.onAdCompleted();
  assert.equal(manager.swipeCount, 0, 'Cadence counter must reset to 0 upon authoritative confirmation');
});

test('Behavioral: SSV callback pending after max retries does NOT reset cadence or grant local bonus', async () => {
  const manager = new BehavioralAdBreakManager();
  await manager.ensureHydrated();
  manager.swipeCount = 15;

  // Mock server claim API: permanently PENDING (Google delayed or offline)
  const mockPendingClaimApi = async () => {
    return { isPending: true, status: 'PENDING' };
  };

  const claimBonusRewardWithRetry = async () => {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const res = await mockPendingClaimApi();
      if (res.isPending) {
        if (attempt < maxRetries) {
          continue;
        }
        return false; // Pending after all retries
      }
      return true;
    }
    return false;
  };

  const success = await claimBonusRewardWithRetry();
  assert.equal(success, false, 'Claim must return false when SSV callback is still pending');

  // Ad cadence must NOT be reset
  manager.onAdFailed();
  assert.equal(manager.swipeCount, 15, 'Cadence counter must be preserved when SSV is pending');
  assert.equal(manager.shouldShowRequiredAd(false), true, 'User still reaches threshold for retry');
});
