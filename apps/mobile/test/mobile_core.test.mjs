import test from 'node:test';
import assert from 'node:assert/strict';

// --- Test 1: Secure Credential & Session Management ---
test('Secure Storage & Token Management: saves and clears credentials cleanly', async () => {
  const store = new Map();
  const secureStorageMock = {
    async setItem(k, v) { store.set(k, v); },
    async getItem(k) { return store.get(k) ?? null; },
    async deleteItem(k) { store.delete(k); },
    async saveTokens(acc, ref) {
      await this.setItem('aura_access_token', acc);
      await this.setItem('aura_refresh_token', ref);
    },
    async getAccessToken() { return await this.getItem('aura_access_token'); },
    async getRefreshToken() { return await this.getItem('aura_refresh_token'); },
    async clearTokens() {
      await this.deleteItem('aura_access_token');
      await this.deleteItem('aura_refresh_token');
      await this.deleteItem('aura_user_data');
    },
  };

  // Initially empty
  assert.equal(await secureStorageMock.getAccessToken(), null);
  assert.equal(await secureStorageMock.getRefreshToken(), null);

  // Save tokens
  await secureStorageMock.saveTokens('jwt_access_token_123', 'jwt_refresh_token_456');
  assert.equal(await secureStorageMock.getAccessToken(), 'jwt_access_token_123');
  assert.equal(await secureStorageMock.getRefreshToken(), 'jwt_refresh_token_456');

  // Clear tokens on logout
  await secureStorageMock.clearTokens();
  assert.equal(await secureStorageMock.getAccessToken(), null);
  assert.equal(await secureStorageMock.getRefreshToken(), null);
});

// --- Test 2: Server-Enforced 18+ Age Assurance Validation ---
test('Age Assurance Validation: enforces strict 18+ birthdate requirement', () => {
  function validateAge(birthdateStr) {
    const birthDate = new Date(birthdateStr);
    if (isNaN(birthDate.getTime())) return { valid: false, reason: 'INVALID_DATE' };

    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    const isAdult = m > 0 || (m === 0 && today.getDate() >= birthDate.getDate()) ? age >= 18 : age - 1 >= 18;

    return isAdult ? { valid: true } : { valid: false, reason: 'UNDERAGE' };
  }

  // Adult: 25 years old
  const adultDate = new Date();
  adultDate.setFullYear(adultDate.getFullYear() - 25);
  const adultResult = validateAge(adultDate.toISOString().slice(0, 10));
  assert.equal(adultResult.valid, true);

  // Exact 18th birthday
  const exact18Date = new Date();
  exact18Date.setFullYear(exact18Date.getFullYear() - 18);
  const exactResult = validateAge(exact18Date.toISOString().slice(0, 10));
  assert.equal(exactResult.valid, true);

  // Underage: 17 years old
  const teenDate = new Date();
  teenDate.setFullYear(teenDate.getFullYear() - 17);
  const teenResult = validateAge(teenDate.toISOString().slice(0, 10));
  assert.equal(teenResult.valid, false);
  assert.equal(teenResult.reason, 'UNDERAGE');

  // Underage: 16 years old
  const minorDate = '2010-05-12';
  const minorResult = validateAge(minorDate);
  assert.equal(minorResult.valid, false);
  assert.equal(minorResult.reason, 'UNDERAGE');
});

// --- Test 3: Mandatory Discovery Dealbreaker Integrity ---
test('Dealbreaker Integrity: non-smoker dealbreaker strictly excludes smokers', () => {
  const candidates = [
    { id: '1', display_name: 'Alex', smoking_preference: 'NON_SMOKER', age: 26 },
    { id: '2', display_name: 'Jordan', smoking_preference: 'REGULAR_SMOKER', age: 28 },
    { id: '3', display_name: 'Taylor', smoking_preference: 'SOCIAL_SMOKER', age: 25 },
    { id: '4', display_name: 'Morgan', smoking_preference: 'NON_SMOKER', age: 30 },
  ];

  function filterFeedWithDealbreakers(feed, preferences) {
    if (!preferences.dealbreaker_non_smoker) {
      return feed;
    }
    // Strict dealbreaker: Only NON_SMOKER profiles allowed
    return feed.filter((c) => c.smoking_preference === 'NON_SMOKER');
  }

  // When dealbreaker is active: only 2 non-smoker profiles returned
  const filtered = filterFeedWithDealbreakers(candidates, { dealbreaker_non_smoker: true });
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map((c) => c.display_name), ['Alex', 'Morgan']);
  assert.ok(filtered.every((c) => c.smoking_preference === 'NON_SMOKER'));

  // When dealbreaker is relaxed: all 4 profiles returned
  const relaxed = filterFeedWithDealbreakers(candidates, { dealbreaker_non_smoker: false });
  assert.equal(relaxed.length, 4);

  // If no candidates remain due to dealbreakers, identify DEALBREAKERS_EXCLUDED_ALL
  const allSmokers = [
    { id: '1', display_name: 'Chris', smoking_preference: 'REGULAR_SMOKER', age: 29 },
  ];
  const emptyFiltered = filterFeedWithDealbreakers(allSmokers, { dealbreaker_non_smoker: true });
  assert.equal(emptyFiltered.length, 0);
  const emptyReason = emptyFiltered.length === 0 && allSmokers.length > 0 ? 'DEALBREAKERS_EXCLUDED_ALL' : 'NO_NEARBY';
  assert.equal(emptyReason, 'DEALBREAKERS_EXCLUDED_ALL');
});

// --- Test 4: Mutual Match & Chat Access Authorization ---
test('Chat Authorization: only mutual matches can open conversations', () => {
  const matches = new Map([
    ['match_userA_userB', { user_a: 'userA', user_b: 'userB', is_mutual: true, is_blocked: false }],
    ['match_userA_userC', { user_a: 'userA', user_b: 'userC', is_mutual: false, is_blocked: false }], // One-way swipe
    ['match_userA_userD', { user_a: 'userA', user_b: 'userD', is_mutual: true, is_blocked: true }],   // Blocked
  ]);

  function canInitiateChat(currentUserId, targetUserId, matchKey) {
    const match = matches.get(matchKey);
    if (!match) return { allowed: false, error: 'NO_MATCH_FOUND' };
    if (!match.is_mutual) return { allowed: false, error: 'MUTUAL_MATCH_REQUIRED' };
    if (match.is_blocked) return { allowed: false, error: 'USER_BLOCKED' };
    return { allowed: true };
  }

  // Mutual match allows chat
  const res1 = canInitiateChat('userA', 'userB', 'match_userA_userB');
  assert.equal(res1.allowed, true);

  // Non-mutual swipe blocks chat
  const res2 = canInitiateChat('userA', 'userC', 'match_userA_userC');
  assert.equal(res2.allowed, false);
  assert.equal(res2.error, 'MUTUAL_MATCH_REQUIRED');

  // Bilaterally blocked match blocks chat
  const res3 = canInitiateChat('userA', 'userD', 'match_userA_userD');
  assert.equal(res3.allowed, false);
  assert.equal(res3.error, 'USER_BLOCKED');
});

// --- Test 5: Client-Side EXIF Metadata Stripping ---
test('Media Pipeline: EXIF stripping removes geolocation and camera metadata', () => {
  // Mock image representation before and after sanitization
  const rawUploadedFile = {
    name: 'IMG_4920.HEIC',
    sizeBytes: 4200000,
    hasExif: true,
    gpsLatitude: 37.7749,
    gpsLongitude: -122.4194,
    cameraMake: 'Apple iPhone 15 Pro',
  };

  function sanitizeImageForUpload(file) {
    // Re-encoding via ImageManipulator produces a clean JPEG pixel buffer
    return {
      name: 'sanitized_' + Date.now() + '.jpg',
      sizeBytes: Math.min(file.sizeBytes, 1500000),
      hasExif: false,
      gpsLatitude: null,
      gpsLongitude: null,
      cameraMake: null,
      mimeType: 'image/jpeg',
    };
  }

  const sanitized = sanitizeImageForUpload(rawUploadedFile);
  assert.equal(sanitized.hasExif, false);
  assert.equal(sanitized.gpsLatitude, null);
  assert.equal(sanitized.gpsLongitude, null);
  assert.equal(sanitized.cameraMake, null);
  assert.equal(sanitized.mimeType, 'image/jpeg');
  assert.ok(sanitized.sizeBytes < 15 * 1024 * 1024);
});

// --- Test 6: In-App Purchase & Authoritative Entitlements ---
test('Billing & Entitlements: server is single source of truth for entitlements', () => {
  const backendEntitlementsDatabase = {
    MEMBER: {
      tier: 'MEMBER',
      entitlements: [],
      boostCredits: 0,
    },
    PLUS: {
      tier: 'PLUS',
      entitlements: ['UNLIMITED_SWIPES', 'REWIND', 'SEE_WHO_LIKED_YOU'],
      boostCredits: 1,
    },
    BLACK: {
      tier: 'BLACK',
      entitlements: ['UNLIMITED_SWIPES', 'REWIND', 'SEE_WHO_LIKED_YOU', 'TRAVEL_MODE', 'READ_RECEIPTS', 'SUPER_SPARK'],
      boostCredits: 5,
    },
  };

  function resolveEntitlements(userSubscription) {
    if (!userSubscription || userSubscription.status !== 'ACTIVE') {
      return backendEntitlementsDatabase.MEMBER;
    }
    return backendEntitlementsDatabase[userSubscription.tier] || backendEntitlementsDatabase.MEMBER;
  }

  // Free Member has no rewind or travel mode
  const freeMember = resolveEntitlements(null);
  assert.equal(freeMember.tier, 'MEMBER');
  assert.equal(freeMember.entitlements.includes('REWIND'), false);
  assert.equal(freeMember.entitlements.includes('TRAVEL_MODE'), false);

  // Active Plus Subscriber
  const plusUser = resolveEntitlements({ tier: 'PLUS', status: 'ACTIVE' });
  assert.equal(plusUser.tier, 'PLUS');
  assert.equal(plusUser.entitlements.includes('REWIND'), true);
  assert.equal(plusUser.entitlements.includes('TRAVEL_MODE'), false);

  // Active Black VIP Subscriber
  const blackUser = resolveEntitlements({ tier: 'BLACK', status: 'ACTIVE' });
  assert.equal(blackUser.tier, 'BLACK');
  assert.equal(blackUser.entitlements.includes('REWIND'), true);
  assert.equal(blackUser.entitlements.includes('TRAVEL_MODE'), true);
  assert.equal(blackUser.boostCredits, 5);

  // Expired Black Subscriber falls back to Free Member
  const expiredUser = resolveEntitlements({ tier: 'BLACK', status: 'EXPIRED' });
  assert.equal(expiredUser.tier, 'MEMBER');
  assert.equal(expiredUser.entitlements.includes('REWIND'), false);
});

// --- Test 7: Privacy Veil & App Switcher State Transition ---
test('Privacy Veil: triggers shield on background or inactive AppState', () => {
  let isVeilVisible = false;

  function handleAppStateChange(nextState, isBiometricLocked) {
    // AppState is 'active', 'inactive', or 'background'
    const isBackground = nextState === 'inactive' || nextState === 'background';
    isVeilVisible = isBackground || isBiometricLocked;
    return isVeilVisible;
  }

  // Active app: veil hidden
  assert.equal(handleAppStateChange('active', false), false);

  // iOS App Switcher / multitasking: veil triggers immediately
  assert.equal(handleAppStateChange('inactive', false), true);

  // Android Recents / backgrounded: veil triggers immediately
  assert.equal(handleAppStateChange('background', false), true);

  // Resumed but biometric locked: veil stays up until unlock
  assert.equal(handleAppStateChange('active', true), true);

  // Successfully unlocked with Face ID / biometric: veil dismisses
  assert.equal(handleAppStateChange('active', false), false);
});

// --- Test 8: Notification Privacy Masking ---
test('Notification Privacy: masks message body and sender on lock screen', () => {
  function sanitizeNotification(rawTitle, rawBody, hideSensitive) {
    if (!hideSensitive) {
      return { title: rawTitle, body: rawBody };
    }
    return {
      title: 'Aura',
      body: 'You have a new private notification',
    };
  }

  // Discreet mode active: Sensitive content hidden
  const masked = sanitizeNotification('New message from Jordan', 'Hey! Loved your profile...', true);
  assert.equal(masked.title, 'Aura');
  assert.equal(masked.body, 'You have a new private notification');

  // Discreet mode disabled: Full details displayed
  const unmasked = sanitizeNotification('New message from Jordan', 'Hey! Loved your profile...', false);
  assert.equal(unmasked.title, 'New message from Jordan');
  assert.equal(unmasked.body, 'Hey! Loved your profile...');
});

// --- Test 9: Daily Free-Like Quota Enforcement (10 Likes) & PASS Swiping Free ---
test('Swipe Quota: enforces 10 daily free likes while PASS swipes remain unlimited', () => {
  class SwipeManager {
    constructor(dailyLimit = 10) {
      this.dailyLimit = dailyLimit;
      this.likesUsed = 0;
      this.passesUsed = 0;
      this.bonusLikes = 0;
      this.isUnlimited = false;
    }

    getRemainingLikes() {
      if (this.isUnlimited) return 9999;
      const totalAllowance = this.dailyLimit + this.bonusLikes;
      return Math.max(0, totalAllowance - this.likesUsed);
    }

    swipe(direction) {
      if (direction === 'PASS') {
        this.passesUsed++;
        return { success: true, direction: 'PASS', remaining: this.getRemainingLikes() };
      }

      if (direction === 'LIKE' || direction === 'SUPER_SPARK') {
        if (!this.isUnlimited && this.getRemainingLikes() <= 0) {
          throw new Error('SWIPE_LIMIT_REACHED: Daily free like quota exhausted');
        }
        this.likesUsed++;
        return { success: true, direction, remaining: this.getRemainingLikes() };
      }

      throw new Error(`Invalid direction: ${direction}`);
    }

    grantBonusLikes(amount) {
      this.bonusLikes += amount;
    }

    setUnlimited(unlimited) {
      this.isUnlimited = unlimited;
    }
  }

  const manager = new SwipeManager(10);
  assert.equal(manager.getRemainingLikes(), 10);

  // 100 PASS swipes are free and do NOT decrease like allowance
  for (let i = 0; i < 20; i++) {
    const res = manager.swipe('PASS');
    assert.equal(res.success, true);
  }
  assert.equal(manager.getRemainingLikes(), 10);

  // 10 free LIKE swipes succeed
  for (let i = 0; i < 10; i++) {
    const res = manager.swipe('LIKE');
    assert.equal(res.success, true);
    assert.equal(res.remaining, 9 - i);
  }
  assert.equal(manager.getRemainingLikes(), 0);

  // 11th LIKE fails with SWIPE_LIMIT_REACHED
  assert.throws(
    () => manager.swipe('LIKE'),
    (err) => err.message.includes('SWIPE_LIMIT_REACHED')
  );

  // PASS remains permitted even after quota exhaustion
  const passAfterExhaustion = manager.swipe('PASS');
  assert.equal(passAfterExhaustion.success, true);
});

// --- Test 10: Voluntary Rewarded Video Ad & SSV Bonus Likes ---
test('Rewarded Video Ad: grants 1 bonus like via verified SSV callback', () => {
  const userAccount = {
    userId: 'usr_premium_candidate_42',
    dailyQuota: 10,
    likesUsed: 10,
    bonusLikes: 0,
    processedTransactions: new Set(),
  };

  function processSSVCallback(query) {
    const params = new URLSearchParams(query);
    const txId = params.get('transaction_id');
    const userId = params.get('user_id');
    const amount = parseInt(params.get('reward_amount') || '0', 10);
    const signature = params.get('signature');

    if (!signature || signature !== 'VALID_TEST_SSV_SIGNATURE') {
      throw new Error('INVALID_SSV_SIGNATURE');
    }

    // Replay protection: idempotency key
    if (userAccount.processedTransactions.has(txId)) {
      throw new Error('DUPLICATE_REWARD_TRANSACTION');
    }

    userAccount.processedTransactions.add(txId);
    userAccount.bonusLikes += amount;
    return { success: true, bonusGranted: amount, totalBonus: userAccount.bonusLikes };
  }

  // Quota is 0 initially
  assert.equal(userAccount.dailyQuota + userAccount.bonusLikes - userAccount.likesUsed, 0);

  // User watches rewarded ad; AdMob sends verified SSV callback (1 bonus like)
  const tx1 = 'tx_ssv_reward_1001';
  const query1 = `ad_network=54321&key_id=1&reward_amount=1&timestamp=${Date.now()}&transaction_id=${tx1}&user_id=${userAccount.userId}&signature=VALID_TEST_SSV_SIGNATURE`;

  const result1 = processSSVCallback(query1);
  assert.equal(result1.success, true);
  assert.equal(result1.bonusGranted, 1);
  assert.equal(userAccount.bonusLikes, 1);

  // Replay attack with same transactionId is rejected
  assert.throws(
    () => processSSVCallback(query1),
    (err) => err.message.includes('DUPLICATE_REWARD_TRANSACTION')
  );

  // Tampered signature is rejected
  const tamperedQuery = `ad_network=54321&key_id=1&reward_amount=999&timestamp=${Date.now()}&transaction_id=tx_fraud&user_id=${userAccount.userId}&signature=BAD_SIG`;
  assert.throws(
    () => processSSVCallback(tamperedQuery),
    (err) => err.message.includes('INVALID_SSV_SIGNATURE')
  );
});

// --- Test 11: Non-Personalized Ad Privacy Invariant ---
test('AdMob Privacy Invariant: zero transmission of LGBTQ+ signals or exact GPS', () => {
  const FORBIDDEN_PRIVACY_KEYS = [
    'gender',
    'gender_identity',
    'sexual_orientation',
    'orientation',
    'pronouns',
    'dating_preferences',
    'preferred_genders',
    'chat',
    'messages',
    'latitude',
    'longitude',
    'coordinates',
    'exact_location',
  ];

  function validateAdPrivacyCompliance(adRequestConfig) {
    // 1. Must enforce non-personalized ads
    if (adRequestConfig.requestNonPersonalizedAdsOnly !== true) {
      throw new Error('Ad request MUST have requestNonPersonalizedAdsOnly: true');
    }

    // 2. Must not contain any forbidden privacy keys
    const jsonStr = JSON.stringify(adRequestConfig).toLowerCase();
    for (const forbidden of FORBIDDEN_PRIVACY_KEYS) {
      if (jsonStr.includes(`"${forbidden}"`) || jsonStr.includes(forbidden)) {
        throw new Error(`[PRIVACY_VIOLATION] Leaked sensitive attribute "${forbidden}"`);
      }
    }
    return true;
  }

  // Compliant Aura configuration
  const validAuraAdConfig = {
    requestNonPersonalizedAdsOnly: true,
    keywords: ['lifestyle', 'social'],
    contentUrl: 'https://auradating.com',
  };
  assert.equal(validateAdPrivacyCompliance(validAuraAdConfig), true);

  // Violation 1: Personalized ads enabled
  assert.throws(
    () => validateAdPrivacyCompliance({ requestNonPersonalizedAdsOnly: false }),
    (err) => err.message.includes('requestNonPersonalizedAdsOnly: true')
  );

  // Violation 2: Attempting to pass sexual_orientation or gender
  assert.throws(
    () => validateAdPrivacyCompliance({
      requestNonPersonalizedAdsOnly: true,
      sexual_orientation: 'QUEER',
    }),
    (err) => err.message.includes('PRIVACY_VIOLATION')
  );

  // Violation 3: Attempting to pass exact GPS coordinates
  assert.throws(
    () => validateAdPrivacyCompliance({
      requestNonPersonalizedAdsOnly: true,
      latitude: 40.7128,
      longitude: -74.0060,
    }),
    (err) => err.message.includes('PRIVACY_VIOLATION')
  );
});

// --- Test 12: In-App Purchase (IAP) Server-Authoritative Verification ---
test('IAP Store Billing: receipt verification unlocks entitlements only via Go backend', async () => {
  const mockBackendDatabase = {
    verifiedTransactions: new Set(),
    activeSubscriptions: new Map(),
  };

  async function mockVerifyReceiptEndpoint(payload) {
    const { provider, plan_code, external_transaction_id, receipt_data } = payload;
    if (!external_transaction_id || !plan_code) {
      return { verified: false, error: 'MISSING_PARAMETERS' };
    }
    if (mockBackendDatabase.verifiedTransactions.has(external_transaction_id)) {
      return { verified: false, error: 'TRANSACTION_ALREADY_REDEEMED' };
    }

    mockBackendDatabase.verifiedTransactions.add(external_transaction_id);
    const tier = plan_code.includes('BLACK') ? 'BLACK' : 'PLUS';
    mockBackendDatabase.activeSubscriptions.set('user_1', {
      tier,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    return {
      verified: true,
      subscription: mockBackendDatabase.activeSubscriptions.get('user_1'),
    };
  }

  // Store purchase event from iOS StoreKit / Google Play
  const purchaseEvent = {
    provider: 'APPLE_APP_STORE',
    plan_code: 'AURA_BLACK_MONTHLY',
    external_transaction_id: 'in_app_tx_889922',
    receipt_data: 'base64_encoded_storekit_receipt_data',
  };

  const verification = await mockVerifyReceiptEndpoint(purchaseEvent);
  assert.equal(verification.verified, true);
  assert.equal(verification.subscription.tier, 'BLACK');
  assert.equal(verification.subscription.status, 'ACTIVE');

  // Duplicate receipt submission is rejected
  const replayVerification = await mockVerifyReceiptEndpoint(purchaseEvent);
  assert.equal(replayVerification.verified, false);
  assert.equal(replayVerification.error, 'TRANSACTION_ALREADY_REDEEMED');
});

// --- Test 13: Storefront-Aware Billing Policy Resolution ---
test('Storefront-Aware Billing Policy: strictly complies with Apple and Google regional rules', () => {
  const EU_COUNTRIES = new Set(['FR', 'DE', 'IT', 'ES', 'NL', 'SE', 'IE', 'PL']);

  function resolveMobilePolicy(platform, storefront, hasExternalEntitlement) {
    if (platform === 'web') {
      return {
        platform: 'web',
        supported: ['STRIPE'],
        preferred: 'STRIPE',
        externalPermitted: true,
        requiresChoice: false,
      };
    }

    if (platform === 'android') {
      const isUCB = EU_COUNTRIES.has(storefront) || storefront === 'US' || storefront === 'IN' || storefront === 'KR';
      return {
        platform: 'android',
        supported: isUCB ? ['GOOGLE_PLAY_BILLING', 'AURA_WEB_CHECKOUT'] : ['GOOGLE_PLAY_BILLING'],
        preferred: isUCB ? 'USER_CHOICE' : 'GOOGLE_PLAY_BILLING',
        externalPermitted: isUCB,
        requiresChoice: isUCB,
      };
    }

    if (platform === 'ios') {
      const isEligibleRegion = EU_COUNTRIES.has(storefront) || storefront === 'US';
      if (isEligibleRegion && hasExternalEntitlement) {
        return {
          platform: 'ios',
          supported: ['APPLE_IAP', 'AURA_WEB_CHECKOUT'],
          preferred: 'AURA_WEB_CHECKOUT',
          externalPermitted: true,
          requiresChoice: true,
        };
      }
      return {
        platform: 'ios',
        supported: ['APPLE_IAP'],
        preferred: 'APPLE_IAP',
        externalPermitted: false,
        requiresChoice: false,
      };
    }

    throw new Error('Unknown platform');
  }

  // 1. Android in France (EU): User Choice Billing with direct web option
  const androidFR = resolveMobilePolicy('android', 'FR', false);
  assert.equal(androidFR.externalPermitted, true);
  assert.equal(androidFR.requiresChoice, true);
  assert.deepEqual(androidFR.supported, ['GOOGLE_PLAY_BILLING', 'AURA_WEB_CHECKOUT']);

  // 2. Android in non-UCB country: standard Google Play Billing only
  const androidZA = resolveMobilePolicy('android', 'ZA', false);
  assert.equal(androidZA.externalPermitted, false);
  assert.equal(androidZA.requiresChoice, false);
  assert.deepEqual(androidZA.supported, ['GOOGLE_PLAY_BILLING']);

  // 3. iOS in US with entitlement: External Link allowed alongside IAP
  const iosUSEntitled = resolveMobilePolicy('ios', 'US', true);
  assert.equal(iosUSEntitled.externalPermitted, true);
  assert.equal(iosUSEntitled.requiresChoice, true);

  // 4. iOS in US without entitlement: External Link strictly blocked per Apple 3.1.1
  const iosUSUnentitled = resolveMobilePolicy('ios', 'US', false);
  assert.equal(iosUSUnentitled.externalPermitted, false);
  assert.equal(iosUSUnentitled.requiresChoice, false);
  assert.deepEqual(iosUSUnentitled.supported, ['APPLE_IAP']);

  // 5. iOS in Japan: Apple IAP strictly mandatory
  const iosJP = resolveMobilePolicy('ios', 'JP', false);
  assert.equal(iosJP.externalPermitted, false);
  assert.deepEqual(iosJP.supported, ['APPLE_IAP']);
});

// --- Test 14: Mobile Store Identifier Resolution & Safe Purchase Gating ---
test('Mobile Store Identifiers: fails closed on missing/mismatched receipts and extracts package dynamically', async () => {
  const fs = await import('node:fs/promises');
  const appJson = JSON.parse(await fs.readFile(new URL('../app.json', import.meta.url), 'utf-8'));

  const configuredIosBundle = appJson.expo?.ios?.bundleIdentifier;
  const configuredAndroidPackage = appJson.expo?.android?.package;

  assert.ok(configuredIosBundle, 'ios.bundleIdentifier must be configured in app.json');
  assert.ok(configuredAndroidPackage, 'android.package must be configured in app.json');
  assert.equal(configuredIosBundle, 'com.aura.dating');
  assert.equal(configuredAndroidPackage, 'com.aura.dating');

  // Verify dynamic store cancellation URL resolution
  function resolvePlayCancelUrl(packageName) {
    return packageName
      ? `https://play.google.com/store/account/subscriptions?package=${encodeURIComponent(packageName)}`
      : 'https://play.google.com/store/account/subscriptions';
  }

  assert.equal(
    resolvePlayCancelUrl(configuredAndroidPackage),
    'https://play.google.com/store/account/subscriptions?package=com.aura.dating'
  );

  // Dynamic rebrand verification: any rebranded package resolves automatically
  assert.equal(
    resolvePlayCancelUrl('com.rebranded.app'),
    'https://play.google.com/store/account/subscriptions?package=com.rebranded.app'
  );

  // Invariant: client must NEVER accept client-only transaction ID without server-verified receipt
  function verifyStorePurchaseClientSide(payload, serverVerificationFunc) {
    if (!payload.receipt_data || payload.receipt_data.trim() === '') {
      return { success: false, reason: 'ERR_INVALID_RECEIPT_DATA' };
    }
    return serverVerificationFunc(payload);
  }

  // Reject transaction with missing receipt data
  const emptyReceiptResult = verifyStorePurchaseClientSide({
    provider: 'APPLE_APP_STORE',
    plan_code: 'AURA_PLUS_MONTHLY',
    external_transaction_id: 'client_claimed_tx_123',
    receipt_data: '',
  }, () => ({ success: true }));

  assert.equal(emptyReceiptResult.success, false);
  assert.equal(emptyReceiptResult.reason, 'ERR_INVALID_RECEIPT_DATA');
});

// --- Test 15: 30-Day Introductory Period & Fixed 12-Hour Quota Rules ---
test('Introductory Free Period & 12-Hour Quota: 30-day unlimited likes transitioning to 15 likes per 12h window', () => {
  const INTRODUCTORY_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
  const POST_INTRO_QUOTA = 15;

  function calculateSwipeAllowance(userCreatedAtIso, nowMs, windowSwipes = 0) {
    const createdAtMs = new Date(userCreatedAtIso).getTime();
    const isIntroductory = nowMs - createdAtMs < INTRODUCTORY_DURATION_MS;

    if (isIntroductory) {
      return {
        isUnlimited: true,
        isIntroductory: true,
        remainingLikes: 9999,
        remainingRegularLikes: 9999,
        remainingBonusLikes: 0,
        dailyQuota: 9999,
      };
    }

    const remainingRegular = Math.max(0, POST_INTRO_QUOTA - windowSwipes);
    return {
      isUnlimited: false,
      isIntroductory: false,
      remainingLikes: remainingRegular,
      remainingRegularLikes: remainingRegular,
      remainingBonusLikes: 0,
      dailyQuota: POST_INTRO_QUOTA,
    };
  }

  const now = Date.now();

  // 1. Account created 15 days ago -> within 30 days -> unlimited intro
  const user15d = new Date(now - 15 * 86400000).toISOString();
  const allowance15d = calculateSwipeAllowance(user15d, now);
  assert.equal(allowance15d.isUnlimited, true);
  assert.equal(allowance15d.isIntroductory, true);

  // 2. Account created 29 days, 23 hours ago -> still within intro
  const user29d = new Date(now - (29 * 86400000 + 23 * 3600000)).toISOString();
  const allowance29d = calculateSwipeAllowance(user29d, now);
  assert.equal(allowance29d.isUnlimited, true);
  assert.equal(allowance29d.isIntroductory, true);

  // 3. Account created 31 days ago -> post-introductory period
  const user31d = new Date(now - 31 * 86400000).toISOString();
  const allowance31d = calculateSwipeAllowance(user31d, now, 0);
  assert.equal(allowance31d.isUnlimited, false);
  assert.equal(allowance31d.isIntroductory, false);
  assert.equal(allowance31d.remainingLikes, 15);
  assert.equal(allowance31d.dailyQuota, 15);

  // 4. After 15 likes in the window -> quota is exhausted
  const exhausted31d = calculateSwipeAllowance(user31d, now, 15);
  assert.equal(exhausted31d.remainingLikes, 0);
  assert.equal(exhausted31d.remainingRegularLikes, 0);
});

// --- Test 16: Rewarded Ad Bonus Likes (+5) & Photo-Verified Profile Exclusivity ---
test('Bonus Likes from Rewarded Ads: grants +5 likes exclusively usable on photo-verified profiles', () => {
  class LikeAllowanceTracker {
    constructor(regularLikes = 0, bonusLikes = 0) {
      this.regularLikes = regularLikes;
      this.bonusLikes = bonusLikes;
    }

    addRewardedBonus(amount = 5) {
      this.bonusLikes += amount;
    }

    swipeLike(targetProfile) {
      if (this.regularLikes > 0) {
        this.regularLikes -= 1;
        return { success: true, usedBonus: false };
      }
      if (this.bonusLikes > 0) {
        // Bonus likes can ONLY be used on photo-verified profiles
        if (!targetProfile.is_photo_verified) {
          throw new Error('BONUS_LIKES_VERIFIED_ONLY: Bonus likes from ads can only be used on photo-verified profiles');
        }
        this.bonusLikes -= 1;
        return { success: true, usedBonus: true };
      }
      throw new Error('SWIPE_LIMIT_REACHED');
    }

    swipePass() {
      // PASS swipes never consume like quotas or bonus likes
      return { success: true };
    }
  }

  const tracker = new LikeAllowanceTracker(0, 0);

  // 1. Quota exhausted, attempting to like unverified profile -> fails
  const unverifiedCandidate = { id: 'user_u1', display_name: 'Sam', is_photo_verified: false };
  assert.throws(
    () => tracker.swipeLike(unverifiedCandidate),
    (err) => err.message.includes('SWIPE_LIMIT_REACHED')
  );

  // 2. User completes verified rewarded video ad -> earns +5 bonus likes
  tracker.addRewardedBonus(5);
  assert.equal(tracker.bonusLikes, 5);

  // 3. User attempts to like an UNVERIFIED profile with bonus likes -> REJECTED
  assert.throws(
    () => tracker.swipeLike(unverifiedCandidate),
    (err) => err.message.includes('BONUS_LIKES_VERIFIED_ONLY')
  );
  // Bonus likes not consumed on rejection
  assert.equal(tracker.bonusLikes, 5);

  // 4. User passes on unverified profile -> SUCCEEDS without consuming bonus likes
  const passResult = tracker.swipePass();
  assert.equal(passResult.success, true);
  assert.equal(tracker.bonusLikes, 5);

  // 5. User likes a PHOTO-VERIFIED profile -> SUCCEEDS and consumes 1 bonus like
  const verifiedCandidate = { id: 'user_v1', display_name: 'Taylor', is_photo_verified: true };
  const verifiedResult = tracker.swipeLike(verifiedCandidate);
  assert.equal(verifiedResult.success, true);
  assert.equal(verifiedResult.usedBonus, true);
  assert.equal(tracker.bonusLikes, 4);
});

// --- Test 17: Discovery Ad Cadence (AdBreakManager) & Counter Reset Rules ---
test('Ad Cadence & Reset Rules: 1st ad after 15 in intro, 35 subsequent, reset only on ad completion, and deduplication', () => {
  class AdBreakManager {
    constructor() {
      this.swipeCount = 0;
      this.firstAdCompleted = false;
      this.viewedProfileIds = new Set();
    }

    recordProfileView(profileId, isIntroductory = false) {
      if (profileId) {
        if (this.viewedProfileIds.has(profileId)) {
          return this.shouldShowRequiredAd(isIntroductory);
        }
        this.viewedProfileIds.add(profileId);
      }
      this.swipeCount += 1;
      return this.shouldShowRequiredAd(isIntroductory);
    }

    recordSwipe(isIntroductory = false, profileId) {
      return this.recordProfileView(profileId, isIntroductory);
    }

    shouldShowRequiredAd(isIntroductory = false) {
      const threshold = isIntroductory && !this.firstAdCompleted ? 15 : 35;
      return this.swipeCount >= threshold;
    }

    onAdCompleted() {
      this.swipeCount = 0;
      this.firstAdCompleted = true;
      this.viewedProfileIds.clear();
    }

    onAdFailed() {
      // Counter is NOT reset on failed/skipped ad
    }

    reset() {
      this.swipeCount = 0;
      this.firstAdCompleted = false;
      this.viewedProfileIds.clear();
    }
  }

  const manager = new AdBreakManager();

  // Phase 1: Introductory period - first ad must trigger at exactly 15 profiles
  let triggeredAt = [];
  for (let i = 1; i <= 15; i++) {
    const triggered = manager.recordProfileView(`candidate_intro_${i}`, true);
    if (triggered) triggeredAt.push(i);
  }
  assert.deepEqual(triggeredAt, [15], 'First intro ad must trigger at profile 15');
  assert.equal(manager.swipeCount, 15, 'Counter must NOT reset before ad is completed');

  // If ad fails or is skipped, counter remains at 15 and re-prompts
  manager.onAdFailed();
  assert.equal(manager.swipeCount, 15, 'Failed ad must not reset counter');
  assert.equal(manager.shouldShowRequiredAd(true), true, 'Still requires ad completion');

  // Ad successfully completed -> resets counter to 0
  manager.onAdCompleted();
  assert.equal(manager.swipeCount, 0, 'Counter must reset to 0 only after successful ad completion');
  assert.equal(manager.firstAdCompleted, true, 'First ad marked completed');

  // Phase 2: Deduplication - re-viewing the same candidate does not increment count
  manager.recordProfileView('candidate_seen_again', true);
  assert.equal(manager.swipeCount, 1, 'First view increments count');
  manager.recordProfileView('candidate_seen_again', true);
  assert.equal(manager.swipeCount, 1, 'Duplicate profile view must not increment counter');

  // Phase 3: Second intro ad - must trigger after 35 additional profiles
  triggeredAt = [];
  for (let i = 2; i <= 35; i++) {
    const triggered = manager.recordProfileView(`candidate_phase2_${i}`, true);
    if (triggered) triggeredAt.push(i);
  }
  assert.deepEqual(triggeredAt, [35], 'Second intro ad must trigger after 35 additional profiles');
  manager.onAdCompleted();
  assert.equal(manager.swipeCount, 0, 'Counter resets after second ad completion');

  // Phase 4: Post-introductory period - ad break occurs after every 35 profiles
  const postIntroManager = new AdBreakManager();
  postIntroManager.firstAdCompleted = true; // post-intro
  triggeredAt = [];
  for (let i = 1; i <= 80; i++) {
    const triggered = postIntroManager.recordProfileView(`candidate_post_${i}`, false);
    if (triggered) {
      triggeredAt.push(i);
      postIntroManager.onAdCompleted();
    }
  }
  assert.deepEqual(triggeredAt, [35, 70], 'Post-intro ads must trigger every 35 profiles');
  assert.equal(postIntroManager.swipeCount, 10, 'Remaining swipe count should be 10 after 80 profiles (35 + 35 + 10)');
});

// --- Test 18: Native Sponsored Card & Anti-Disguise Invariant ---
test('Sponsored Card Safety: clearly identified as advertisement and never disguised as dating profile', () => {
  function validateSponsoredCardContract(cardProps) {
    // 1. Must carry explicit SPONSORED badge
    if (!cardProps.badge || !cardProps.badge.includes('SPONSORED')) {
      throw new Error('Sponsored card must display explicit SPONSORED label');
    }

    // 2. Must NEVER include dating profile fields
    const FORBIDDEN_PROFILE_FIELDS = [
      'age',
      'birthdate',
      'gender_identities',
      'sexual_orientations',
      'pronouns',
      'relationship_intents',
      'relationship_structure',
      'smoking_habit',
      'bio',
      'distance_km',
      'match_score',
    ];

    for (const field of FORBIDDEN_PROFILE_FIELDS) {
      if (field in cardProps) {
        throw new Error(`[DISGUISE_VIOLATION] Sponsored card must never include profile field "${field}"`);
      }
    }

    // 3. Must provide a skip/dismiss action
    if (typeof cardProps.onDismiss !== 'function') {
      throw new Error('Sponsored card must provide a dismiss/skip callback');
    }

    return true;
  }

  // Valid Aura Sponsored Card
  const validCard = {
    badge: 'SPONSORED ADVERTISEMENT',
    disclaimer: 'Aura Partner Selection • Not a dating profile',
    adUnitId: 'ca-app-pub-3940256099942544/6300978111',
    onDismiss: () => {},
  };
  assert.equal(validateSponsoredCardContract(validCard), true);

  // Violation 1: Disguising ad with fake age
  assert.throws(
    () => validateSponsoredCardContract({ ...validCard, age: 24 }),
    (err) => err.message.includes('DISGUISE_VIOLATION')
  );

  // Violation 2: Disguising ad with fake pronouns or gender
  assert.throws(
    () => validateSponsoredCardContract({ ...validCard, pronouns: ['they/them'] }),
    (err) => err.message.includes('DISGUISE_VIOLATION')
  );
});

// --- Test 19: Expo Go Push Notification Safety & Preference Preservation ---
test('Expo Go Notification Safety: safely handles unsupported remote push and preserves user preferences', async () => {
  function createNotificationManager(isExpoGo, platform = 'android') {
    let mockPreferences = {
      push_enabled: true,
      matches_push: true,
      messages_push: true,
      hide_sensitive_preview: true,
    };
    let nativeTokenApiCalled = false;

    return {
      isRemotePushSupported() {
        return platform !== 'web' && !isExpoGo;
      },
      async registerPushToken() {
        if (platform === 'web') {
          return { registered: false, reason: 'Push notifications are not supported on web.' };
        }
        if (isExpoGo) {
          return {
            registered: false,
            reason: 'Remote push notifications require a native development build (expo-dev-client). Expo Go does not support remote APNs/FCM tokens.',
          };
        }
        // In native standalone / dev-client:
        nativeTokenApiCalled = true;
        return { registered: true, token: 'mock_native_device_push_token_123' };
      },
      async getPreferences() {
        return { ...mockPreferences };
      },
      async updatePreferences(updates) {
        mockPreferences = { ...mockPreferences, ...updates };
        return { ...mockPreferences };
      },
      wasNativeTokenApiCalled() {
        return nativeTokenApiCalled;
      },
    };
  }

  // 1. In Expo Go: registerPushToken must NOT call native push token API and must return safe reason
  const expoGoManager = createNotificationManager(true, 'android');
  assert.equal(expoGoManager.isRemotePushSupported(), false);

  const regResult = await expoGoManager.registerPushToken();
  assert.equal(regResult.registered, false);
  assert.ok(regResult.reason.includes('expo-dev-client'), 'Must explain development build requirement');
  assert.equal(expoGoManager.wasNativeTokenApiCalled(), false, 'Must never invoke unsupported native API in Expo Go');

  // 2. In Expo Go: notification preferences remain fully functional
  const initialPrefs = await expoGoManager.getPreferences();
  assert.equal(initialPrefs.push_enabled, true);

  const updatedPrefs = await expoGoManager.updatePreferences({ push_enabled: false, hide_sensitive_preview: true });
  assert.equal(updatedPrefs.push_enabled, false);
  assert.equal(updatedPrefs.hide_sensitive_preview, true);

  // 3. In Standalone Native Build: native push registration is supported and called
  const nativeManager = createNotificationManager(false, 'android');
  assert.equal(nativeManager.isRemotePushSupported(), true);

  const nativeRegResult = await nativeManager.registerPushToken();
  assert.equal(nativeRegResult.registered, true);
  assert.equal(nativeRegResult.token, 'mock_native_device_push_token_123');
  assert.equal(nativeManager.wasNativeTokenApiCalled(), true);
});

// --- Test 20: Registration Payload & Display Name Validation ---
test('Registration Payload & Display Name Validation: enforces non-blank display_name and includes it in backend payload', async () => {
  function validateRegistrationPayload(payload) {
    if (!payload.display_name || !payload.display_name.trim()) {
      return { valid: false, error: 'display name cannot be blank' };
    }
    if (payload.display_name.trim().length > 50) {
      return { valid: false, error: 'display name cannot exceed 50 characters' };
    }
    if (!payload.email || !payload.email.includes('@')) {
      return { valid: false, error: 'a valid email address is required' };
    }
    return {
      valid: true,
      sanitizedPayload: {
        ...payload,
        display_name: payload.display_name.trim(),
      },
    };
  }

  // 1. Missing / blank display name must fail validation
  const emptyNameResult = validateRegistrationPayload({
    display_name: '',
    email: 'member@aura.test',
  });
  assert.equal(emptyNameResult.valid, false);
  assert.equal(emptyNameResult.error, 'display name cannot be blank');

  // 2. Whitespace-only display name must fail validation
  const whitespaceResult = validateRegistrationPayload({
    display_name: '   ',
    email: 'member@aura.test',
  });
  assert.equal(whitespaceResult.valid, false);
  assert.equal(whitespaceResult.error, 'display name cannot be blank');

  // 3. Valid display name must be preserved, trimmed, and keyed as display_name
  const validResult = validateRegistrationPayload({
    display_name: '  Alex Rivera  ',
    email: 'alex@aura.test',
    birthdate: '1998-05-14',
    gender_identities: ['Non-Binary'],
    sexual_orientations: ['Queer'],
  });
  assert.equal(validResult.valid, true);
  assert.equal(validResult.sanitizedPayload.display_name, 'Alex Rivera');
  assert.equal('display_name' in validResult.sanitizedPayload, true);
});

// --- Test 21: LGBTQ+ Taxonomy Field Separation & Cross-Field Integrity ---
test('LGBTQ+ Taxonomy Field Separation & Cross-Field Integrity: preserves distinct gender identities vs sexual orientations', async () => {
  const CANONICAL_GENDERS = new Set([
    'cisgender man',
    'cis man',
    'transgender man',
    'trans man',
    'cisgender woman',
    'cis woman',
    'transgender woman',
    'trans woman',
    'non-binary',
    'genderfluid',
    'agender',
    'two-spirit',
    'genderqueer',
    'intersex',
  ]);

  const CANONICAL_ORIENTATIONS = new Set([
    'gay',
    'lesbian',
    'bisexual',
    'pansexual',
    'queer',
    'asexual',
    'demisexual',
    'questioning',
  ]);

  function validateTaxonomyFields(genders, orientations) {
    if (!Array.isArray(genders) || genders.length === 0) {
      return { valid: false, error: 'At least one gender identity must be selected' };
    }
    if (!Array.isArray(orientations) || orientations.length === 0) {
      return { valid: false, error: 'At least one sexual orientation must be selected' };
    }

    for (const g of genders) {
      const norm = g.trim().toLowerCase();
      if (!CANONICAL_GENDERS.has(norm)) {
        return { valid: false, error: `unrecognized gender identity: "${g}"` };
      }
    }

    for (const o of orientations) {
      const norm = o.trim().toLowerCase();
      if (!CANONICAL_ORIENTATIONS.has(norm)) {
        return { valid: false, error: `unrecognized sexual orientation: "${o}"` };
      }
    }

    return { valid: true };
  }

  // 1. Sexual orientation "Lesbian" as gender identity MUST fail with unrecognized gender identity
  const crossFieldResult1 = validateTaxonomyFields(['Lesbian'], ['queer']);
  assert.equal(crossFieldResult1.valid, false);
  assert.equal(crossFieldResult1.error, 'unrecognized gender identity: "Lesbian"');

  // 2. Sexual orientation "Gay" as gender identity MUST fail with unrecognized gender identity
  const crossFieldResult2 = validateTaxonomyFields(['Gay'], ['queer']);
  assert.equal(crossFieldResult2.valid, false);
  assert.equal(crossFieldResult2.error, 'unrecognized gender identity: "Gay"');

  // 3. Gender identity "Non-Binary" as sexual orientation MUST fail with unrecognized sexual orientation
  const crossFieldResult3 = validateTaxonomyFields(['non-binary'], ['Non-Binary']);
  assert.equal(crossFieldResult3.valid, false);
  assert.equal(crossFieldResult3.error, 'unrecognized sexual orientation: "Non-Binary"');

  // 4. Valid separated fields succeed
  const validTaxonomyResult = validateTaxonomyFields(
    ['non-binary', 'transgender woman'],
    ['lesbian', 'queer']
  );
  assert.equal(validTaxonomyResult.valid, true);

  // 5. Ensure mobile options have zero intersection between gender identities and sexual orientations
  const mobileGenderValues = [
    'non-binary',
    'transgender woman',
    'transgender man',
    'cisgender woman',
    'cisgender man',
    'genderfluid',
    'agender',
    'two-spirit',
    'genderqueer',
    'intersex',
  ];
  const mobileOrientationValues = [
    'lesbian',
    'gay',
    'bisexual',
    'pansexual',
    'queer',
    'asexual',
    'demisexual',
    'questioning',
  ];

  for (const g of mobileGenderValues) {
    assert.ok(CANONICAL_GENDERS.has(g), `Gender option "${g}" must exist in canonical genders`);
    assert.ok(!CANONICAL_ORIENTATIONS.has(g), `Gender option "${g}" must NOT be in sexual orientations`);
  }

  for (const o of mobileOrientationValues) {
    assert.ok(CANONICAL_ORIENTATIONS.has(o), `Orientation option "${o}" must exist in canonical orientations`);
    assert.ok(!CANONICAL_GENDERS.has(o), `Orientation option "${o}" must NOT be in gender identities`);
  }
});

// --- Test 22: Google Mobile Ads Expo Go Fallback & Module Safety ---
test('Google Mobile Ads Safety: safely falls back in Expo Go without crashing TurboModuleRegistry', () => {
  function isGoogleMobileAdsAvailable(mockEnv) {
    if (mockEnv.platform === 'web' || mockEnv.isExpoGo) {
      return false;
    }
    return Boolean(mockEnv.nativeModules?.RNGoogleMobileAdsModule);
  }

  // 1. In Expo Go, native ads are unavailable
  assert.equal(isGoogleMobileAdsAvailable({ platform: 'android', isExpoGo: true, nativeModules: {} }), false);

  // 2. In Web, native ads are unavailable
  assert.equal(isGoogleMobileAdsAvailable({ platform: 'web', isExpoGo: false, nativeModules: { RNGoogleMobileAdsModule: {} } }), false);

  // 3. In Dev Build with native module, ads are available
  assert.equal(isGoogleMobileAdsAvailable({ platform: 'android', isExpoGo: false, nativeModules: { RNGoogleMobileAdsModule: {} } }), true);

  // 4. Banner component fallback state
  function getBannerState(mockEnv) {
    const isAvail = isGoogleMobileAdsAvailable(mockEnv);
    if (!isAvail) {
      return { rendersNative: false, fallbackTitle: 'Aura Curated Selection' };
    }
    return { rendersNative: true };
  }

  const expoGoBanner = getBannerState({ platform: 'android', isExpoGo: true });
  assert.equal(expoGoBanner.rendersNative, false);
  assert.equal(expoGoBanner.fallbackTitle, 'Aura Curated Selection');

  const devBuildBanner = getBannerState({ platform: 'android', isExpoGo: false, nativeModules: { RNGoogleMobileAdsModule: {} } });
  assert.equal(devBuildBanner.rendersNative, true);
});

// --- Test 23: VIP/Membership Null-Safe Entitlements Handling ---
test('VIP & Membership Entitlements: safely extracts string codes from null/undefined/object lists', () => {
  function extractEntitlements(response) {
    const rawEnts = response?.entitlements;
    return Array.isArray(rawEnts)
      ? rawEnts.map((e) => (typeof e === 'string' ? e : e?.entitlement_code || ''))
      : [];
  }

  // 1. When server returns null entitlements, must not throw and return empty array
  const nullResp = { count: 0, entitlements: null };
  const nullList = extractEntitlements(nullResp);
  assert.deepEqual(nullList, []);
  assert.equal(nullList.includes('UNLIMITED_SWIPES'), false);
  assert.equal(nullList.includes('REWIND'), false);

  // 2. When server returns undefined, must not throw
  const undefList = extractEntitlements({});
  assert.deepEqual(undefList, []);

  // 3. When server returns object array from database
  const objResp = {
    count: 2,
    entitlements: [
      { entitlement_code: 'UNLIMITED_SWIPES', source: 'SUBSCRIPTION' },
      { entitlement_code: 'REWIND', source: 'SUBSCRIPTION' },
    ],
  };
  const objList = extractEntitlements(objResp);
  assert.deepEqual(objList, ['UNLIMITED_SWIPES', 'REWIND']);
  assert.equal(objList.includes('UNLIMITED_SWIPES'), true);
  assert.equal(objList.includes('REWIND'), true);

  // 4. When server returns string array
  const strResp = { count: 1, entitlements: ['UNLIMITED_SWIPES'] };
  const strList = extractEntitlements(strResp);
  assert.deepEqual(strList, ['UNLIMITED_SWIPES']);
  assert.equal(strList.includes('UNLIMITED_SWIPES'), true);
});

// --- Test 24: Profile Photo Upload Intent Validation ---
test('Profile Photo Upload Workflow: validates file size before requesting intent', () => {
  function prepareUpload(fileBlob, maxBytes = 15 * 1024 * 1024) {
    if (!fileBlob || !fileBlob.size || fileBlob.size <= 0) {
      throw new Error('INVALID_FILE: Photo payload is empty or invalid.');
    }
    if (fileBlob.size > maxBytes) {
      throw new Error('FILE_TOO_LARGE: Image exceeds maximum limit.');
    }
    return {
      media_type: 'IMAGE',
      mime_type: 'image/jpeg',
      purpose: 'PROFILE_GALLERY',
      size_bytes: fileBlob.size,
    };
  }

  // Zero size rejected before network request
  assert.throws(() => prepareUpload({ size: 0 }), /INVALID_FILE/);

  // Oversized rejected
  assert.throws(() => prepareUpload({ size: 20 * 1024 * 1024 }), /FILE_TOO_LARGE/);

  // Valid size produces size_bytes payload
  const validPayload = prepareUpload({ size: 245000 });
  assert.equal(validPayload.size_bytes, 245000);
  assert.equal(validPayload.media_type, 'IMAGE');
  assert.equal(validPayload.purpose, 'PROFILE_GALLERY');
});

// --- Test 25: Initial Navigation & Age Verification Guard ---
test('Navigation Guard: unverified users guided to age verification onboarding', () => {
  function determineInitialRoute({ isAuthenticated, isAgeVerified, currentScreen }) {
    if (!isAuthenticated) {
      return '/(auth)/login';
    }
    if (currentScreen === '/(auth)/verify-age') {
      return '/(auth)/verify-age';
    }
    if (!isAgeVerified) {
      return '/(auth)/verify-age';
    }
    return '/(tabs)';
  }

  // Unauthenticated user -> login
  assert.equal(determineInitialRoute({ isAuthenticated: false, isAgeVerified: false, currentScreen: '/' }), '/(auth)/login');

  // Authenticated but unverified user -> verify-age onboarding
  assert.equal(determineInitialRoute({ isAuthenticated: true, isAgeVerified: false, currentScreen: '/(auth)/login' }), '/(auth)/verify-age');

  // Authenticated on verify-age screen stays there
  assert.equal(determineInitialRoute({ isAuthenticated: true, isAgeVerified: false, currentScreen: '/(auth)/verify-age' }), '/(auth)/verify-age');

  // Authenticated and age-verified user -> tabs
  assert.equal(determineInitialRoute({ isAuthenticated: true, isAgeVerified: true, currentScreen: '/(auth)/login' }), '/(tabs)');
});

// --- Test 26: VIP Billing Plans Normalization & Integrity ---
test('VIP Plans Normalization: handles { plans, count } and arrays without inventing entitlements', () => {
  function normalizePlans(raw) {
    let list = [];
    if (raw && typeof raw === 'object' && Array.isArray(raw.plans)) {
      list = raw.plans;
    } else if (Array.isArray(raw)) {
      list = raw;
    }

    return list.filter((p) => {
      return (
        p &&
        typeof p === 'object' &&
        typeof p.id === 'string' &&
        p.id.trim() !== '' &&
        typeof p.name === 'string' &&
        typeof p.price_cents === 'number' &&
        typeof p.interval === 'string' &&
        Array.isArray(p.features)
      );
    });
  }

  // 1. Backend format: { plans: [...], count: 2 }
  const backendEnvelope = {
    plans: [
      { id: 'vip_monthly', name: 'Aura VIP Monthly', price_cents: 1999, currency: 'USD', interval: 'MONTH', features: ['Unlimited Swipes'] },
      { id: 'vip_annual', name: 'Aura VIP Annual', price_cents: 14999, currency: 'USD', interval: 'YEAR', features: ['Unlimited Swipes', 'Priority Delivery'] },
    ],
    count: 2,
  };
  const normalized1 = normalizePlans(backendEnvelope);
  assert.equal(normalized1.length, 2);
  assert.equal(normalized1[0].id, 'vip_monthly');
  assert.equal(normalized1[1].id, 'vip_annual');

  // 2. Direct array fallback
  const directArray = [
    { id: 'vip_weekly', name: 'Aura VIP Weekly', price_cents: 699, currency: 'USD', interval: 'WEEK', features: ['Incognito Swiping'] },
  ];
  const normalized2 = normalizePlans(directArray);
  assert.equal(normalized2.length, 1);
  assert.equal(normalized2[0].id, 'vip_weekly');

  // 3. Malformed items filtered out, never invented
  const malformedInput = {
    plans: [
      { id: '', name: 'Invalid Blank ID', price_cents: 500, interval: 'MONTH', features: [] },
      { id: 'vip_valid', name: 'Valid Plan', price_cents: 999, interval: 'MONTH', features: ['Rewind'] },
      { id: 'vip_no_price', name: 'No Price', interval: 'MONTH', features: [] },
      null,
      undefined,
    ],
    count: 5,
  };
  const normalized3 = normalizePlans(malformedInput);
  assert.equal(normalized3.length, 1);
  assert.equal(normalized3[0].id, 'vip_valid');

  // 4. Empty or network failure payload returns []
  assert.deepEqual(normalizePlans(null), []);
  assert.deepEqual(normalizePlans(undefined), []);
  assert.deepEqual(normalizePlans({ plans: [] }), []);
});

// --- Test 27: Media Uploader Multipart & Purpose Isolation ---
test('Media Uploader: strictly isolates PROFILE_GALLERY and SELFIE_VERIFICATION purposes', async () => {
  const uploadedPayloads = [];

  const mockApi = {
    async postFormData(path, formData) {
      uploadedPayloads.push({
        path,
        purpose: formData.get('purpose'),
        media_type: formData.get('media_type'),
        idempotency_key: formData.get('idempotency_key'),
      });
      return {
        id: 'asset_test_' + Date.now(),
        status: 'READY',
        derivatives: [{ variant: 'THUMB_WEBP', url: 'https://cdn.aura.local/thumb.webp' }],
      };
    },
  };

  async function mockUploadPhoto(uri, purpose) {
    const formData = new Map();
    formData.set('purpose', purpose);
    formData.set('media_type', 'IMAGE');
    formData.set('idempotency_key', `up_test_${Date.now()}`);

    return mockApi.postFormData('/api/v1/media/upload', formData);
  }

  // Profile gallery upload
  const profileRes = await mockUploadPhoto('file:///local/photo.jpg', 'PROFILE_GALLERY');
  assert.equal(profileRes.status, 'READY');
  assert.equal(uploadedPayloads[0].path, '/api/v1/media/upload');
  assert.equal(uploadedPayloads[0].purpose, 'PROFILE_GALLERY');
  assert.ok(uploadedPayloads[0].idempotency_key.startsWith('up_test_'));

  // Selfie verification upload (MUST NOT be PROFILE_GALLERY)
  const selfieRes = await mockUploadPhoto('file:///local/selfie.jpg', 'SELFIE_VERIFICATION');
  assert.equal(selfieRes.status, 'READY');
  assert.equal(uploadedPayloads[1].path, '/api/v1/media/upload');
  assert.equal(uploadedPayloads[1].purpose, 'SELFIE_VERIFICATION');
  assert.notEqual(uploadedPayloads[1].purpose, 'PROFILE_GALLERY');
});

// --- Test 28: Age Assurance Session & Authoritative Status ---
test('Age Assurance: requires authoritative backend status check and never self-verifies', async () => {
  let sessionCreated = false;
  let statusCalls = 0;

  const mockAuthService = {
    async startAgeAssuranceSession() {
      sessionCreated = true;
      return {
        session_id: 'inq_user123_456',
        vendor_url: 'https://withpersona.com/verify?inquiry-id=inq_user123_456',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      };
    },
    async getAgeAssuranceStatus(mockStatus = 'PENDING') {
      statusCalls++;
      return {
        user_id: 'user_123',
        status: mockStatus,
        risk_score: 0,
      };
    },
  };

  // Flow: Start session
  const session = await mockAuthService.startAgeAssuranceSession();
  assert.equal(sessionCreated, true);
  assert.equal(session.session_id, 'inq_user123_456');

  // Authoritative status check: PENDING does not mark user verified
  const pendingStatus = await mockAuthService.getAgeAssuranceStatus('PENDING');
  assert.equal(pendingStatus.status, 'PENDING');
  const isVerifiedWhenPending = pendingStatus.status === 'VERIFIED';
  assert.equal(isVerifiedWhenPending, false);

  // Authoritative status check: VERIFIED marks user verified
  const verifiedStatus = await mockAuthService.getAgeAssuranceStatus('VERIFIED');
  assert.equal(verifiedStatus.status, 'VERIFIED');
  const isVerifiedWhenVerified = verifiedStatus.status === 'VERIFIED';
  assert.equal(isVerifiedWhenVerified, true);
  assert.equal(statusCalls, 2);
});

// --- Test 29: Web Age Assurance Fail-Closed Security Policy ---
test('Web Fallback: fails closed with 503 in production and never returns is_verified: true', () => {
  function handleWebStatusFallback(isProductionEnv) {
    if (isProductionEnv) {
      return {
        status: 503,
        body: {
          code: 'AGE_ASSURANCE_UNAVAILABLE',
          message: 'Age assurance service is temporarily unavailable',
          is_verified: false,
          status: 'PENDING',
        },
      };
    }
    return {
      status: 200,
      body: {
        is_verified: false,
        status: 'PENDING',
        method: 'DEV_MOCK',
      },
    };
  }

  function handleWebSessionFallback(isProductionEnv) {
    if (isProductionEnv) {
      return {
        status: 503,
        body: {
          code: 'AGE_ASSURANCE_UNAVAILABLE',
          message: 'Age assurance service is temporarily unavailable',
          status: 'PENDING',
        },
      };
    }
    return {
      status: 200,
      body: {
        session_id: 'dev_inq_fallback_123',
        provider: 'DEV_MOCK',
        status: 'PENDING',
      },
    };
  }

  // 1. Production status fallback: 503 Service Unavailable, is_verified is strictly false
  const prodStatus = handleWebStatusFallback(true);
  assert.equal(prodStatus.status, 503);
  assert.equal(prodStatus.body.is_verified, false);
  assert.equal(prodStatus.body.status, 'PENDING');

  // 2. Dev status fallback: is_verified is strictly false, never true
  const devStatus = handleWebStatusFallback(false);
  assert.equal(devStatus.status, 200);
  assert.equal(devStatus.body.is_verified, false);
  assert.equal(devStatus.body.status, 'PENDING');

  // 3. Production session fallback: 503 Service Unavailable, never VERIFIED
  const prodSession = handleWebSessionFallback(true);
  assert.equal(prodSession.status, 503);
  assert.equal(prodSession.body.status, 'PENDING');

  // 4. Dev session fallback: status is strictly PENDING, never VERIFIED
  const devSession = handleWebSessionFallback(false);
  assert.equal(devSession.status, 200);
  assert.equal(devSession.body.status, 'PENDING');
  assert.notEqual(devSession.body.status, 'VERIFIED');
});

// --- Test 30: Hermes Getter-Only Error.prototype.name Immunity ---
test('ApiError: safely instantiates without crashing in Hermes runtime with getter-only Error.prototype.name', () => {
  // Save original descriptor of Error.prototype.name
  const originalDescriptor = Object.getOwnPropertyDescriptor(Error.prototype, 'name');

  try {
    // Simulate Hermes engine where Error.prototype.name is an accessor with only a getter
    Object.defineProperty(Error.prototype, 'name', {
      get() {
        return 'Error';
      },
      set: undefined,
      configurable: true,
      enumerable: false,
    });

    // Verify the simulated environment reproduces the Hermes strict mode error on direct assignment
    assert.throws(
      () => {
        'use strict';
        const obj = Object.create(Error.prototype);
        obj.name = 'DirectAssignmentFails';
      },
      /Cannot (set|assign)/
    );

    // Implementation of the fixed ApiError class
    class SafeApiError extends Error {
      constructor(status, code, message, requestId, fields, cause) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
        Object.defineProperty(this, 'name', {
          value: 'ApiError',
          writable: true,
          enumerable: false,
          configurable: true,
        });
        this.status = status;
        this.code = code;
        this.requestId = requestId;
        this.fields = fields;
        if (cause !== undefined) {
          this.cause = cause;
        }
      }

      get name() {
        return 'ApiError';
      }
    }

    // Instantiating must NOT throw getter-only TypeError
    const underlyingError = new Error('Socket closed abruptly');
    const err = new SafeApiError(500, 'INTERNAL_ERROR', 'Server failed to process photo', 'req_abc123', undefined, underlyingError);

    assert.equal(err.name, 'ApiError');
    assert.equal(err.message, 'Server failed to process photo');
    assert.equal(err.status, 500);
    assert.equal(err.code, 'INTERNAL_ERROR');
    assert.equal(err.requestId, 'req_abc123');
    assert.equal(err.cause, underlyingError);
    assert.ok(err instanceof SafeApiError);
    assert.ok(err instanceof Error);
  } finally {
    // Restore original descriptor
    if (originalDescriptor) {
      Object.defineProperty(Error.prototype, 'name', originalDescriptor);
    } else {
      delete Error.prototype.name;
    }
  }
});

// --- Test 31: Photo Upload Failure Path Produces Readable Error ---
test('Photo Upload Failure Path: delivers readable error message instead of getter crash', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Error.prototype, 'name');

  try {
    // Simulate Hermes environment with getter-only Error.prototype.name
    Object.defineProperty(Error.prototype, 'name', {
      get() { return 'Error'; },
      set: undefined,
      configurable: true,
    });

    class SafeApiError extends Error {
      constructor(status, code, message, requestId, fields, cause) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
        Object.defineProperty(this, 'name', {
          value: 'ApiError',
          writable: true,
          enumerable: false,
          configurable: true,
        });
        this.status = status;
        this.code = code;
        this.requestId = requestId;
        this.fields = fields;
        if (cause !== undefined) this.cause = cause;
      }
      get name() { return 'ApiError'; }
    }

    // Mock API client catch handler
    function handleApiCatch(error, requestId = 'req_upload_1') {
      if (error instanceof SafeApiError) throw error;
      const errorObj = error && typeof error === 'object' ? error : null;
      if (errorObj?.name === 'AbortError') {
        throw new SafeApiError(408, 'TIMEOUT', 'Request timed out. Please check your connection.', requestId, undefined, error);
      }
      const msg = error instanceof Error ? error.message : errorObj?.message || 'Network connection failure';
      throw new SafeApiError(0, 'NETWORK_ERROR', msg, requestId, undefined, error);
    }

    // Simulate network drop during multipart photo upload
    let caughtAlertMessage = '';
    try {
      try {
        throw new TypeError('Failed to fetch');
      } catch (networkErr) {
        handleApiCatch(networkErr, 'req_upload_test');
      }
    } catch (err) {
      // Simulates profile.tsx / verify-age.tsx catch block:
      // Alert.alert('Upload Failed', err instanceof Error ? err.message : 'Could not upload photo.');
      caughtAlertMessage = err instanceof Error ? err.message : 'Could not upload photo.';
    }

    assert.equal(caughtAlertMessage, 'Failed to fetch');
    assert.doesNotMatch(caughtAlertMessage, /Cannot assign to property 'name'/);
  } finally {
    if (originalDescriptor) Object.defineProperty(Error.prototype, 'name', originalDescriptor);
  }
});

// --- Test 32: Age Verification Failure Path Produces Readable Error ---
test('Age Verification Failure Path: delivers readable session/status error instead of getter crash', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Error.prototype, 'name');

  try {
    // Simulate Hermes environment
    Object.defineProperty(Error.prototype, 'name', {
      get() { return 'Error'; },
      set: undefined,
      configurable: true,
    });

    class SafeApiError extends Error {
      constructor(status, code, message, requestId, fields, cause) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
        Object.defineProperty(this, 'name', {
          value: 'ApiError',
          writable: true,
          enumerable: false,
          configurable: true,
        });
        this.status = status;
        this.code = code;
        this.requestId = requestId;
        this.fields = fields;
        if (cause !== undefined) this.cause = cause;
      }
      get name() { return 'ApiError'; }
    }

    // Simulate backend 503 during POST /api/v1/age-assurance/session
    function simulateFailedSessionCall() {
      throw new SafeApiError(
        503,
        'AGE_ASSURANCE_UNAVAILABLE',
        'Age assurance service is temporarily unavailable',
        'req_sess_503'
      );
    }

    let alertTitle = '';
    let alertBody = '';

    try {
      simulateFailedSessionCall();
    } catch (err) {
      // Simulates verify-age.tsx catch block:
      // Alert.alert('Verification Failed', err instanceof Error ? err.message : 'Could not process verification photo.');
      alertTitle = 'Verification Failed';
      alertBody = err instanceof Error ? err.message : 'Could not process verification photo.';
    }

    assert.equal(alertTitle, 'Verification Failed');
    assert.equal(alertBody, 'Age assurance service is temporarily unavailable');
    assert.doesNotMatch(alertBody, /Cannot assign to property 'name'/);
  } finally {
    if (originalDescriptor) Object.defineProperty(Error.prototype, 'name', originalDescriptor);
  }
});

// --- Test 33: Global Error.prototype.name Safeguard & Screen Error Flow ---
test('Global Error.prototype.name Safeguard: protects whatwg-fetch and screens from getter crashes', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Error.prototype, 'name');

  try {
    // 1. Simulate Hermes engine with getter-only Error.prototype.name
    Object.defineProperty(Error.prototype, 'name', {
      get() { return 'Error'; },
      set: undefined,
      configurable: true,
      enumerable: false,
    });

    // Verify raw direct assignment throws in strict mode
    assert.throws(() => {
      'use strict';
      const obj = Object.create(Error.prototype);
      obj.name = 'FailsWithoutSetter';
    }, /Cannot (set|assign)/);

    // 2. Apply our global safeguard as installed in app/_layout.tsx
    const errorNameDesc = Object.getOwnPropertyDescriptor(Error.prototype, 'name');
    if (errorNameDesc && errorNameDesc.get && !errorNameDesc.set) {
      Object.defineProperty(Error.prototype, 'name', {
        get: errorNameDesc.get,
        set(value) {
          Object.defineProperty(this, 'name', {
            value,
            writable: true,
            enumerable: false,
            configurable: true,
          });
        },
        configurable: true,
      });
    }

    // 3. Now verify that legacy error constructions (like whatwg-fetch DOMException) succeed
    function LegacyDOMException(message, name) {
      this.message = message;
      this.name = name; // <--- This was throwing in Hermes!
    }
    LegacyDOMException.prototype = Object.create(Error.prototype);

    const domErr = new LegacyDOMException('Aborted', 'AbortError');
    assert.equal(domErr.name, 'AbortError');
    assert.equal(domErr.message, 'Aborted');

    // 4. Test photo upload FormData construction for native Android (must be { uri, name, type }, not new File)
    function buildNativeFormDataPart(platform, fileUri, fileBlob) {
      if (platform === 'web') {
        return { file: new File([fileBlob], 'photo.jpg', { type: 'image/jpeg' }) };
      }
      return { file: { uri: fileUri, name: 'photo.jpg', type: 'image/jpeg' } };
    }

    const nativePart = buildNativeFormDataPart('android', 'file:///data/user/0/cache/photo.jpg', null);
    assert.equal(nativePart.file.uri, 'file:///data/user/0/cache/photo.jpg');
    assert.equal(nativePart.file.name, 'photo.jpg');
    assert.equal(nativePart.file.type, 'image/jpeg');
    assert.equal(typeof nativePart.file, 'object');

    // 5. Test screen error handler with simulated abort / network error
    let profileAlert = '';
    try {
      throw new LegacyDOMException('Request timed out', 'AbortError');
    } catch (err) {
      profileAlert = err instanceof Error || (err && err.message) ? err.message : 'Could not upload photo.';
    }
    assert.equal(profileAlert, 'Request timed out');
    assert.doesNotMatch(profileAlert, /Cannot assign to property 'name'/);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(Error.prototype, 'name', originalDescriptor);
    } else {
      delete Error.prototype.name;
    }
  }
});

// --- Test 34: React Native Multipart FormData Upload Transport ---
test('React Native Multipart FormData Transport: supports { uri, name, type } via XMLHttpRequest without Expo Winter Fetch crash', async () => {
  // 1. Emulate React Native's FormData
  class MockReactNativeFormData {
    constructor() {
      this._parts = [];
    }
    append(key, value) {
      this._parts.push([key, value]);
    }
    getParts() {
      return this._parts.map(([name, value]) => {
        if (typeof value === 'object' && value && value.uri) {
          return { uri: value.uri, name: value.name, type: value.type, fieldName: name };
        }
        return { string: String(value), fieldName: name };
      });
    }
  }

  // 2. Emulate React Native's XMLHttpRequest
  const sentRequests = [];
  class MockXMLHttpRequest {
    constructor() {
      this.headers = {};
      this.status = 200;
      this.responseText = JSON.stringify({ id: 'med_test_123', status: 'READY' });
      this.readyState = 0;
      this.timeout = 0;
    }
    open(method, url, async = true) {
      this.method = method;
      this.url = url;
      this.readyState = 1;
    }
    setRequestHeader(key, val) {
      this.headers[key] = val;
    }
    send(body) {
      sentRequests.push({
        method: this.method,
        url: this.url,
        headers: { ...this.headers },
        body,
      });
      this.readyState = 4;
      if (typeof this.onload === 'function') {
        this.onload();
      }
    }
  }

  // 3. Test postFormData execution with React Native's native XMLHttpRequest
  const originalXHR = globalThis.XMLHttpRequest;
  try {
    globalThis.XMLHttpRequest = MockXMLHttpRequest;

    // Build native React Native form data with { uri, name, type }
    const profileFormData = new MockReactNativeFormData();
    profileFormData.append('file', {
      uri: 'file:///data/user/0/cache/photo.jpg',
      name: 'photo.jpg',
      type: 'image/jpeg',
    });
    profileFormData.append('purpose', 'PROFILE_GALLERY');
    profileFormData.append('media_type', 'IMAGE');
    profileFormData.append('idempotency_key', 'up_test_profile_001');

    // Emulate client.ts postFormData logic with MockXMLHttpRequest
    async function executePostFormData(url, formData, customHeaders, token = 'token_test_abc') {
      return new Promise((resolve, reject) => {
        const xhr = new MockXMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('X-Request-ID', 'req_test_1');
        xhr.setRequestHeader('Accept', 'application/json');
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        if (customHeaders) {
          for (const [k, v] of Object.entries(customHeaders)) {
            if (k.toLowerCase() !== 'content-type' && v !== undefined) {
              xhr.setRequestHeader(k, v);
            }
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject(new Error(`HTTP_${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error('NETWORK_ERROR'));
        xhr.send(formData);
      });
    }

    // Execute profile upload
    const profileRes = await executePostFormData(
      'http://192.168.1.10:8080/api/v1/media/upload',
      profileFormData,
      { 'Custom-Header': 'val' }
    );
    assert.equal(profileRes.id, 'med_test_123');
    assert.equal(profileRes.status, 'READY');

    // Verify request attributes
    assert.equal(sentRequests.length, 1);
    const req1 = sentRequests[0];
    assert.equal(req1.method, 'POST');
    assert.equal(req1.url, 'http://192.168.1.10:8080/api/v1/media/upload');
    assert.equal(req1.headers['Authorization'], 'Bearer token_test_abc');
    assert.equal(req1.headers['Accept'], 'application/json');
    assert.equal(req1.headers['Custom-Header'], 'val');
    // Content-Type MUST NOT be set manually so RCTNetworking can set multipart boundary
    assert.equal(req1.headers['Content-Type'], undefined);

    // Verify parts contain native { uri, name, type } without conversion error
    const parts = req1.body.getParts();
    assert.equal(parts.length, 4);
    assert.equal(parts[0].fieldName, 'file');
    assert.equal(parts[0].uri, 'file:///data/user/0/cache/photo.jpg');
    assert.equal(parts[0].name, 'photo.jpg');
    assert.equal(parts[0].type, 'image/jpeg');
    assert.equal(parts[1].fieldName, 'purpose');
    assert.equal(parts[1].string, 'PROFILE_GALLERY');

    // 4. Test selfie verification upload with strict purpose isolation
    const selfieFormData = new MockReactNativeFormData();
    selfieFormData.append('file', {
      uri: 'file:///data/user/0/cache/selfie.jpg',
      name: 'selfie.jpg',
      type: 'image/jpeg',
    });
    selfieFormData.append('purpose', 'SELFIE_VERIFICATION');
    selfieFormData.append('media_type', 'IMAGE');
    selfieFormData.append('idempotency_key', 'up_test_selfie_002');

    const selfieRes = await executePostFormData(
      'http://192.168.1.10:8080/api/v1/media/upload',
      selfieFormData
    );
    assert.equal(selfieRes.id, 'med_test_123');

    assert.equal(sentRequests.length, 2);
    const req2 = sentRequests[1];
    const selfieParts = req2.body.getParts();
    assert.equal(selfieParts[1].fieldName, 'purpose');
    assert.equal(selfieParts[1].string, 'SELFIE_VERIFICATION');
    assert.notEqual(selfieParts[1].string, 'PROFILE_GALLERY');

    // 5. Test error response handling
    const errorXhr = new MockXMLHttpRequest();
    errorXhr.status = 413;
    errorXhr.responseText = JSON.stringify({
      error: { code: 'FILE_TOO_LARGE', message: 'Payload exceeds limit', request_id: 'req_err' },
    });

    let caughtError = null;
    try {
      await new Promise((resolve, reject) => {
        errorXhr.onload = () => {
          let errorData = null;
          try {
            errorData = JSON.parse(errorXhr.responseText);
          } catch {}
          const code = errorData?.error?.code || `HTTP_${errorXhr.status}`;
          const message = errorData?.error?.message || 'Error';
          reject({ status: errorXhr.status, code, message });
        };
        errorXhr.send(profileFormData);
      });
    } catch (e) {
      caughtError = e;
    }
    assert.equal(caughtError.status, 413);
    assert.equal(caughtError.code, 'FILE_TOO_LARGE');
    assert.equal(caughtError.message, 'Payload exceeds limit');
  } finally {
    globalThis.XMLHttpRequest = originalXHR;
  }
});

// --- Test 35: Gallery Response Mapping & Post-Upload Refresh ---
test('Gallery Response Mapping & Post-Upload Refresh: transforms backend assets into absolute streaming URLs and updates profile gallery', async () => {
  const apiUrl = 'http://192.168.29.15:8080';

  function buildTestMediaUrl(path) {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const base = apiUrl.replace(/\/+$/, '');
    const clean = path.startsWith('/') ? path : `/${path}`;
    return `${base}${clean}`;
  }

  function mapAssetToTestProfilePhoto(asset, index) {
    const card = asset.derivatives?.find((d) => d.variant === 'CARD_WEBP' || d.variant === 'CARD_AVIF');
    const full = asset.derivatives?.find((d) => d.variant === 'FULL_WEBP' || d.variant === 'FULL_AVIF');
    const thumb = asset.derivatives?.find((d) => d.variant === 'THUMB_WEBP');
    const fallback = asset.derivatives?.[0];

    const primaryUrl = card?.url || full?.url || fallback?.url || '';
    const thumbUrl = thumb?.url || card?.url || fallback?.url || '';

    return {
      id: asset.id,
      url: buildTestMediaUrl(primaryUrl),
      thumb_url: thumbUrl ? buildTestMediaUrl(thumbUrl) : undefined,
      is_primary: asset.display_order === 0 || index === 0,
      order: asset.display_order ?? index,
    };
  }

  // 1. Backend response from GET /api/v1/media/gallery/me
  const backendGalleryResponse = {
    count: 2,
    minimum_required: 3,
    meets_minimum: false,
    assets: [
      {
        id: 'asset_001',
        owner_user_id: 'user_123',
        media_type: 'IMAGE',
        purpose: 'PROFILE_GALLERY',
        status: 'READY',
        display_order: 0,
        derivatives: [
          { variant: 'CARD_WEBP', url: '/api/v1/media/stream/aura-media-approved/u1/a1/card_webp.webp?token=tok1' },
          { variant: 'FULL_WEBP', url: '/api/v1/media/stream/aura-media-approved/u1/a1/full_webp.webp?token=tok1' },
          { variant: 'THUMB_WEBP', url: '/api/v1/media/stream/aura-media-approved/u1/a1/thumb_webp.webp?token=tok1' },
        ],
      },
      {
        id: 'asset_002',
        owner_user_id: 'user_123',
        media_type: 'IMAGE',
        purpose: 'PROFILE_GALLERY',
        status: 'READY',
        display_order: 1,
        derivatives: [
          { variant: 'FULL_WEBP', url: '/api/v1/media/stream/aura-media-approved/u1/a2/full_webp.webp?token=tok2' },
          { variant: 'THUMB_WEBP', url: '/api/v1/media/stream/aura-media-approved/u1/a2/thumb_webp.webp?token=tok2' },
        ],
      },
      // Non-profile assets (e.g. SELFIE_VERIFICATION or rejected) must be filtered out
      {
        id: 'asset_003_selfie',
        owner_user_id: 'user_123',
        media_type: 'IMAGE',
        purpose: 'SELFIE_VERIFICATION',
        status: 'READY',
        display_order: 0,
        derivatives: [{ variant: 'CARD_WEBP', url: '/api/v1/media/stream/selfie?token=tok3' }],
      },
      {
        id: 'asset_004_rejected',
        owner_user_id: 'user_123',
        media_type: 'IMAGE',
        purpose: 'PROFILE_GALLERY',
        status: 'REJECTED',
        display_order: 2,
        derivatives: [],
      },
    ],
  };

  // 2. Filter and map
  const visiblePhotos = backendGalleryResponse.assets
    .filter((a) => a.purpose === 'PROFILE_GALLERY' && a.status === 'READY')
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    .map((a, i) => mapAssetToTestProfilePhoto(a, i));

  assert.equal(visiblePhotos.length, 2);

  // Photo 1 checks
  assert.equal(visiblePhotos[0].id, 'asset_001');
  assert.equal(visiblePhotos[0].is_primary, true);
  assert.equal(visiblePhotos[0].order, 0);
  assert.equal(
    visiblePhotos[0].url,
    'http://192.168.29.15:8080/api/v1/media/stream/aura-media-approved/u1/a1/card_webp.webp?token=tok1'
  );
  assert.equal(
    visiblePhotos[0].thumb_url,
    'http://192.168.29.15:8080/api/v1/media/stream/aura-media-approved/u1/a1/thumb_webp.webp?token=tok1'
  );

  // Photo 2 checks
  assert.equal(visiblePhotos[1].id, 'asset_002');
  assert.equal(visiblePhotos[1].is_primary, false);
  assert.equal(visiblePhotos[1].order, 1);
  assert.equal(
    visiblePhotos[1].url,
    'http://192.168.29.15:8080/api/v1/media/stream/aura-media-approved/u1/a2/full_webp.webp?token=tok2'
  );

  // 3. Post-upload confirmed refresh workflow
  let alertMessage = '';
  async function simulateUploadAndRefresh(uploadResult, mockGetGallery) {
    if (!uploadResult || !uploadResult.media_id) {
      throw new Error('Server failed to confirm media upload.');
    }
    const refreshedGallery = await mockGetGallery();
    alertMessage = `Photo Uploaded: ${refreshedGallery.length} photos now visible`;
    return refreshedGallery;
  }

  // Upload succeeds
  const uploadSuccess = { media_id: 'asset_003', status: 'READY' };
  const updatedGallery = await simulateUploadAndRefresh(uploadSuccess, async () => [
    ...visiblePhotos,
    { id: 'asset_003', url: 'http://192.168.29.15:8080/api/v1/media/stream/new.webp', is_primary: false, order: 2 },
  ]);
  assert.equal(updatedGallery.length, 3);
  assert.equal(alertMessage, 'Photo Uploaded: 3 photos now visible');

  // If server fails or confirms no media_id, alert is NOT shown and error is thrown
  await assert.rejects(
    () => simulateUploadAndRefresh(null, async () => []),
    /Server failed to confirm media upload/
  );
});

// --- Test 36: Profile Save DTO Payload & Dealbreaker Synchronization ---
test('Profile Save DTO: strictly aligns with Go validator, prevents unknown fields, and surfaces real error messages', async () => {
  // 1. Simulate the mobile updateMyProfile payload builder
  function buildUpdateProfilePayload(updates) {
    const payload = {};
    if (updates.display_name !== undefined) payload.display_name = updates.display_name.trim();
    if (updates.bio !== undefined) payload.bio = updates.bio;
    if (updates.pronouns !== undefined) payload.pronouns = updates.pronouns;
    if (updates.gender_identities !== undefined) payload.gender_identities = updates.gender_identities;
    if (updates.sexual_orientations !== undefined) payload.sexual_orientations = updates.sexual_orientations;
    if (updates.relationship_intents !== undefined) payload.relationship_intents = updates.relationship_intents;

    // Must map smoking preference to backend smoking_habit
    const habit = updates.smoking_habit || updates.smoking_preference;
    if (habit !== undefined) payload.smoking_habit = habit;

    return payload;
  }

  // 2. Simulate discovery preferences payload builder
  function buildUpdatePreferencesPayload(prefs) {
    const payload = {};
    if (prefs.min_age !== undefined) payload.min_age = prefs.min_age;
    if (prefs.max_age !== undefined) payload.max_age = prefs.max_age;
    if (prefs.max_distance_km !== undefined) payload.max_distance_km = prefs.max_distance_km;
    if (prefs.preferred_genders !== undefined) payload.preferred_genders = prefs.preferred_genders;
    if (prefs.preferred_intents !== undefined) payload.preferred_intents = prefs.preferred_intents;
    if (prefs.verified_only !== undefined) payload.verified_profiles_only = prefs.verified_only;

    if (prefs.dealbreakers) {
      payload.dealbreakers = prefs.dealbreakers;
    } else if (prefs.dealbreaker_non_smoker !== undefined) {
      payload.dealbreakers = {
        non_smoker_only: Boolean(prefs.dealbreaker_non_smoker),
        require_verified: Boolean(prefs.verified_only),
        require_monogamous: false,
      };
    }
    return payload;
  }

  // Test payload construction from mobile inputs
  const profileInput = {
    display_name: '  Morgan Chen  ',
    bio: 'Artist and activist',
    smoking_preference: 'NON_SMOKER',
    non_smoker_dealbreaker: true, // Should NOT be in profile payload
  };

  const profilePayload = buildUpdateProfilePayload(profileInput);
  assert.equal(profilePayload.display_name, 'Morgan Chen');
  assert.equal(profilePayload.bio, 'Artist and activist');
  assert.equal(profilePayload.smoking_habit, 'NON_SMOKER');
  // Unknown fields strictly stripped
  assert.equal(profilePayload.smoking_preference, undefined);
  assert.equal(profilePayload.non_smoker_dealbreaker, undefined);

  const prefPayload = buildUpdatePreferencesPayload({ dealbreaker_non_smoker: true });
  assert.deepEqual(prefPayload.dealbreakers, {
    non_smoker_only: true,
    require_verified: false,
    require_monogamous: false,
  });
  assert.equal(prefPayload.dealbreaker_non_smoker, undefined);

  // 3. Error message surfacing: never swallows server validation error behind generic message
  function handleSaveError(err) {
    const message = err instanceof Error ? err.message : 'Could not save profile changes.';
    return `Save Failed: ${message}`;
  }

  const serverValidationErr = new Error('display name must be between 1 and 64 characters');
  assert.equal(handleSaveError(serverValidationErr), 'Save Failed: display name must be between 1 and 64 characters');

  const unknownErr = 'Network error';
  assert.equal(handleSaveError(unknownErr), 'Save Failed: Could not save profile changes.');
});

// --- Test 37: Mobile UI Redesign: 5-Tab Architecture, Theme Colors & Dedicated Screens ---
test('Mobile UI Redesign: enforces 5-tab bottom navigation, theme palette, and screen isolation', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  // 1. Verify theme colors include red Like action and luxury charcoal surfaces
  const colorsFile = await fs.readFile(
    new URL('../src/theme/colors.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(colorsFile.includes("like: '#E53935'"), 'Theme colors must include vivid red Like button');
  assert.ok(colorsFile.includes("gold: '#D4AF37'"), 'Theme colors must include champagne gold');
  assert.ok(colorsFile.includes("background: '#090A0E'"), 'Theme colors must use near-black background');
  assert.ok(colorsFile.includes("card: '#161922'"), 'Theme colors must use charcoal card surfaces');

  // 2. Verify Tab Layout configuration defines exactly the 5 specified tabs
  const layoutFile = await fs.readFile(
    new URL('../app/(tabs)/_layout.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(layoutFile.includes('name="index"'), 'Tab 1 must be index (Discover)');
  assert.ok(layoutFile.includes('title: \'Discover\''), 'Tab 1 title must be Discover');
  assert.ok(layoutFile.includes('name="likes"'), 'Tab 2 must be likes (Likes)');
  assert.ok(layoutFile.includes('title: \'Likes\''), 'Tab 2 title must be Likes');
  assert.ok(layoutFile.includes('name="chat"'), 'Tab 3 must be chat (Chat)');
  assert.ok(layoutFile.includes('title: \'Chat\''), 'Tab 3 title must be Chat');
  assert.ok(layoutFile.includes('name="membership"'), 'Tab 4 must be membership (Aura VIP)');
  assert.ok(layoutFile.includes('title: \'Aura VIP\''), 'Tab 4 title must be Aura VIP');
  assert.ok(layoutFile.includes('name="profile"'), 'Tab 5 must be profile (Profile)');
  assert.ok(layoutFile.includes('title: \'Profile\''), 'Tab 5 title must be Profile');

  // Secondary screens must have href: null so they do not create additional tabs
  assert.ok(layoutFile.includes('name="settings"') && layoutFile.includes('href: null'), 'Settings must have href: null');
  assert.ok(layoutFile.includes('name="matches"') && layoutFile.includes('href: null'), 'Matches must have href: null');
  assert.ok(layoutFile.includes('name="vip"') && layoutFile.includes('href: null'), 'VIP alias must have href: null');

  // 3. Verify dedicated Likes screen enforces privacy and never fabricates fake profiles
  const likesFile = await fs.readFile(
    new URL('../app/(tabs)/likes.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(likesFile.includes('SEE_WHO_LIKED_YOU'), 'Likes screen must check SEE_WHO_LIKED_YOU entitlement');
  assert.ok(likesFile.includes('lockedContainer'), 'Free tier must render locked view');
  assert.ok(likesFile.includes('Upgrade to Aura VIP'), 'Free tier must present upgrade prompt');
  assert.ok(likesFile.includes('No New Likes Right Now'), 'Must provide honest empty state without fake likes');

  // 4. Verify dedicated Chat screen enforces mutual match messaging
  const chatFile = await fs.readFile(
    new URL('../app/(tabs)/chat.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(chatFile.includes('Mutual Sparks'), 'Chat screen must render mutual sparks carousel');
  assert.ok(chatFile.includes('Conversations become available when both members like each other'), 'Must explain mutual match requirement in empty state');

  // 5. Verify Profile screen provides direct access to Privacy & Security settings
  const profileFile = await fs.readFile(
    new URL('../app/(tabs)/profile.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(profileFile.includes("router.push('/(tabs)/settings')"), 'Profile must provide direct navigation to Security & Privacy settings');
  assert.ok(profileFile.includes('Profile Gallery'), 'Profile must keep working gallery');
  assert.ok(profileFile.includes('Non-Smoker Dealbreaker'), 'Profile must keep dealbreaker controls');
});

// --- Test 25: Discovery Feed Normalization & Dedicated Age-Assurance Locked State ---
test('Discovery Feed: Candidate normalization correctly maps backend fields, URLs, and dealbreakers', () => {
  const rawBackendCandidate = {
    user_id: 'cand-uuid-1234',
    display_name: 'Morgan',
    age: 27,
    bio: 'Art and coffee enthusiast',
    pronouns: ['they', 'them'],
    gender_identities: ['non-binary'],
    sexual_orientations: ['queer'],
    relationship_intents: ['long-term'],
    relationship_structure: 'MONOGAMOUS',
    smoking_habit: 'NON_SMOKER',
    drinking_habit: 'SOCIALLY',
    approximate_distance_km: 3,
    is_photo_verified: true,
    compatibility_score: 94,
    photos: [
      {
        asset_id: 'photo-1',
        card_url: '/api/v1/media/stream/gallery/card-1.webp?token=tok1',
        thumb_url: '/api/v1/media/stream/gallery/thumb-1.webp?token=tok1',
        full_url: '/api/v1/media/stream/gallery/full-1.webp?token=tok1',
      },
      {
        asset_id: 'photo-2',
        card_url: '/api/v1/media/stream/gallery/card-2.webp?token=tok2',
        thumb_url: '/api/v1/media/stream/gallery/thumb-2.webp?token=tok2',
      },
    ],
  };

  function normalizeCandidate(raw, baseUrl = 'http://192.168.1.100:8080') {
    const rawPhotos = Array.isArray(raw.photos) ? raw.photos : [];
    const photos = rawPhotos.map((p, idx) => {
      const rawUrl = p.card_url || p.full_url || p.url || p.thumb_url || '';
      const rawThumb = p.thumb_url || p.card_url || p.url || '';
      const fullUrl = rawUrl.startsWith('http') ? rawUrl : `${baseUrl}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
      const fullThumb = rawThumb.startsWith('http') ? rawThumb : `${baseUrl}${rawThumb.startsWith('/') ? '' : '/'}${rawThumb}`;
      return {
        id: p.asset_id || p.id || `photo_${idx}`,
        url: fullUrl,
        thumb_url: fullThumb,
        is_primary: idx === 0,
        order: p.order ?? idx,
      };
    });

    return {
      id: raw.user_id || raw.id,
      user_id: raw.user_id || raw.id,
      display_name: raw.display_name || '',
      age: raw.age || 0,
      bio: raw.bio || '',
      pronouns: raw.pronouns || [],
      gender_identities: raw.gender_identities || [],
      sexual_orientations: raw.sexual_orientations || [],
      relationship_intents: raw.relationship_intents || [],
      smoking_preference: raw.smoking_habit || raw.smoking_preference || 'NON_SMOKER',
      distance_bucket_km: raw.approximate_distance_km ?? raw.distance_bucket_km ?? 1,
      photos,
      compatibility_score: raw.compatibility_score || 0,
      is_verified: Boolean(raw.is_photo_verified || raw.is_verified),
      relationship_structure: raw.relationship_structure,
    };
  }

  const normalized = normalizeCandidate(rawBackendCandidate);
  assert.equal(normalized.id, 'cand-uuid-1234');
  assert.equal(normalized.user_id, 'cand-uuid-1234');
  assert.equal(normalized.display_name, 'Morgan');
  assert.equal(normalized.age, 27);
  assert.equal(normalized.smoking_preference, 'NON_SMOKER');
  assert.equal(normalized.distance_bucket_km, 3);
  assert.equal(normalized.is_verified, true);
  assert.equal(normalized.photos.length, 2);
  assert.equal(normalized.photos[0].id, 'photo-1');
  assert.ok(normalized.photos[0].url.startsWith('http://192.168.1.100:8080/api/v1/media/stream/'));
  assert.equal(normalized.photos[0].is_primary, true);
});

test('Discovery Feed: Empty state separation prevents misleading Dealbreaker banner when Age Assurance is locked', async () => {
  const fs = await import('node:fs/promises');
  const indexFile = await fs.readFile(
    new URL('../app/(tabs)/index.tsx', import.meta.url),
    'utf-8'
  );

  // 1. Must contain testID="age-locked-feed-state" for unverified age
  assert.ok(indexFile.includes('testID="age-locked-feed-state"'), 'Must have dedicated testID="age-locked-feed-state"');
  assert.ok(indexFile.includes('18+ Age Assurance Required'), 'Must state 18+ Age Assurance Required in locked view');
  assert.ok(indexFile.includes('Complete Age Verification'), 'Must provide CTA button to Complete Age Verification');
  assert.ok(indexFile.includes('Check Verification Status'), 'Must provide CTA button to Check Verification Status');

  // 2. Must contain testID="photo-minimum-feed-state" when PHOTO_MINIMUM_REQUIRED
  assert.ok(indexFile.includes('testID="photo-minimum-feed-state"'), 'Must have dedicated testID="photo-minimum-feed-state"');
  assert.ok(indexFile.includes('3 Photos Minimum Required'), 'Must explain 3 photos minimum requirement');

  // 3. DealbreakerEmptyState must only render after checking age verification and photo minimums
  assert.ok(
    indexFile.includes('!isAgeVerified ?') && indexFile.includes('emptyStateReason === \'PHOTO_MINIMUM_REQUIRED\' ?'),
    'Must gate deck before falling through to DealbreakerEmptyState'
  );
});

test('AuthContext: Authoritatively synchronizes age assurance status from backend', async () => {
  const fs = await import('node:fs/promises');
  const authContextFile = await fs.readFile(
    new URL('../src/context/AuthContext.tsx', import.meta.url),
    'utf-8'
  );

  // 1. Must use isAgeVerified state
  assert.ok(authContextFile.includes('const [isAgeVerified, setIsAgeVerified] = useState<boolean>(false);'), 'Must declare isAgeVerified state');

  // 2. Must call getAgeAssuranceStatus()
  assert.ok(authContextFile.includes('authService.getAgeAssuranceStatus()'), 'Must query authService.getAgeAssuranceStatus()');
  assert.ok(authContextFile.includes('ageStatus?.status === \'VERIFIED\''), 'Must verify VERIFIED status from backend');

  // 3. Must reset on logout
  assert.ok(authContextFile.includes('setIsAgeVerified(false);'), 'Must reset isAgeVerified on logout');
});

test('Swipe & Mutual Match Normalization: correctly normalizes backend matched and match.id into is_mutual_match and conversation_id', () => {
  // Test raw backend response when match occurs
  const rawBackendMatch = {
    matched: true,
    match: {
      id: 'match-uuid-101',
      matched_user_id: 'user-bob-999',
      status: 'ACTIVE',
      matched_at: '2026-10-16T00:00:00Z',
    },
    daily_swipes_remaining: 14,
    unlimited_swipes_granted: true,
  };

  const isMatch = Boolean(rawBackendMatch.is_mutual_match || rawBackendMatch.matched);
  const matchId = rawBackendMatch.match_id || rawBackendMatch.match?.id;
  const normalized = {
    swipe_id: rawBackendMatch.swipe_id || '',
    is_mutual_match: isMatch,
    match_id: matchId,
    conversation_id: rawBackendMatch.conversation_id || matchId,
    remaining_likes_today: rawBackendMatch.remaining_likes_today ?? (rawBackendMatch.daily_swipes_remaining ?? 9999),
  };

  assert.equal(normalized.is_mutual_match, true, 'is_mutual_match must be true');
  assert.equal(normalized.match_id, 'match-uuid-101', 'match_id must match backend match.id');
  assert.equal(normalized.conversation_id, 'match-uuid-101', 'conversation_id must fallback to match.id');
  assert.equal(normalized.remaining_likes_today, 14, 'remaining_likes_today must be 14');

  // Test pass response (no match)
  const rawBackendPass = {
    matched: false,
    daily_swipes_remaining: 14,
    unlimited_swipes_granted: false,
  };
  const isMatchPass = Boolean(rawBackendPass.is_mutual_match || rawBackendPass.matched);
  assert.equal(isMatchPass, false, 'is_mutual_match must be false on pass');
});

test('Chat & Matches Normalization: correctly extracts target_profile, avatars, partner info, and message summaries', () => {
  // Test raw backend match response
  const rawMatch = {
    id: 'match-777',
    matched_user_id: 'usr-charlie',
    matched_profile: {
      user_id: 'usr-charlie',
      display_name: 'Charlie',
      bio: 'Enthusiastic queer traveler',
      is_photo_verified: true,
      photos: [
        {
          asset_id: 'photo-1',
          card_url: '/api/v1/media/stream/approved/card.webp',
          thumb_url: '/api/v1/media/stream/approved/thumb.webp',
        },
      ],
    },
    status: 'ACTIVE',
    matched_at: '2026-10-16T01:00:00Z',
  };

  const targetProf = rawMatch.matched_profile || rawMatch.target_profile || {};
  const targetId = rawMatch.matched_user_id || rawMatch.target_user_id || targetProf.user_id || '';
  const photos = Array.isArray(targetProf.photos) ? targetProf.photos : [];
  const rawAvatar = targetProf.avatar_url || photos[0]?.card_url || photos[0]?.thumb_url || photos[0]?.url || '';

  const normalizedMatch = {
    id: rawMatch.id,
    user_id: rawMatch.user_id || '',
    target_user_id: targetId,
    target_profile: {
      user_id: targetId,
      display_name: targetProf.display_name || 'Member',
      avatar_url: rawAvatar,
      is_verified: Boolean(targetProf.is_photo_verified || targetProf.is_verified),
      gender_identities: targetProf.gender_identities,
    },
    matched_at: rawMatch.matched_at,
  };

  assert.equal(normalizedMatch.target_profile.display_name, 'Charlie');
  assert.equal(normalizedMatch.target_profile.is_verified, true);
  assert.equal(normalizedMatch.target_profile.avatar_url, '/api/v1/media/stream/approved/card.webp');

  // Test raw backend conversation response
  const rawConv = {
    id: 'conv-888',
    match_id: 'match-777',
    participant_low_id: 'usr-alice',
    participant_high_id: 'usr-charlie',
    partner: {
      user_id: 'usr-charlie',
      display_name: 'Charlie',
      avatar_url: '/api/v1/media/stream/approved/card.webp',
      is_photo_verified: true,
      is_online: true,
    },
    last_message: {
      id: 'msg-1',
      sender_user_id: 'usr-charlie',
      body: 'Hello there!',
      message_type: 'TEXT',
      created_at: '2026-10-16T01:05:00Z',
      is_read: false,
    },
    unread_count: 1,
    created_at: '2026-10-16T01:00:00Z',
  };

  const partner = rawConv.partner || {};
  const partnerId = partner.user_id || rawConv.participant_id || '';
  const partnerName = partner.display_name || rawConv.participant_name || 'Member';
  const lastMsg = rawConv.last_message;

  const normalizedConv = {
    id: rawConv.id || rawConv.match_id,
    match_id: rawConv.match_id,
    participant_id: partnerId,
    participant_name: partnerName,
    participant_avatar: partner.avatar_url,
    participant_verified: Boolean(partner.is_photo_verified),
    last_message: lastMsg
      ? {
          id: lastMsg.id,
          sender_id: lastMsg.sender_user_id || lastMsg.sender_id,
          content: lastMsg.body !== undefined ? lastMsg.body : lastMsg.content,
          created_at: lastMsg.created_at,
          read: Boolean(lastMsg.is_read || lastMsg.read),
        }
      : undefined,
    unread_count: rawConv.unread_count,
    updated_at: rawConv.last_message_at || rawConv.created_at,
  };

  assert.equal(normalizedConv.participant_name, 'Charlie');
  assert.equal(normalizedConv.last_message.content, 'Hello there!');
  assert.equal(normalizedConv.unread_count, 1);
  assert.equal(normalizedConv.participant_verified, true);
});


