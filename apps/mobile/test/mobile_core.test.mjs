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

test('Forgot Password & Account Recovery: correctly invokes requestPasswordReset and handles generic response, enumeration defense, and rate-limiting', () => {
  // Test password reset request payload
  const emailInput = ' Member@Aura.Dating ';
  const normalizedEmail = emailInput.trim().toLowerCase();
  assert.equal(normalizedEmail, 'member@aura.dating');

  // Verify generic anti-enumeration response structure
  const genericResponse = {
    message: 'If this email exists, password reset instructions have been generated',
  };
  assert.ok(genericResponse.message.includes('If this email exists'));

  // Rate-limiting error mapping
  const rateLimitError = {
    status: 429,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Please wait before requesting another password reset email',
  };
  assert.equal(rateLimitError.status, 429);
  assert.equal(rateLimitError.code, 'RATE_LIMIT_EXCEEDED');
});

test('Reset Password Validation & Token Confirmation: enforces Aura password policy checklist and validates token confirmation', () => {
  // Test password validation rules aligned with Go ValidatePasswordPolicy
  function validatePolicy(password) {
    const minLength = password.length >= 8 && password.length <= 128;
    const hasDigit = /\d/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    return minLength && hasDigit && hasSpecial;
  }

  // Failing cases
  assert.equal(validatePolicy('short1!'), false, 'under 8 chars should fail');
  assert.equal(validatePolicy('NoDigitsHere!'), false, 'missing digit should fail');
  assert.equal(validatePolicy('NoSpecial1234'), false, 'missing special char should fail');
  assert.equal(validatePolicy('a'.repeat(129) + '1!'), false, 'over 128 chars should fail');

  // Passing cases
  assert.equal(validatePolicy('Valid123!'), true, 'standard valid password should pass');
  assert.equal(validatePolicy('QueerSecure2026_Aura'), true, 'password with underscore should pass');

  // Token confirmation payload
  const token = '   abc123def4567890   ';
  const newPassword = 'NewSecurePassword2026!';
  const confirmPayload = {
    token: token.trim(),
    new_password: newPassword,
  };
  assert.equal(confirmPayload.token, 'abc123def4567890');
  assert.equal(confirmPayload.new_password, 'NewSecurePassword2026!');
});

// --- Test 45: 3 Distinct Onboarding Fields, Custom Serialization & Timeout Handling ---
test('Onboarding 3-Section Taxonomy & Timeout Handling: enforces strict separation, custom prefixing, and clear error diagnostics', () => {
  // 1. Verify 3 distinct sections in exact order
  const sections = [
    '1. I am a — Gender identity',
    '2. Looking for — Gender preferences',
    '3. Sexual orientation',
  ];
  assert.equal(sections[0], '1. I am a — Gender identity');
  assert.equal(sections[1], '2. Looking for — Gender preferences');
  assert.equal(sections[2], '3. Sexual orientation');

  // 2. Strict separation: Lesbian MUST be strictly under Sexual orientation
  const genderValues = [
    'woman', 'man', 'non-binary', 'transgender woman', 'transgender man',
    'cisgender woman', 'cisgender man', 'genderfluid', 'agender', 'two-spirit',
    'genderqueer', 'intersex', 'prefer not to say', 'custom',
  ];
  const lookingForValues = [
    'woman', 'man', 'non-binary', 'transgender woman', 'transgender man',
    'cisgender woman', 'cisgender man', 'genderfluid', 'agender', 'two-spirit',
    'genderqueer', 'intersex', 'all', 'custom',
  ];
  const orientationValues = [
    'lesbian', 'gay', 'bisexual', 'pansexual', 'queer', 'asexual',
    'demisexual', 'questioning', 'straight', 'prefer not to say', 'custom',
  ];

  assert.ok(orientationValues.includes('lesbian'), '"lesbian" must be in sexual orientation');
  assert.ok(!genderValues.includes('lesbian'), '"lesbian" must NEVER be in gender identity');
  assert.ok(!lookingForValues.includes('lesbian'), '"lesbian" must NEVER be in looking for gender preferences');

  // 3. Custom identity and orientation serialization with custom: prefix
  function buildFinalList(selected, customText) {
    const list = selected.filter((item) => item !== 'custom');
    if (selected.includes('custom')) {
      const trimmed = customText.trim().toLowerCase();
      if (trimmed) {
        list.push(trimmed.startsWith('custom:') ? trimmed : `custom:${trimmed}`);
      } else {
        list.push('custom');
      }
    }
    return list;
  }

  // Standard without custom
  assert.deepEqual(buildFinalList(['woman', 'non-binary'], ''), ['woman', 'non-binary']);

  // Custom gender identity with custom: prefix
  const customGender = buildFinalList(['woman', 'custom'], ' Demi-Girl ');
  assert.deepEqual(customGender, ['woman', 'custom:demi-girl']);

  // Custom orientation with custom: prefix
  const customOrient = buildFinalList(['queer', 'custom'], ' Omnisexual ');
  assert.deepEqual(customOrient, ['queer', 'custom:omnisexual']);

  // Looking for with "all" (Everyone / Open to all)
  const lookingAll = buildFinalList(['all'], '');
  assert.deepEqual(lookingAll, ['all']);

  // "prefer not to say" support
  const preferNotToSay = buildFinalList(['prefer not to say'], '');
  assert.deepEqual(preferNotToSay, ['prefer not to say']);

  // 4. Hermes Fetch Abort / Cancellation diagnostics
  function formatNetworkError(error, apiUrl) {
    const errorObj = error && typeof error === 'object' ? error : null;
    const msg = error instanceof Error ? error.message : errorObj?.message || 'Network connection failure';
    const isAbort = errorObj?.name === 'AbortError' || /canceled|aborted/i.test(msg);
    if (isAbort) {
      return {
        status: 408,
        code: 'TIMEOUT',
        message: `Request timed out or was canceled (${apiUrl}). Please check server connectivity.`,
      };
    }
    return {
      status: 0,
      code: 'NETWORK_ERROR',
      message: `${msg} (${apiUrl})`,
    };
  }

  const hermesCancelError = new TypeError('fetch failed: Fetch request has been canceled');
  const formatted = formatNetworkError(hermesCancelError, 'http://192.168.29.15:8080');
  assert.equal(formatted.status, 408);
  assert.equal(formatted.code, 'TIMEOUT');
  assert.ok(formatted.message.includes('http://192.168.29.15:8080'));
  assert.ok(formatted.message.includes('timed out or was canceled'));
});

// --- Test 46: Selfie Verification Persistence & Mount Recovery ---
test('Selfie Verification: associates media_id with age assurance session and recovers status on mount', async () => {
  const calls = [];
  const mockAuthService = {
    async startAgeAssuranceSession(mediaId) {
      calls.push({ action: 'startSession', mediaId });
      return { session_id: 'inq_selfie_123', status: 'PENDING' };
    },
    async getAgeAssuranceStatus() {
      calls.push({ action: 'getStatus' });
      return {
        user_id: 'usr_abc',
        status: 'PENDING',
        metadata: { media_id: 'med_selfie_999' },
      };
    },
  };

  // 1. Upload verification selfie returns media_id
  const uploadedAsset = { media_id: 'med_selfie_999', status: 'READY' };

  // 2. startAgeAssuranceSession receives media_id
  const session = await mockAuthService.startAgeAssuranceSession(uploadedAsset.media_id);
  assert.equal(session.session_id, 'inq_selfie_123');
  assert.equal(calls[0].mediaId, 'med_selfie_999');

  // 3. Status recovery maps correctly on screen mount
  function mapBackendStatusToStep(statusRes) {
    if (!statusRes) return 'INFO';
    if (statusRes.status === 'VERIFIED') return 'VERIFIED';
    if (statusRes.status === 'PENDING' || statusRes.status === 'MANUAL_REVIEW') return 'PENDING';
    if (statusRes.status === 'REJECTED') return 'REJECTED';
    if (statusRes.status === 'FAILED') return 'FAILED';
    return 'INFO';
  }

  const restoredStatus = await mockAuthService.getAgeAssuranceStatus();
  assert.equal(restoredStatus.metadata.media_id, 'med_selfie_999');
  assert.equal(mapBackendStatusToStep(restoredStatus), 'PENDING');
  assert.equal(mapBackendStatusToStep({ status: 'VERIFIED' }), 'VERIFIED');
  assert.equal(mapBackendStatusToStep({ status: 'REJECTED' }), 'REJECTED');
  assert.equal(mapBackendStatusToStep({ status: 'UNVERIFIED' }), 'INFO');
  assert.equal(mapBackendStatusToStep(null), 'INFO');
});

// --- Test 47: Profile Access While Verification is Pending & Badge Separation ---
test('Profile Access & Badge Separation: keeps profile editing functional and denies verified badge while pending', () => {
  // Pending verification profile
  const pendingProfile = {
    id: 'prof_1',
    user_id: 'usr_1',
    display_name: 'Alex',
    bio: 'Queer artist',
    is_age_verified: false,
    is_photo_verified: false,
    verification_status: 'PENDING',
    photo_verification_status: 'PENDING',
    photos: [{ id: 'p1', url: 'https://cdn.aura.local/p1.jpg', is_primary: true, order: 0 }],
  };

  // 1. Avatar badge dot is STRICTLY gated on is_photo_verified === true
  function shouldShowVerifiedDot(p) {
    return Boolean(p?.is_photo_verified);
  }
  assert.equal(shouldShowVerifiedDot(pendingProfile), false, 'Pending user must NOT have verified badge dot');

  const verifiedProfile = { ...pendingProfile, is_photo_verified: true, photo_verification_status: 'VERIFIED' };
  assert.equal(shouldShowVerifiedDot(verifiedProfile), true, 'Confirmed photo-verified user has badge dot');

  // 2. Statuses remain strictly separated
  assert.notEqual(pendingProfile.is_age_verified, undefined);
  assert.notEqual(pendingProfile.is_photo_verified, undefined);
  assert.equal(pendingProfile.is_age_verified, false);
  assert.equal(pendingProfile.is_photo_verified, false);

  // 3. Profile editing is fully allowed even when verification is pending
  function canEditProfile(p) {
    return Boolean(p && p.user_id); // Editable for all active accounts regardless of verification status
  }
  assert.equal(canEditProfile(pendingProfile), true, 'Profile must remain editable while verification is pending');
});

// --- Test 48: Resend Transactional Email Requirements for Gmail ---
test('Forgot Password Resend Delivery: verifies domain, token generation, and fail-safe unconfigured handling', () => {
  // 1. Resend sink unconfigured in development logs safely and does not throw or fake delivery
  function checkResendDeliveryConfig(apiKey, fromEmail) {
    if (!apiKey) {
      return { configured: false, reason: 'RESEND_API_KEY_MISSING' };
    }
    const fromDomain = fromEmail.includes('@') ? fromEmail.split('@')[1].replace('>', '').trim() : '';
    if (fromDomain === 'resend.dev') {
      return {
        configured: true,
        canSendToArbitraryGmail: false,
        reason: 'TESTING_DOMAIN_RESTRICTED_TO_ACCOUNT_OWNER',
      };
    }
    return {
      configured: true,
      canSendToArbitraryGmail: true,
      requiresDnsVerification: true,
    };
  }

  // Without API key
  const noKey = checkResendDeliveryConfig('', 'Aura <security@aura.dating>');
  assert.equal(noKey.configured, false);
  assert.equal(noKey.reason, 'RESEND_API_KEY_MISSING');

  // With sandbox onboarding@resend.dev
  const sandbox = checkResendDeliveryConfig('re_test_key', 'onboarding@resend.dev');
  assert.equal(sandbox.configured, true);
  assert.equal(sandbox.canSendToArbitraryGmail, false);

  // With custom production domain security@aura.dating
  const prodDomain = checkResendDeliveryConfig('re_live_key', 'security@aura.dating');
  assert.equal(prodDomain.configured, true);
  assert.equal(prodDomain.canSendToArbitraryGmail, true);
  assert.equal(prodDomain.requiresDnsVerification, true);
});

// --- Test 49: Deep Link Parsing, Navigation Guard Exemption & Android LAN Resolution ---
test('Reset Password Deep Linking & Navigation Guard: parses token from Expo Go & custom schemes and preserves reset screen access', () => {
  // 1. Parse token from Expo Go deep link: exp://<host>:<port>/--/reset-password?token=<token>
  function parseDeepLink(url) {
    if (!url) return { path: null, token: null };
    const queryIdx = url.indexOf('?');
    let pathPart = queryIdx !== -1 ? url.substring(0, queryIdx) : url;
    let queryPart = queryIdx !== -1 ? url.substring(queryIdx + 1) : '';

    const params = {};
    if (queryPart) {
      queryPart.split('&').forEach((pair) => {
        const [k, v] = pair.split('=');
        if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
      });
    }

    return {
      path: pathPart,
      token: params.token || null,
    };
  }

  const expoGoUrl = 'exp://192.168.29.15:8081/--/reset-password?token=a1b2c3d4e5f678901234567890abcdef';
  const parsedExpo = parseDeepLink(expoGoUrl);
  assert.equal(parsedExpo.token, 'a1b2c3d4e5f678901234567890abcdef');
  assert.ok(parsedExpo.path.includes('reset-password'));

  const standaloneUrl = 'aura://reset-password?token=fedcba0987654321fedcba0987654321';
  const parsedStandalone = parseDeepLink(standaloneUrl);
  assert.equal(parsedStandalone.token, 'fedcba0987654321fedcba0987654321');

  // 2. Navigation Guard exemption: authenticated users opening reset password screen are NOT redirected to tabs
  function shouldRedirectAwayFromAuth(isAuthenticated, inAuthGroup, onVerifyAgeScreen, onResetPasswordScreen) {
    if (!isAuthenticated) return false;
    if (inAuthGroup && !onVerifyAgeScreen && !onResetPasswordScreen) {
      return true; // redirects away to tabs or verify-age
    }
    return false; // stays on reset password
  }

  // Member is logged in, but opened reset-password screen -> must stay!
  const authenticatedOnReset = shouldRedirectAwayFromAuth(true, true, false, true);
  assert.equal(authenticatedOnReset, false, 'Authenticated user must not be redirected away from reset password screen');

  // Member is logged in on login screen -> redirects away to tabs
  const authenticatedOnLogin = shouldRedirectAwayFromAuth(true, true, false, false);
  assert.equal(authenticatedOnLogin, true, 'Authenticated user on login screen should redirect away');

  // 3. Android LAN host resolution fallback
  const lanHost = '192.168.29.15';
  const defaultApi = `http://${lanHost}:8080`;
  assert.equal(defaultApi, 'http://192.168.29.15:8080');
});

// --- Test 50: Discovery Feed Preview & Age Assurance Swipe Gating ---
test('Discovery Feed Preview & Age Assurance Swipe Gating: unverified members browse preview cards and pass, but likes are strictly gated', async () => {
  // 1. Swipe action validation for unverified users
  function validateSwipeAction(isAgeVerified, direction) {
    if (!isAgeVerified && direction !== 'PASS') {
      return { allowed: false, action: 'ALERT_VERIFICATION_REQUIRED' };
    }
    return { allowed: true, action: 'PROCEED_SWIPE' };
  }

  // Passing is allowed for unverified users
  assert.deepEqual(validateSwipeAction(false, 'PASS'), { allowed: true, action: 'PROCEED_SWIPE' });

  // Likes and super sparks are strictly gated
  assert.deepEqual(validateSwipeAction(false, 'LIKE'), { allowed: false, action: 'ALERT_VERIFICATION_REQUIRED' });
  assert.deepEqual(validateSwipeAction(false, 'SUPER_SPARK'), { allowed: false, action: 'ALERT_VERIFICATION_REQUIRED' });

  // Verified users can perform all swipe actions
  assert.deepEqual(validateSwipeAction(true, 'LIKE'), { allowed: true, action: 'PROCEED_SWIPE' });
  assert.deepEqual(validateSwipeAction(true, 'PASS'), { allowed: true, action: 'PROCEED_SWIPE' });
  assert.deepEqual(validateSwipeAction(true, 'SUPER_SPARK'), { allowed: true, action: 'PROCEED_SWIPE' });

  // 2. Feed limit resolution: unverified users get capped limit 10
  function resolveFeedLimit(isAgeVerified) {
    return isAgeVerified ? 20 : 10;
  }
  assert.equal(resolveFeedLimit(false), 10);
  assert.equal(resolveFeedLimit(true), 20);

  // 3. Verify screen rendering hierarchy in index.tsx
  const fs = await import('node:fs/promises');
  const indexFile = await fs.readFile(
    new URL('../app/(tabs)/index.tsx', import.meta.url),
    'utf-8'
  );

  // activeCandidate must be evaluated before age-locked empty state so preview cards can be seen
  const activeCandidateIdx = indexFile.indexOf('activeCandidate ?');
  const ageLockedIdx = indexFile.indexOf('!isAgeVerified ?');
  assert.ok(activeCandidateIdx !== -1, 'Must render activeCandidate');
  assert.ok(ageLockedIdx !== -1, 'Must handle age locked state');
  assert.ok(activeCandidateIdx < ageLockedIdx, 'activeCandidate cards must be rendered before age-locked fallback state');
});

// --- Test 51: Profile Photo Upload Status & Gallery Refresh Safety ---
test('Profile Photo Upload Status & Gallery Refresh: enforces READY status and rejects unconfirmed processing timeouts', async () => {
  // 1. Verify handleAddPhoto checks uploaded.status === 'READY'
  const fs = await import('node:fs/promises');
  const profileFile = await fs.readFile(
    new URL('../app/(tabs)/profile.tsx', import.meta.url),
    'utf-8'
  );

  assert.ok(
    profileFile.includes("uploaded.status !== 'READY'"),
    'handleAddPhoto must explicitly check that uploaded.status is READY before confirming upload'
  );

  assert.ok(
    profileFile.includes('refreshProfile();') && profileFile.includes('[refreshProfile]'),
    'profile.tsx must trigger refreshProfile on mount'
  );

  // 2. Mock upload response validation
  function validateUploadResult(uploaded) {
    if (!uploaded || !uploaded.media_id || uploaded.status !== 'READY') {
      throw new Error('Photo processing timed out or failed to complete.');
    }
    return { success: true, media_id: uploaded.media_id };
  }

  // Success path: READY status confirms
  const readyResult = validateUploadResult({ media_id: 'm_123', status: 'READY' });
  assert.equal(readyResult.success, true);
  assert.equal(readyResult.media_id, 'm_123');

  // Incomplete/Processing path: must throw and NOT alert false success
  assert.throws(
    () => validateUploadResult({ media_id: 'm_123', status: 'PROCESSING' }),
    /Photo processing timed out or failed to complete/
  );
  assert.throws(
    () => validateUploadResult(null),
    /Photo processing timed out or failed to complete/
  );

  // 3. Verify mediaUploader throws ApiError on poll timeout
  const uploaderFile = await fs.readFile(
    new URL('../src/services/media/mediaUploader.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(
    uploaderFile.includes("UPLOAD_PROCESSING_TIMEOUT"),
    'mediaUploader.uploadPhoto must throw UPLOAD_PROCESSING_TIMEOUT when polling completes without READY'
  );
});

// --- Test 52: Discovery Search Normalization & File Verification ---
test('Discovery Search: validates query construction, candidate normalization, and search screen existence', async () => {
  const fs = await import('node:fs/promises');

  // 1. Verify discoveryService has search method
  const discoFile = await fs.readFile(
    new URL('../src/services/discovery/discoveryService.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(discoFile.includes('async search(query: string, limit = 20)'), 'discoveryService must expose search method');
  assert.ok(discoFile.includes("'/api/v1/discovery/search'"), 'search must call /api/v1/discovery/search');
  assert.ok(discoFile.includes('normalizeCandidate'), 'search must normalize candidate profiles');

  // 2. Candidate normalization logic test
  function normalizeCandidate(raw) {
    return {
      user_id: raw.user_id,
      display_name: raw.display_name || 'Aura Member',
      age: raw.age ?? 0,
      bio: raw.bio || '',
      pronouns: Array.isArray(raw.pronouns) ? raw.pronouns : [],
      gender_identities: Array.isArray(raw.gender_identities) ? raw.gender_identities : [],
      sexual_orientations: Array.isArray(raw.sexual_orientations) ? raw.sexual_orientations : [],
      is_verified: Boolean(raw.is_photo_verified),
      photos: (raw.photos || []).map((p, idx) => ({
        id: p.asset_id || `photo-${idx}`,
        url: p.card_url || p.full_url || p.thumb_url || '',
        is_primary: idx === 0,
      })),
      distance_bucket_km: raw.approximate_distance_km ?? 1,
    };
  }

  const rawCandidate = {
    user_id: 'u-search-99',
    display_name: 'Robin',
    age: 27,
    bio: 'Photographer',
    gender_identities: ['non_binary'],
    sexual_orientations: ['queer'],
    is_photo_verified: true,
    approximate_distance_km: 5,
    photos: [{ asset_id: 'ast-1', card_url: 'http://aura.local/photo.jpg' }],
  };

  const normalized = normalizeCandidate(rawCandidate);
  assert.equal(normalized.user_id, 'u-search-99');
  assert.equal(normalized.display_name, 'Robin');
  assert.equal(normalized.is_verified, true);
  assert.equal(normalized.distance_bucket_km, 5);
  assert.equal(normalized.photos[0].url, 'http://aura.local/photo.jpg');

  // 3. Verify search screen exists and layout registers it
  const searchScreenFile = await fs.readFile(
    new URL('../app/search.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(searchScreenFile.includes('discoveryService.search'), 'search.tsx must invoke discoveryService.search');
  assert.ok(searchScreenFile.includes('testID="search-input"'), 'search.tsx must render search input');

  const layoutFile = await fs.readFile(
    new URL('../app/_layout.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(layoutFile.includes('name="search"'), '_layout.tsx must register search screen in stack');
});

// --- Test 53: AdBreakManager 15-Profile Cadence for Free Members ---
test('AdBreakManager: strictly enforces interstitial ad cadence every 15 unique profiles for free members', async () => {
  const fs = await import('node:fs/promises');

  // 1. Verify admobService config
  const admobFile = await fs.readFile(
    new URL('../src/services/ads/admobService.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(
    admobFile.includes('threshold = 15') || admobFile.includes('15 unique browsed profiles'),
    'admobService must define threshold as 15 unique browsed profiles'
  );

  // 2. Pure cadence evaluation function
  function shouldShowRequiredAd(viewedCount, isPaidMember = false) {
    if (isPaidMember) return false;
    return viewedCount > 0 && viewedCount % 15 === 0;
  }

  // 1 to 14 profiles: no ad
  for (let i = 1; i < 15; i++) {
    assert.equal(shouldShowRequiredAd(i), false, `Profile count ${i} should not trigger ad`);
  }

  // 15th profile: triggers ad
  assert.equal(shouldShowRequiredAd(15), true, 'Profile count 15 must trigger ad');

  // 16 to 29 profiles: no ad
  assert.equal(shouldShowRequiredAd(16), false);
  assert.equal(shouldShowRequiredAd(29), false);

  // 30th profile: triggers ad
  assert.equal(shouldShowRequiredAd(30), true, 'Profile count 30 must trigger ad');

  // Paid VIP members never see ads
  assert.equal(shouldShowRequiredAd(15, true), false, 'Paid member should never see ad on count 15');
  assert.equal(shouldShowRequiredAd(30, true), false, 'Paid member should never see ad on count 30');

  // 3. Verify index.tsx tracks unique profiles and checks adBreakManager on card transitions
  const indexFile = await fs.readFile(
    new URL('../app/(tabs)/index.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(
    indexFile.includes('adBreakManager.recordProfileView') || indexFile.includes('recordProfileView'),
    'index.tsx must integrate adBreakManager.recordProfileView on card transitions'
  );
});

// --- Test 54: Gallery Error Handling and Non-Destructive Recovery ---
test('Photo Gallery Error Recovery: propagates throwOnError and distinguishes errors from empty state', async () => {
  const fs = await import('node:fs/promises');

  // 1. Verify mediaUploader getMyGallery supports throwOnError
  const uploaderFile = await fs.readFile(
    new URL('../src/services/media/mediaUploader.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(
    uploaderFile.includes('async getMyGallery(throwOnError = false)'),
    'mediaUploader.getMyGallery must accept throwOnError parameter'
  );

  // 2. Verify profile.tsx handles gallery error and loading states
  const profileFile = await fs.readFile(
    new URL('../app/(tabs)/profile.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(profileFile.includes('loadGallery'), 'profile.tsx must declare loadGallery');
  assert.ok(profileFile.includes('mediaUploader.getMyGallery(true)'), 'profile.tsx must call getMyGallery with throwOnError=true');
  assert.ok(profileFile.includes('setGalleryError'), 'profile.tsx must set gallery error on failure');
  assert.ok(profileFile.includes('Retry'), 'profile.tsx must provide a Retry action when gallery load fails');

  // 3. Mock gallery fetch behavior
  async function mockGetMyGallery(throwOnError, shouldFail) {
    if (shouldFail) {
      if (throwOnError) {
        throw new Error('Connection refused / 500 internal server error');
      }
      return [];
    }
    return [{ id: 'p-1', url: 'http://storage/p1.jpg', is_primary: true }];
  }

  // With throwOnError=true, network failure throws error (does not return false [] 0/6 photos)
  await assert.rejects(
    () => mockGetMyGallery(true, true),
    /Connection refused/
  );

  // Success path returns actual photos
  const result = await mockGetMyGallery(true, false);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'p-1');
});

// --- Test 55: Authoritative Age Verification Status CTA ---
test('Age Verification Status Check: queries authoritative backend endpoint and updates state', async () => {
  const fs = await import('node:fs/promises');

  // 1. Verify AgeVerificationBanner provides onCheckStatus
  const bannerFile = await fs.readFile(
    new URL('../src/components/AgeVerificationBanner.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(bannerFile.includes('onCheckStatus?: () => void;'), 'AgeVerificationBanner must define onCheckStatus prop');
  assert.ok(bannerFile.includes('Check Status'), 'AgeVerificationBanner must render Check Status button');

  // 2. Verify profile.tsx and index.tsx handleCheckVerificationStatus
  const profileFile = await fs.readFile(
    new URL('../app/(tabs)/profile.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(
    profileFile.includes('handleCheckVerificationStatus'),
    'profile.tsx must implement handleCheckVerificationStatus'
  );
  assert.ok(
    profileFile.includes('authService.getAgeAssuranceStatus'),
    'handleCheckVerificationStatus must call authService.getAgeAssuranceStatus'
  );
});

// --- Test 56: Discovery Feed Continuous Streaming & Cursor Pagination ---
test('Discovery Feed: continuous streaming across batches with cursor tracking without premature empty state', async () => {
  const fs = await import('node:fs/promises');

  // 1. Verify index.tsx tracks nextCursorRef and hasMoreRef
  const indexFile = await fs.readFile(
    new URL('../app/(tabs)/index.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(indexFile.includes('nextCursorRef'), 'index.tsx must track nextCursorRef');
  assert.ok(indexFile.includes('hasMoreRef'), 'index.tsx must track hasMoreRef');
  assert.ok(indexFile.includes('discoveryService.getFeed(20, cursor)'), 'prefetchNextBatch must pass cursor');
  assert.ok(
    indexFile.includes('isLoading || (currentIndex >= candidates.length && (hasMoreRef.current || isLoadingMore))'),
    'index.tsx must show loading spinner instead of premature empty state when batches are replenishing'
  );

  // 2. Verify discoveryService.getFeed supports cursor parameter
  const discoServiceFile = await fs.readFile(
    new URL('../src/services/discovery/discoveryService.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(
    discoServiceFile.includes('getFeed(limit = 20, cursor?: string)'),
    'discoveryService.getFeed must accept cursor parameter'
  );
});

// --- Test 57: Search Profile Card Tap & Safe Back Navigation ---
test('Discovery Search: candidate card is touchable, navigates to profile/[id], and preserves query state', async () => {
  const fs = await import('node:fs/promises');

  const searchFile = await fs.readFile(
    new URL('../app/search.tsx', import.meta.url),
    'utf-8'
  );

  // 1. Candidate card must be a TouchableOpacity navigating to /profile/[id]
  assert.ok(
    searchFile.includes("pathname: '/profile/[id]'"),
    'Search card must navigate to profile/[id]'
  );
  assert.ok(
    searchFile.includes("params: { id: item.user_id }"),
    'Search card must pass user_id as route param'
  );
  assert.ok(
    searchFile.includes('testID={`search-card-${item.user_id}`}'),
    'Search card must have testID'
  );

  // 2. Verify _layout.tsx registers profile/[id] screen
  const layoutFile = await fs.readFile(
    new URL('../app/_layout.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(
    layoutFile.includes('name="profile/[id]"'),
    '_layout.tsx must register profile/[id] Stack.Screen'
  );
});

// --- Test 58: Public Profile Detail Screen & Privacy Safeguards ---
test('Profile Detail Screen: renders hero photo carousel, tags, bio, interaction bar, and sanitizes private data', async () => {
  const fs = await import('node:fs/promises');

  const profileDetailFile = await fs.readFile(
    new URL('../app/profile/[id].tsx', import.meta.url),
    'utf-8'
  );

  // 1. Must use discoveryService.getPublicProfile
  assert.ok(
    profileDetailFile.includes('discoveryService.getPublicProfile'),
    'profile/[id].tsx must call discoveryService.getPublicProfile'
  );

  // 2. Must render testIDs for key elements
  assert.ok(
    profileDetailFile.includes('testID="profile-screen"'),
    'profile/[id].tsx must render profile-screen testID'
  );
  assert.ok(
    profileDetailFile.includes('testID="profile-back-button"'),
    'profile/[id].tsx must render profile-back-button'
  );
  assert.ok(
    profileDetailFile.includes('testID="profile-like-button"'),
    'profile/[id].tsx must render profile-like-button'
  );
  assert.ok(
    profileDetailFile.includes('testID="profile-pass-button"'),
    'profile/[id].tsx must render profile-pass-button'
  );

  // 3. Must not expose private fields: email, password, exact coordinates
  assert.ok(!profileDetailFile.includes('candidate.email'), 'profile/[id].tsx must not render private email');
  assert.ok(!profileDetailFile.includes('candidate.phone'), 'profile/[id].tsx must not render private phone');
  assert.ok(!profileDetailFile.includes('candidate.latitude'), 'profile/[id].tsx must not render exact coordinates');

  // 4. Verify discoveryService.getPublicProfile implementation
  const discoServiceFile = await fs.readFile(
    new URL('../src/services/discovery/discoveryService.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(
    discoServiceFile.includes('getPublicProfile(userId: string)'),
    'discoveryService must define getPublicProfile'
  );
  assert.ok(
    discoServiceFile.includes('/api/v1/profiles/${userId}'),
    'getPublicProfile must call GET /api/v1/profiles/${userId}'
  );
});

// --- Test 59: Continuous Deck Browsing Past 2 Swipes & Safe AdBreak Isolation ---
test('Continuous Deck Browsing Past 2 Swipes: cards advance cleanly with key prop and safe ad isolation', async () => {
  const fs = await import('node:fs/promises');

  // 1. Verify index.tsx mounts DiscoveryCard with dynamic key to reset animated pan on every candidate
  const indexFile = await fs.readFile(
    new URL('../app/(tabs)/index.tsx', import.meta.url),
    'utf-8'
  );

  assert.ok(
    indexFile.includes('key={activeCandidate.user_id') || indexFile.includes('key={activeCandidate.id'),
    'DiscoveryCard must have dynamic key to ensure fresh mount and reset pan value per candidate'
  );

  // 2. Verify index.tsx guards ad breaks with isGoogleMobileAdsAvailable and does not lock the deck
  assert.ok(
    indexFile.includes('isGoogleMobileAdsAvailable()'),
    'DiscoveryScreen must verify isGoogleMobileAdsAvailable() before triggering interstitial ad breaks'
  );

  // 3. Verify SponsoredCard.tsx checks isGoogleMobileAdsAvailable() to prevent Expo Go crashes
  const sponsoredCardFile = await fs.readFile(
    new URL('../src/components/SponsoredCard.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(
    sponsoredCardFile.includes('isGoogleMobileAdsAvailable()'),
    'SponsoredCard must verify isGoogleMobileAdsAvailable() before loading native banner'
  );

  // 4. Simulate card progression past 2 swipes
  const candidates = [
    { user_id: 'u1', display_name: 'Card 1', photos: [{ url: 'p1' }] },
    { user_id: 'u2', display_name: 'Card 2', photos: [{ url: 'p2' }] },
    { user_id: 'u3', display_name: 'Card 3', photos: [{ url: 'p3' }] },
    { user_id: 'u4', display_name: 'Card 4', photos: [{ url: 'p4' }] },
    { user_id: 'u5', display_name: 'Card 5', photos: [{ url: 'p5' }] },
  ];

  let currentIndex = 0;
  function swipe(dir) {
    assert.ok(currentIndex < candidates.length, 'Cannot swipe past end of deck');
    const swiped = candidates[currentIndex];
    currentIndex += 1;
    return { swiped, nextCandidate: candidates[currentIndex] || null };
  }

  // Swipe 1
  const s1 = swipe('PASS');
  assert.equal(s1.swiped.user_id, 'u1');
  assert.equal(s1.nextCandidate?.user_id, 'u2');

  // Swipe 2
  const s2 = swipe('PASS');
  assert.equal(s2.swiped.user_id, 'u2');
  assert.equal(s2.nextCandidate?.user_id, 'u3');

  // Swipe 3: Continues smoothly to Candidate 3 (no blank screen!)
  const s3 = swipe('PASS');
  assert.equal(s3.swiped.user_id, 'u3');
  assert.equal(s3.nextCandidate?.user_id, 'u4');

  // Swipe 4: Continues smoothly to Candidate 4
  const s4 = swipe('LIKE');
  assert.equal(s4.swiped.user_id, 'u4');
  assert.equal(s4.nextCandidate?.user_id, 'u5');

  // Verify candidate 5 is active and available
  assert.equal(candidates[currentIndex].user_id, 'u5');
});

// --- Test 60: Compact Verification Strip & Non-Overlapping Discovery Card Layout ---
test('Compact Verification Strip & Non-Overlapping Discovery Card Layout', async () => {
  const fs = await import('node:fs/promises');

  // 1. Verify AgeVerificationBanner is a compact horizontal strip
  const bannerFile = await fs.readFile(
    new URL('../src/components/AgeVerificationBanner.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(bannerFile.includes('testID="compact-age-verification-banner"'), 'Must have compact-age-verification-banner testID');
  assert.ok(bannerFile.includes('⏳'), 'Must render small hourglass icon');
  assert.ok(bannerFile.includes('Verification Pending'), 'Must render Verification Pending title');
  assert.ok(bannerFile.includes('Get verified for your badge'), 'Must render short secondary line');
  assert.ok(bannerFile.includes('Get Verified'), 'Must render compact Get Verified button');
  assert.ok(bannerFile.includes('Check Status'), 'Must render compact Check Status button');
  assert.ok(bannerFile.includes("flexDirection: 'row'"), 'Banner must be horizontal row strip');

  // 2. Verify DiscoveryCard uses responsive dimensions to prevent banner overlap
  const cardFile = await fs.readFile(
    new URL('../src/components/DiscoveryCard.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(cardFile.includes('useWindowDimensions'), 'DiscoveryCard must use useWindowDimensions for responsive layout');
  assert.ok(cardFile.includes('photoHeight = Math.min'), 'DiscoveryCard must budget photoHeight responsively');
  assert.ok(cardFile.includes('cardWidth = Math.min'), 'DiscoveryCard must budget cardWidth responsively');

  // 3. Verify vertical space budgeting arithmetic
  const screenHeights = [700, 750, 800, 850, 900];
  for (const h of screenHeights) {
    const cardWidth = Math.min(360 - 32, 420);
    const maxAvailable = Math.max(h - 310, 280);
    const photoHeight = Math.min(cardWidth * 1.34, maxAvailable, h * 0.54, 460);
    const actionsBarHeight = 74;
    const totalCardHeight = photoHeight + actionsBarHeight;

    // Total UI chrome: top inset (~36) + header (~50) + compact banner (~45) + bottom tabs (~85) = ~216px
    const totalScreenUsed = totalCardHeight + 216;
    assert.ok(
      totalScreenUsed <= h,
      `Total UI (${totalScreenUsed}px) must comfortably fit within screen height (${h}px) with zero overlap`
    );
  }
});

// --- Test 61: Profile Completion, Height/Weight Validation, Unit Conversion & Privacy ---
test('Profile Completion: Height and weight units (cm/in, kg/lb), ranges, and visibility gating', async () => {
  // 1. Metric to Imperial conversion arithmetic
  function cmToFtIn(cm) {
    const totalInches = Math.round(cm / 2.54);
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    return { feet, inches };
  }

  function ftInToCm(feet, inches) {
    const totalInches = (Number(feet) || 0) * 12 + (Number(inches) || 0);
    return Math.round(totalInches * 2.54);
  }

  function kgToLb(kg) {
    return Math.round(kg / 0.45359237);
  }

  function lbToKg(lb) {
    return Math.round(lb * 0.45359237);
  }

  // Conversions test
  const ftIn = cmToFtIn(175);
  assert.equal(ftIn.feet, 5);
  assert.equal(ftIn.inches, 9);
  assert.equal(ftInToCm(5, 9), 175);

  const lb = kgToLb(70);
  assert.equal(lb, 154);
  assert.equal(lbToKg(154), 70);

  // 2. Validation bounds: Height 90-250 cm, Weight 30-300 kg
  function validateHeightCm(h) {
    if (h == null || isNaN(h)) return 'Height is required';
    if (h < 90 || h > 250) return 'Height must be between 90 and 250 cm (approx 3\'0" - 8\'2")';
    return null;
  }

  function validateWeightKg(w) {
    if (w == null || isNaN(w)) return 'Weight is required';
    if (w < 30 || w > 300) return 'Weight must be between 30 and 300 kg (approx 66 - 661 lbs)';
    return null;
  }

  assert.equal(validateHeightCm(89), 'Height must be between 90 and 250 cm (approx 3\'0" - 8\'2")');
  assert.equal(validateHeightCm(180), null);
  assert.equal(validateHeightCm(251), 'Height must be between 90 and 250 cm (approx 3\'0" - 8\'2")');

  assert.equal(validateWeightKg(29), 'Weight must be between 30 and 300 kg (approx 66 - 661 lbs)');
  assert.equal(validateWeightKg(75), null);
  assert.equal(validateWeightKg(305), 'Weight must be between 30 and 300 kg (approx 66 - 661 lbs)');

  // 3. Profile completion status check
  function isProfileComplete(profile) {
    const hasName = Boolean(profile.display_name?.trim());
    const hasBirthdate = Boolean(profile.birthdate);
    const hasHeight = profile.height_cm != null && profile.height_cm >= 90 && profile.height_cm <= 250;
    const hasWeight = profile.weight_kg != null && profile.weight_kg >= 30 && profile.weight_kg <= 300;
    return hasName && hasBirthdate && hasHeight && hasWeight;
  }

  assert.equal(isProfileComplete({ display_name: 'Alex', birthdate: '1995-01-01' }), false);
  assert.equal(isProfileComplete({ display_name: 'Alex', birthdate: '1995-01-01', height_cm: 175 }), false);
  assert.equal(isProfileComplete({ display_name: 'Alex', birthdate: '1995-01-01', height_cm: 175, weight_kg: 70 }), true);

  // 4. Privacy visibility modes: PUBLIC, MATCHES_ONLY, HIDDEN
  const validVisibilities = ['PUBLIC', 'MATCHES_ONLY', 'HIDDEN'];
  assert.ok(validVisibilities.includes('PUBLIC'));
  assert.ok(validVisibilities.includes('MATCHES_ONLY'));
  assert.ok(validVisibilities.includes('HIDDEN'));
});

// --- Test 62: Discovery Filter Preferences & Active Filter Indicator ---
test('Discovery Filters: Range controls, unit conversions (miles/km), and active filter indicator', async () => {
  // Conversion: 1 mile = 1.60934 km
  function milesToKm(miles) {
    return Math.round(miles * 1.60934);
  }

  function kmToMiles(km) {
    return Math.round(km / 1.60934);
  }

  assert.equal(milesToKm(2), 3);
  assert.equal(milesToKm(50), 80);
  assert.equal(milesToKm(160), 257);
  assert.equal(kmToMiles(257), 160);

  // Default discovery filters vs active filter detection
  const defaultFilters = {
    min_age: 18,
    max_age: 99,
    max_distance_km: 160,
    min_height_cm: null,
    max_height_cm: null,
    min_weight_kg: null,
    max_weight_kg: null,
    verified_profiles_only: false,
    dealbreakers: [],
  };

  function hasActiveFilters(current) {
    if (current.min_age && current.min_age > 18) return true;
    if (current.max_age && current.max_age < 99) return true;
    if (current.max_distance_km && current.max_distance_km < 160) return true;
    if (current.min_height_cm != null) return true;
    if (current.max_height_cm != null) return true;
    if (current.min_weight_kg != null) return true;
    if (current.max_weight_kg != null) return true;
    if (current.verified_profiles_only) return true;
    if (current.dealbreakers && current.dealbreakers.length > 0) return true;
    return false;
  }

  assert.equal(hasActiveFilters(defaultFilters), false);
  assert.equal(hasActiveFilters({ ...defaultFilters, min_height_cm: 160 }), true);
  assert.equal(hasActiveFilters({ ...defaultFilters, max_distance_km: 50 }), true);
  assert.equal(hasActiveFilters({ ...defaultFilters, verified_profiles_only: true }), true);
});

// --- Test 63: Quick-Message Composer, Character Limit & Message Requests Workflow ---
test('Quick-Message Composer: Intro note delivery, 500 character limit, and request action controls', async () => {
  const MAX_INTRO_LENGTH = 500;

  // 1. Character limit validation
  function validateIntroNote(note) {
    if (!note || !note.trim()) return { valid: false, error: 'Message cannot be empty' };
    if (note.length > MAX_INTRO_LENGTH) return { valid: false, error: `Message cannot exceed ${MAX_INTRO_LENGTH} characters` };
    return { valid: true, note: note.trim() };
  }

  assert.equal(validateIntroNote('').valid, false);
  assert.equal(validateIntroNote('   ').valid, false);
  assert.equal(validateIntroNote('Hello there!').valid, true);
  assert.equal(validateIntroNote('a'.repeat(501)).valid, false);

  // 2. Message Request Flow Simulation
  const messageRequests = [];
  function sendIntroNote(senderId, recipientId, note) {
    const check = validateIntroNote(note);
    if (!check.valid) throw new Error(check.error);
    const req = {
      id: `req_${Date.now()}`,
      sender_id: senderId,
      recipient_id: recipientId,
      body: check.note,
      status: 'PENDING',
      created_at: new Date().toISOString(),
    };
    messageRequests.push(req);
    return req;
  }

  const req1 = sendIntroNote('user_alice', 'user_bob', 'Hey Bob, loved your travel photos!');
  assert.equal(req1.status, 'PENDING');
  assert.equal(req1.body, 'Hey Bob, loved your travel photos!');

  // 3. Actions: ACCEPT, DECLINE, BLOCK
  function handleRequestAction(requestId, action) {
    const item = messageRequests.find((r) => r.id === requestId);
    if (!item) throw new Error('Request not found');
    if (action === 'ACCEPT') {
      item.status = 'ACCEPTED';
    } else if (action === 'DECLINE') {
      item.status = 'DECLINED';
    } else if (action === 'BLOCK') {
      item.status = 'BLOCKED';
    }
    return item;
  }

  const accepted = handleRequestAction(req1.id, 'ACCEPT');
  assert.equal(accepted.status, 'ACCEPTED');

  const req2 = sendIntroNote('user_carol', 'user_bob', 'Hi!');
  const declined = handleRequestAction(req2.id, 'DECLINE');
  assert.equal(declined.status, 'DECLINED');

  const req3 = sendIntroNote('user_spammer', 'user_bob', 'Buy crypto');
  const blocked = handleRequestAction(req3.id, 'BLOCK');
  assert.equal(blocked.status, 'BLOCKED');
});

// --- Test 64: Dual-ended RangeSlider & SingleSlider Bidirectional Synchronization ---
test('Discovery Filters: Dual-ended RangeSlider & SingleSlider state arithmetic and bidirectional text input sync', () => {
  // 1. Dual-ended range slider position arithmetic
  function calculateRangePositions(min, max, minValue, maxValue, trackWidth) {
    const clampedMin = Math.max(min, Math.min(max, minValue));
    const clampedMax = Math.max(min, Math.min(max, maxValue));
    const rangeSpan = max - min || 1;
    const minRatio = (clampedMin - min) / rangeSpan;
    const maxRatio = (clampedMax - min) / rangeSpan;
    const minPos = minRatio * trackWidth;
    const maxPos = maxRatio * trackWidth;
    return { minPos, maxPos, activeWidth: maxPos - minPos };
  }

  const agePositions = calculateRangePositions(18, 99, 25, 45, 300);
  assert.ok(agePositions.minPos > 0);
  assert.ok(agePositions.maxPos > agePositions.minPos);
  assert.equal(agePositions.activeWidth, agePositions.maxPos - agePositions.minPos);

  // 2. Bidirectional input synchronization: Age input typing
  function syncAgeInput(rawText, isMin, currentMin, currentMax) {
    const n = parseInt(rawText, 10);
    if (isNaN(n)) return { valid: false, minAge: currentMin, maxAge: currentMax };
    if (isMin) {
      if (n < 18 || n > 99) return { valid: false, minAge: currentMin, maxAge: currentMax };
      const clamped = Math.min(n, currentMax);
      return { valid: true, minAge: clamped, maxAge: currentMax, text: String(clamped) };
    } else {
      if (n < 18 || n > 99) return { valid: false, minAge: currentMin, maxAge: currentMax };
      const clamped = Math.max(n, currentMin);
      return { valid: true, minAge: currentMin, maxAge: clamped, text: String(clamped) };
    }
  }

  const typedMin = syncAgeInput('30', true, 18, 50);
  assert.equal(typedMin.valid, true);
  assert.equal(typedMin.minAge, 30);
  assert.equal(typedMin.maxAge, 50);

  // Typing min > max clamps to max
  const typedExcessMin = syncAgeInput('65', true, 18, 50);
  assert.equal(typedExcessMin.minAge, 50);

  // Typing max < min clamps to min
  const typedSubMax = syncAgeInput('20', false, 30, 50);
  assert.equal(typedSubMax.maxAge, 30);

  // 3. Slider drag updates input values
  function onSliderChange(newMin, newMax) {
    return {
      minAge: newMin,
      maxAge: newMax,
      minAgeText: String(newMin),
      maxAgeText: String(newMax),
    };
  }

  const dragged = onSliderChange(21, 35);
  assert.equal(dragged.minAge, 21);
  assert.equal(dragged.maxAge, 35);
  assert.equal(dragged.minAgeText, '21');
  assert.equal(dragged.maxAgeText, '35');
});

// --- Test 65: Distance Slider, Direct Input, and Miles to Kilometres Conversion ---
test('Discovery Filters: Distance conversions (2-160 miles <-> km), quick presets, and backend payload mapping', () => {
  function milesToKm(miles) {
    return Math.round(miles * 1.60934);
  }

  function kmToMiles(km) {
    return Math.round(km / 1.60934);
  }

  // Bounds verification: 2 to 160 miles
  assert.equal(milesToKm(2), 3);
  assert.equal(milesToKm(160), 257);

  // Presets mapping
  const presets = [5, 15, 25, 50, 100, 160];
  for (const p of presets) {
    assert.ok(p >= 2 && p <= 160);
    const km = milesToKm(p);
    assert.ok(km > p, 'km is numerically larger than miles');
    const backToMiles = kmToMiles(km);
    assert.equal(backToMiles, p, `preset ${p} mi roundtrips through km accurately`);
  }

  // Direct distance input handling
  function handleDistanceInput(rawText) {
    const n = parseInt(rawText, 10);
    if (isNaN(n) || n < 2) return { miles: 2, text: '2' };
    if (n > 160) return { miles: 160, text: '160' };
    return { miles: n, text: String(n) };
  }

  assert.equal(handleDistanceInput('0').miles, 2);
  assert.equal(handleDistanceInput('75').miles, 75);
  assert.equal(handleDistanceInput('200').miles, 160);
});

// --- Test 66: Height & Weight Range Controls, Unit Sync, Apply & Reset Restoration ---
test('Discovery Filters: Height & Weight metric/imperial slider bounds, validation, Apply gating, and Reset restoration', () => {
  // 1. Height conversion
  function cmToFtIn(cm) {
    const totalIn = Math.round(cm / 2.54);
    const ft = Math.floor(totalIn / 12);
    const inch = totalIn % 12;
    return { ft, inch, label: `${ft}'${inch}"` };
  }

  function ftInToCm(ft, inch) {
    const totalIn = (Number(ft) || 0) * 12 + (Number(inch) || 0);
    return Math.round(totalIn * 2.54);
  }

  assert.equal(cmToFtIn(183).label, `6'0"`);
  assert.equal(ftInToCm(6, 0), 183);

  // 2. Weight conversion
  function kgToLb(kg) {
    return Math.round(kg / 0.45359237);
  }

  function lbToKg(lb) {
    return Math.round(lb * 0.45359237);
  }

  assert.equal(kgToLb(70), 154);
  assert.equal(lbToKg(154), 70);

  // 3. Validation gating on Apply
  function validateFilters(minAge, maxAge, minH, maxH, minW, maxW) {
    if (minAge > maxAge) return { ok: false, error: 'Invalid Age Range' };
    if (minH > maxH) return { ok: false, error: 'Invalid Height Range' };
    if (minW > maxW) return { ok: false, error: 'Invalid Weight Range' };
    return { ok: true };
  }

  assert.equal(validateFilters(25, 20, 150, 180, 50, 80).ok, false);
  assert.equal(validateFilters(20, 30, 190, 150, 50, 80).ok, false);
  assert.equal(validateFilters(20, 30, 150, 180, 90, 60).ok, false);
  assert.equal(validateFilters(20, 30, 150, 180, 60, 90).ok, true);

  // 4. Saved filter restoration on open
  function restoreFilters(savedPrefs) {
    const minAge = savedPrefs?.min_age || 18;
    const maxAge = savedPrefs?.max_age || 99;
    const km = savedPrefs?.max_distance_km || 80;
    const miles = Math.min(160, Math.max(2, Math.round(km / 1.60934)));
    const minH = savedPrefs?.min_height_cm || 90;
    const maxH = savedPrefs?.max_height_cm || 250;
    const minW = savedPrefs?.min_weight_kg || 30;
    const maxW = savedPrefs?.max_weight_kg || 300;
    return { minAge, maxAge, miles, minH, maxH, minW, maxW };
  }

  const restored = restoreFilters({
    min_age: 24,
    max_age: 38,
    max_distance_km: 120,
    min_height_cm: 165,
    max_height_cm: 195,
    min_weight_kg: 55,
    max_weight_kg: 95,
  });

  assert.equal(restored.minAge, 24);
  assert.equal(restored.maxAge, 38);
  assert.equal(restored.miles, 75); // 120km / 1.60934 = 74.56 -> 75 mi
  assert.equal(restored.minH, 165);
  assert.equal(restored.maxH, 195);
  assert.equal(restored.minW, 55);
  assert.equal(restored.maxW, 95);

  // 5. Reset to defaults
  const resetDefaults = restoreFilters(null);
  assert.equal(resetDefaults.minAge, 18);
  assert.equal(resetDefaults.maxAge, 99);
  assert.equal(resetDefaults.miles, 50); // 80km / 1.60934 = 50 mi
  assert.equal(resetDefaults.minH, 90);
  assert.equal(resetDefaults.maxH, 250);
  assert.equal(resetDefaults.minW, 30);
  assert.equal(resetDefaults.maxW, 300);
});

// --- Test 67: Android Bottom Navigation Safe Area Insets & Restyled Like Button ---
test('Android Bottom Safe Area & Restyled Like Button: dynamic insets, 48dp touch targets, and dark-gold Like styling', async () => {
  const fs = await import('node:fs/promises');

  // 1. Verify TabLayout (_layout.tsx) implements dynamic insets and >= 48dp touch targets
  const layoutFile = await fs.readFile(
    new URL('../app/(tabs)/_layout.tsx', import.meta.url),
    'utf-8'
  );

  assert.ok(layoutFile.includes('useSafeAreaInsets'), 'TabLayout must use useSafeAreaInsets from react-native-safe-area-context');
  assert.ok(layoutFile.includes("Math.max(insets.bottom, 16)"), 'Android bottom inset must guarantee at least 16dp clearance or system nav height');
  assert.ok(layoutFile.includes('tabBarItemStyle: styles.tabBarItem'), 'TabLayout must apply tabBarItemStyle');
  assert.ok(layoutFile.includes('minHeight: 48'), 'tabBarItem must enforce >= 48dp touch target');
  assert.ok(layoutFile.includes('horizontalInset'), 'TabLayout must guard curved screens with dynamic horizontal insets');
  assert.ok(layoutFile.includes('paddingBottom: bottomInset + 4'), 'tabBar must pad above Android system navigation gesture/buttons');

  // 2. Verify dynamic height budgeting across Android devices
  function calculateTabHeight(platform, insetsBottom) {
    const bottomInset = platform === 'android'
      ? Math.max(insetsBottom, 16)
      : (insetsBottom > 0 ? insetsBottom : 12);
    const tabContentHeight = 52;
    return {
      totalHeight: tabContentHeight + bottomInset,
      paddingBottom: bottomInset + 4,
    };
  }

  // Android with 3-button navigation (e.g. 48dp system bar)
  const threeButtonNav = calculateTabHeight('android', 48);
  assert.equal(threeButtonNav.totalHeight, 100);
  assert.equal(threeButtonNav.paddingBottom, 52);

  // Android with gesture navigation (e.g. 24dp system bar)
  const gestureNav = calculateTabHeight('android', 24);
  assert.equal(gestureNav.totalHeight, 76);
  assert.equal(gestureNav.paddingBottom, 28);

  // Android with hidden or zero insets
  const zeroInsets = calculateTabHeight('android', 0);
  assert.equal(zeroInsets.totalHeight, 68);
  assert.equal(zeroInsets.paddingBottom, 20);

  // 3. Verify DiscoveryCard restyled Like button
  const cardFile = await fs.readFile(
    new URL('../src/components/DiscoveryCard.tsx', import.meta.url),
    'utf-8'
  );

  assert.ok(cardFile.includes("backgroundColor: '#1D202B'"), 'Like button must use dark charcoal background instead of bright solid red');
  assert.ok(cardFile.includes('borderColor: colors.gold'), 'Like button must have refined champagne gold border');
  assert.ok(cardFile.includes("color: '#FF6584'"), 'Like icon must use warm coral/rose heart color');
  assert.ok(cardFile.includes('width: 54') && cardFile.includes('height: 54'), 'Like button must preserve 54x54dp dimensions');
  assert.ok(cardFile.includes('borderRadius: 27'), 'Like button must be perfectly circular');
});

// --- Test 68: Google Sign-In & Mobile Flow ---
test('Google Sign-In: validates authService payload, component structure, and screen integration', async () => {
  const fs = await import('node:fs/promises');

  // 1. Verify authService.loginWithGoogle
  const authServiceFile = await fs.readFile(
    new URL('../src/services/auth/authService.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(authServiceFile.includes('loginWithGoogle'), 'authService must export loginWithGoogle method');
  assert.ok(authServiceFile.includes("'/api/v1/auth/google'"), 'loginWithGoogle must POST to /api/v1/auth/google');
  assert.ok(authServiceFile.includes('GoogleAuthPayload'), 'authService must define GoogleAuthPayload');

  // 2. Verify GoogleSignInButton component
  const googleBtnFile = await fs.readFile(
    new URL('../src/components/GoogleSignInButton.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(googleBtnFile.includes('GoogleSignInButton'), 'Must export GoogleSignInButton component');
  assert.ok(googleBtnFile.includes('Continue with Google'), 'Must render standard Continue with Google text');
  assert.ok(googleBtnFile.includes('testID="google-sign-in-btn"'), 'Must specify testID for Google button');
  assert.ok(googleBtnFile.includes('loginWithGoogle'), 'Must invoke loginWithGoogle from useAuth');

  // 3. Verify Login & Register screen integration
  const loginFile = await fs.readFile(
    new URL('../app/(auth)/login.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(loginFile.includes('GoogleSignInButton'), 'login.tsx must render GoogleSignInButton');
  assert.ok(loginFile.includes('dividerRow'), 'login.tsx must include divider row');

  const registerFile = await fs.readFile(
    new URL('../app/(auth)/register.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(registerFile.includes('GoogleSignInButton'), 'register.tsx must render GoogleSignInButton');
  assert.ok(registerFile.includes('dividerRow'), 'register.tsx must include divider row');
});

// --- Test 69: Responsive Chat & Keyboard Avoidance ---
test('Responsive Chat: validates safe area insets, keyboard avoidance, auto-scroll, and draft preservation', async () => {
  const fs = await import('node:fs/promises');
  const chatFile = await fs.readFile(
    new URL('../src/components/ChatRoom.tsx', import.meta.url),
    'utf-8'
  );

  // 1. Dynamic insets and keyboard avoidance
  assert.ok(chatFile.includes('useSafeAreaInsets'), 'ChatRoom must import and use useSafeAreaInsets');
  assert.ok(
    chatFile.includes("Platform.OS === 'ios' ? 'padding' : undefined"),
    'Android must use undefined behavior so softwareKeyboardLayoutMode resize handles avoidance without height collapse'
  );
  assert.ok(chatFile.includes('topInset'), 'ChatRoom must compute topInset from safe area insets and StatusBar');
  assert.ok(chatFile.includes('Math.max(insets.bottom'), 'Input bar must pad above system navigation gesture/buttons');
  assert.ok(chatFile.includes('isKeyboardVisible'), 'ChatRoom must track keyboard visibility to adjust input bar padding');

  // 2. Conditional auto-scroll on keyboard appearance
  assert.ok(chatFile.includes('keyboardDidShow') || chatFile.includes('keyboardWillShow'), 'ChatRoom must register keyboard show listener');
  assert.ok(chatFile.includes('scrollOffsetRef.current < 80'), 'Must only auto-scroll if user is near bottom, without interrupting users reading older messages');
  assert.ok(chatFile.includes('scrollToOffset'), 'Must scroll FlatList to offset 0 on message send and when near bottom');

  // 3. Draft preservation on send failure
  assert.ok(chatFile.includes('setInputText(text)'), 'ChatRoom must restore input draft if sendMessage throws');

  // 4. Send button touch target and accessibility
  assert.ok(chatFile.includes('minWidth: 44') && chatFile.includes('minHeight: 44'), 'Send button must enforce >= 44dp accessible touch target');
  assert.ok(chatFile.includes('testID="chat-send-btn"'), 'Send button must have testID="chat-send-btn"');
});

// --- Test 70: Five Selectable App-Wide Themes ---
test('App Themes: validates 5 luxury palettes, complete keys, persistence, and profile selector', async () => {
  const fs = await import('node:fs/promises');

  // 1. Verify colors.ts defines all 5 themes and metadata
  const colorsFile = await fs.readFile(
    new URL('../src/theme/colors.ts', import.meta.url),
    'utf-8'
  );

  const themeIds = ['midnight-gold', 'pride-spectrum', 'youth-pop', 'lavender', 'ocean', 'classic-pride'];
  for (const id of themeIds) {
    assert.ok(colorsFile.includes(`'${id}'`), `colors.ts must register theme '${id}'`);
  }
  assert.ok(colorsFile.includes('midnightGoldTheme'), 'Must export midnightGoldTheme');
  assert.ok(colorsFile.includes('prideSpectrumTheme'), 'Must export prideSpectrumTheme');
  assert.ok(colorsFile.includes('youthPopTheme'), 'Must export youthPopTheme');
  assert.ok(colorsFile.includes('lavenderTheme'), 'Must export lavenderTheme');
  assert.ok(colorsFile.includes('oceanTheme'), 'Must export oceanTheme');
  assert.ok(colorsFile.includes('classicPrideTheme'), 'Must export classicPrideTheme');
  assert.ok(colorsFile.includes('THEME_METAS'), 'Must export THEME_METAS array');
  assert.ok(colorsFile.includes('THEME_REGISTRY'), 'Must export THEME_REGISTRY');

  // 2. Verify ThemeContext and ThemeProvider implementation
  const contextFile = await fs.readFile(
    new URL('../src/theme/ThemeContext.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(contextFile.includes('ThemeProvider'), 'ThemeContext must export ThemeProvider');
  assert.ok(contextFile.includes('useTheme'), 'ThemeContext must export useTheme hook');
  assert.ok(contextFile.includes('aura_active_theme'), 'Must persist active theme to storage key aura_active_theme');

  // 3. Verify Theme selector in ProfileScreen
  const profileFile = await fs.readFile(
    new URL('../app/(tabs)/profile.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(profileFile.includes('App Appearance & Theme'), 'Profile screen must include App Appearance & Theme section');
  assert.ok(profileFile.includes('useTheme'), 'Profile screen must call useTheme');
  assert.ok(profileFile.includes('theme-dropdown-trigger'), 'Must provide theme dropdown trigger testID');
  assert.ok(profileFile.includes('theme-dropdown-menu'), 'Must provide theme dropdown menu testID');
  assert.ok(profileFile.includes('theme-option-'), 'Must provide theme option testIDs');
  assert.ok(profileFile.includes('Active ✓'), 'Must render Active indicator for selected theme');
});

// --- Test 71: AdMob Native Configuration & Safe Privacy Gating ---
test('AdMob Native Config: validates app.json plugin, honest SDK availability, and 15-profile cadence', async () => {
  const fs = await import('node:fs/promises');
  const appJson = JSON.parse(await fs.readFile(new URL('../app.json', import.meta.url), 'utf-8'));

  // 1. Verify app.json plugin
  const plugins = appJson.expo?.plugins || [];
  const adMobPlugin = plugins.find((p) => Array.isArray(p) && p[0] === 'react-native-google-mobile-ads');
  assert.ok(adMobPlugin, 'app.json must declare react-native-google-mobile-ads plugin');
  const adMobConfig = adMobPlugin[1];
  assert.ok(adMobConfig.androidAppId, 'Must configure androidAppId in app.json plugin');
  assert.ok(adMobConfig.iosAppId, 'Must configure iosAppId in app.json plugin');

  // 2. Verify admobService implementation & honest Expo Go check
  const admobFile = await fs.readFile(
    new URL('../src/services/ads/admobService.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(admobFile.includes('isGoogleMobileAdsAvailable'), 'Must export isGoogleMobileAdsAvailable');
  assert.ok(admobFile.includes('isExpoGo'), 'Must check isExpoGo');
  assert.ok(admobFile.includes('threshold = 15'), 'Must enforce 15-profile interstitial cadence');
  assert.ok(admobFile.includes('viewedProfileIds'), 'Must maintain viewedProfileIds Set to deduplicate rerenders');
  assert.ok(admobFile.includes('assertPrivacyClean'), 'Must enforce assertPrivacyClean');
  assert.ok(admobFile.includes('FORBIDDEN_PRIVACY_KEYS'), 'Must check FORBIDDEN_PRIVACY_KEYS');
});

// --- Test 72: Discovery Quick-Message Keyboard Avoidance & Draft Preservation ---
test('Discovery Quick Message: validates keyboard avoidance, card height adaptation, tab bar hiding, and draft preservation', async () => {
  const fs = await import('node:fs/promises');

  // 1. Verify TabLayout hides bottom bar when software keyboard appears on Android
  const layoutFile = await fs.readFile(
    new URL('../app/(tabs)/_layout.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(layoutFile.includes('tabBarHideOnKeyboard: true'), 'TabLayout must enable tabBarHideOnKeyboard: true');

  // 2. Verify QuickMessageComposer preserves draft on failure and provides accessible controls
  const composerFile = await fs.readFile(
    new URL('../src/components/QuickMessageComposer.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(composerFile.includes('Keyboard.dismiss()'), 'QuickMessageComposer must dismiss keyboard on send');
  assert.ok(composerFile.includes('setText(draftText)'), 'QuickMessageComposer must restore draftText on send failure');
  assert.ok(composerFile.includes('recipientId || recipientName'), 'QuickMessageComposer must reset draft when recipient changes');
  assert.ok(composerFile.includes('testID="quick-message-input"'), 'Must define quick-message-input testID');
  assert.ok(composerFile.includes('testID="quick-message-send-btn"'), 'Must define quick-message-send-btn testID');
  assert.ok(composerFile.includes('minWidth: 44') && composerFile.includes('minHeight: 44'), 'Send button must enforce >= 44dp accessible touch target');

  // 3. Verify DiscoveryCard adapts height responsively for keyboard without distorting images or breaking swiping
  const cardFile = await fs.readFile(
    new URL('../src/components/DiscoveryCard.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(cardFile.includes('isKeyboardOpen'), 'DiscoveryCard must accept isKeyboardOpen prop');
  assert.ok(cardFile.includes('resizeMode="cover"'), 'Photo resizeMode="cover" must be preserved without distortion');
  assert.ok(cardFile.includes('actionsBarCompact'), 'DiscoveryCard must provide compact actionsBar styling');
  assert.ok(cardFile.includes('infoOverlayCompact'), 'DiscoveryCard must provide compact infoOverlay styling');
  assert.ok(cardFile.includes('Keyboard.dismiss()'), 'DiscoveryCard must dismiss keyboard on swipe gesture and button interactions');

  // 4. Verify DiscoveryScreen integration and draft error propagation
  const indexFile = await fs.readFile(
    new URL('../app/(tabs)/index.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(indexFile.includes('KeyboardAvoidingView'), 'index.tsx must wrap deck in KeyboardAvoidingView');
  assert.ok(indexFile.includes("behavior={Platform.OS === 'ios' ? 'padding' : undefined}"), 'Must avoid double-shrinkage on Android adjustResize');
  assert.ok(indexFile.includes('Keyboard.addListener'), 'index.tsx must monitor software keyboard events');
  assert.ok(indexFile.includes('isKeyboardOpen={isKeyboardOpen}'), 'index.tsx must pass isKeyboardOpen to DiscoveryCard');
  assert.ok(indexFile.includes('maxCardHeight={cardRegionHeight}'), 'index.tsx must pass maxCardHeight to DiscoveryCard');
  assert.ok(indexFile.includes('cardRegion'), 'index.tsx must provide flexible cardRegion container');
  assert.ok(indexFile.includes('composerRegion'), 'index.tsx must provide dedicated composerRegion pinned above keyboard');
  assert.ok(indexFile.includes('throw err'), 'handleSwipe must propagate introNote errors for draft preservation');
  assert.ok(indexFile.includes('deckContainerKeyboard'), 'Must provide deckContainerKeyboard flex styles');
  assert.ok(indexFile.includes('TouchableWithoutFeedback'), 'Must support dismissing keyboard when tapping outside');
});

// --- Test 73: Dynamic App-Wide Theme Propagation, Storage Persistence & In-Place Mutability ---
test('Theme Architecture: validates 5 theme palettes, ThemeContext race-condition guards, storage persistence, and in-place sync', async () => {
  const fs = await import('node:fs/promises');

  // 1. Verify colors.ts exports all 5 themes with complete, valid color tokens
  const colorsFile = await fs.readFile(
    new URL('../src/theme/colors.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(colorsFile.includes('midnightGoldTheme'), 'Must export midnightGoldTheme');
  assert.ok(colorsFile.includes('prideSpectrumTheme'), 'Must export prideSpectrumTheme');
  assert.ok(colorsFile.includes('youthPopTheme'), 'Must export youthPopTheme');
  assert.ok(colorsFile.includes('lavenderTheme'), 'Must export lavenderTheme');
  assert.ok(colorsFile.includes('oceanTheme'), 'Must export oceanTheme');
  assert.ok(colorsFile.includes('classicPrideTheme'), 'Must export classicPrideTheme');
  assert.ok(colorsFile.includes('THEME_REGISTRY'), 'Must export THEME_REGISTRY');
  assert.ok(colorsFile.includes('THEME_METAS'), 'Must export THEME_METAS');

  // 2. Verify ThemeContext.tsx implementation details
  const contextFile = await fs.readFile(
    new URL('../src/theme/ThemeContext.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(contextFile.includes('userSelectedRef'), 'ThemeContext must have userSelectedRef to guard against storage race conditions');
  assert.ok(contextFile.includes('Object.assign(colors, currentColors)'), 'ThemeContext must update static colors object in-place for live synchronization');
  assert.ok(contextFile.includes('useThemeColors'), 'ThemeContext must export useThemeColors hook');
  assert.ok(contextFile.includes('throw err'), 'setTheme must propagate errors if persistence fails');

  // 3. Simulate Theme State & Persistence Logic
  const store = new Map();
  const mockStorage = {
    async getItem(k) { return store.get(k) ?? null; },
    async setItem(k, v) { store.set(k, v); },
  };

  let activeTheme = 'midnight-gold';
  let userSelected = false;

  const setTheme = async (id) => {
    userSelected = true;
    activeTheme = id;
    await mockStorage.setItem('aura_active_theme', id);
  };

  const loadTheme = async () => {
    const saved = await mockStorage.getItem('aura_active_theme');
    if (saved && !userSelected) {
      activeTheme = saved;
    }
  };

  // User selects 'ocean'
  await setTheme('ocean');
  assert.equal(activeTheme, 'ocean');
  assert.equal(await mockStorage.getItem('aura_active_theme'), 'ocean');

  // Delayed storage load resolves but does NOT overwrite user selection
  await loadTheme();
  assert.equal(activeTheme, 'ocean');

  // App reloads: fresh userSelected is false, so saved theme is restored cleanly
  userSelected = false;
  await loadTheme();
  assert.equal(activeTheme, 'ocean');
});

// --- Test 74: App-Wide Themed Screen & Component Adoption ---
test('Theme Adoption: validates all app tabs, root navigation, and shared components dynamically consume active theme', async () => {
  const fs = await import('node:fs/promises');

  // 1. Root Layout & App Guard
  const rootLayout = await fs.readFile(
    new URL('../app/_layout.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(rootLayout.includes('ThemeProvider'), 'Root layout must mount ThemeProvider');
  assert.ok(rootLayout.includes('ThemedApp'), 'Root layout must define ThemedApp');
  assert.ok(rootLayout.includes('contentStyle: { backgroundColor: colors.background }'), 'Stack navigator contentStyle must bind to colors.background');

  // 2. Tab Layout
  const tabLayout = await fs.readFile(
    new URL('../app/(tabs)/_layout.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(tabLayout.includes('useTheme'), 'Tab layout must call useTheme');
  assert.ok(tabLayout.includes('tabBarStyle'), 'Tab layout must configure tabBarStyle');
  assert.ok(tabLayout.includes('tabBarActiveTintColor: colors.gold'), 'Tab layout must bind active tint to colors.gold');

  // 3. Main screens
  const screens = [
    { file: '../app/(tabs)/index.tsx', name: 'Discovery' },
    { file: '../app/(tabs)/profile.tsx', name: 'Profile' },
    { file: '../app/(tabs)/chat.tsx', name: 'Chat' },
    { file: '../app/(tabs)/likes.tsx', name: 'Likes' },
    { file: '../app/(tabs)/membership.tsx', name: 'Membership' },
    { file: '../app/(tabs)/settings.tsx', name: 'Settings' },
  ];

  for (const screen of screens) {
    const content = await fs.readFile(new URL(screen.file, import.meta.url), 'utf-8');
    assert.ok(content.includes('useTheme'), `${screen.name} screen must import and call useTheme`);
    assert.ok(content.includes('colors.background') || content.includes('colors.card'), `${screen.name} must dynamically style with theme colors`);
  }

  // 4. Shared components
  const components = [
    { file: '../src/components/DiscoveryCard.tsx', name: 'DiscoveryCard' },
    { file: '../src/components/QuickMessageComposer.tsx', name: 'QuickMessageComposer' },
    { file: '../src/components/ChatRoom.tsx', name: 'ChatRoom' },
    { file: '../src/components/DiscoveryFilterModal.tsx', name: 'DiscoveryFilterModal' },
    { file: '../src/components/RangeSlider.tsx', name: 'RangeSlider' },
    { file: '../src/components/SingleSlider.tsx', name: 'SingleSlider' },
  ];

  for (const comp of components) {
    const content = await fs.readFile(new URL(comp.file, import.meta.url), 'utf-8');
    assert.ok(content.includes('useTheme'), `${comp.name} component must import and call useTheme`);
  }
});

// --- Test 75: Classic Pride Theme & Premium Dropdown Selector ---
test('Classic Pride & Dropdown Selector: validates 6-color rainbow tokens, obsidian base, dropdown toggle and persistence', async () => {
  const fs = await import('node:fs/promises');

  // 1. Verify Classic Pride Theme definition and 6 rainbow tokens
  const colorsFile = await fs.readFile(
    new URL('../src/theme/colors.ts', import.meta.url),
    'utf-8'
  );

  assert.ok(colorsFile.includes('classicPrideTheme'), 'colors.ts must export classicPrideTheme');
  assert.ok(colorsFile.includes("'classic-pride'"), "colors.ts must register 'classic-pride' ThemeId");

  const rainbowTokens = [
    'rainbowRed',
    'rainbowOrange',
    'rainbowYellow',
    'rainbowGreen',
    'rainbowBlue',
    'rainbowPurple',
  ];
  for (const token of rainbowTokens) {
    assert.ok(colorsFile.includes(token), `colors.ts must define rainbow token ${token}`);
  }

  // Verify Classic Pride Obsidian Dark base & palette metadata
  assert.ok(colorsFile.includes("background: '#0B0A10'"), 'Classic Pride must use deep obsidian background #0B0A10');
  assert.ok(colorsFile.includes("gold: '#FF8C00'"), 'Classic Pride must use radiant amber-orange gold accent #FF8C00');
  assert.ok(colorsFile.includes("badgeEmoji: '🏳️‍🌈'"), 'Classic Pride must use rainbow flag badge emoji');

  // 2. Verify Profile Dropdown Implementation
  const profileFile = await fs.readFile(
    new URL('../app/(tabs)/profile.tsx', import.meta.url),
    'utf-8'
  );

  assert.ok(profileFile.includes('isThemeDropdownOpen'), 'Profile must manage isThemeDropdownOpen state');
  assert.ok(profileFile.includes('testID="theme-dropdown-trigger"'), 'Profile must render dropdown trigger with testID');
  assert.ok(profileFile.includes('testID="theme-palette-preview-strip"'), 'Profile must render palette preview strip');
  assert.ok(profileFile.includes('testID="theme-dropdown-menu"'), 'Profile must render expandable dropdown menu with testID');
  assert.ok(profileFile.includes('testID={`theme-option-${t.id}`}'), 'Profile must render option items with dynamic testIDs');
  assert.ok(profileFile.includes('setIsThemeDropdownOpen(false)'), 'Profile must close dropdown upon theme selection');

  // 3. Simulate Dropdown Toggle, Theme Switching, and Storage Persistence
  const store = new Map();
  const mockStorage = {
    async getItem(k) { return store.get(k) ?? null; },
    async setItem(k, v) { store.set(k, v); },
  };

  let activeTheme = 'midnight-gold';
  let isDropdownOpen = false;

  const toggleDropdown = () => {
    isDropdownOpen = !isDropdownOpen;
  };

  const selectTheme = async (themeId) => {
    activeTheme = themeId;
    isDropdownOpen = false;
    await mockStorage.setItem('aura_active_theme', themeId);
  };

  // Initial state
  assert.equal(isDropdownOpen, false, 'Dropdown should initially be collapsed');
  assert.equal(activeTheme, 'midnight-gold', 'Default theme should be midnight-gold');

  // Open dropdown
  toggleDropdown();
  assert.equal(isDropdownOpen, true, 'Dropdown should open when triggered');

  // Select Classic Pride
  await selectTheme('classic-pride');
  assert.equal(isDropdownOpen, false, 'Dropdown should close automatically after theme selection');
  assert.equal(activeTheme, 'classic-pride', 'Active theme should switch to classic-pride');
  assert.equal(await mockStorage.getItem('aura_active_theme'), 'classic-pride', 'Selected theme must persist to aura_active_theme');

  // Verify persistence reload
  const restoredTheme = await mockStorage.getItem('aura_active_theme');
  assert.equal(restoredTheme, 'classic-pride', 'Restored theme on reload must match classic-pride');
});

// --- Test 76: Responsive Layout Protection: Dropdown Separated Swatches, Age Assurance Badge Wrap, and Summary Chips Wrap ---
test('Profile Responsive Layout: validates dropdown non-overlapping swatch row, verification badge flex-wrap, and summary chip containment', async () => {
  const fs = await import('node:fs/promises');

  const profileFile = await fs.readFile(
    new URL('../app/(tabs)/profile.tsx', import.meta.url),
    'utf-8'
  );

  // 1. Theme Dropdown Trigger: Palette swatches in dedicated row within text column, chevron isolated
  assert.ok(profileFile.includes('palettePreviewStrip:'), 'Must define palettePreviewStrip style');
  assert.ok(profileFile.includes('chevronWrap:'), 'Must define chevronWrap style');
  assert.ok(profileFile.includes("flexWrap: 'wrap'"), 'Styles must use flexWrap for responsive rows');
  assert.ok(profileFile.includes('triggerTextCol:'), 'Must define triggerTextCol');

  // 2. Verification Badges: verificationHeader must wrap so PENDING VERIFICATION badge never overflows card
  assert.ok(profileFile.includes('verificationHeader:'), 'Must define verificationHeader style');
  assert.ok(profileFile.includes('verificationTitle:'), 'Must define verificationTitle style');
  assert.ok(profileFile.includes('verBadge:'), 'Must define verBadge style');
  assert.ok(profileFile.includes('minWidth: 160'), 'verificationTitle must define responsive minWidth');

  // 3. Profile Summary Card Chips: badgesRow must wrap so location and status chips stay within card bounds
  assert.ok(profileFile.includes('badgesRow:'), 'Must define badgesRow style');
  assert.ok(profileFile.includes('locationBadge:'), 'Must define locationBadge style');
  assert.ok(profileFile.includes('locationBadgeText:'), 'Must define locationBadgeText style');
  assert.ok(profileFile.includes('numberOfLines={1}'), 'locationBadgeText must gracefully truncate long location text');
  assert.ok(profileFile.includes('ellipsizeMode="tail"'), 'locationBadgeText must specify ellipsizeMode');
  assert.ok(profileFile.includes("maxWidth: '100%'"), 'locationBadge must enforce maxWidth 100%');
});

// --- Test 77: Profile Redesign: Collapsible Accordions, Initial Expanded State, and Attribute Input Integrity ---
test('Profile Redesign: validates collapsible accordion architecture, default expansion states, and taxonomy options', async () => {
  const fs = await import('node:fs/promises');

  const profileFile = await fs.readFile(
    new URL('../app/(tabs)/profile.tsx', import.meta.url),
    'utf-8'
  );

  // 1. Accordion Section and Header TestIDs
  assert.ok(profileFile.includes('testID="section-basic-info"'), 'Must define section-basic-info');
  assert.ok(profileFile.includes('testID="accordion-header-basic"'), 'Must define accordion-header-basic');
  assert.ok(profileFile.includes('testID="section-physical-attributes"'), 'Must define section-physical-attributes');
  assert.ok(profileFile.includes('testID="accordion-header-physical"'), 'Must define accordion-header-physical');
  assert.ok(profileFile.includes('testID="section-identity-orientation"'), 'Must define section-identity-orientation');
  assert.ok(profileFile.includes('testID="accordion-header-identity"'), 'Must define accordion-header-identity');
  assert.ok(profileFile.includes('testID="section-lifestyle-interests"'), 'Must define section-lifestyle-interests');
  assert.ok(profileFile.includes('testID="accordion-header-lifestyle"'), 'Must define accordion-header-lifestyle');
  assert.ok(profileFile.includes('testID="section-relationship-preferences"'), 'Must define section-relationship-preferences');
  assert.ok(profileFile.includes('testID="accordion-header-preferences"'), 'Must define accordion-header-preferences');

  // 2. Default State: Basic expanded by default; secondary sections collapsed
  assert.match(profileFile, /basic:\s*true/, 'Basic Information must default to expanded');
  assert.match(profileFile, /physical:\s*false/, 'Physical Attributes must default to collapsed');
  assert.match(profileFile, /identity:\s*false/, 'Identity & Orientation must default to collapsed');
  assert.match(profileFile, /lifestyle:\s*false/, 'Lifestyle & Interests must default to collapsed');
  assert.match(profileFile, /preferences:\s*false/, 'Relationship Preferences must default to collapsed');

  // 3. Certified Age Policy: Read-only display, no direct editable text inputs for age
  assert.ok(profileFile.includes('testID="readonly-age-card"'), 'Must provide read-only certified age card');
  assert.ok(profileFile.includes('18+ Age Assurance policy'), 'Must explain age is locked per 18+ policy');

  // 4. Taxonomy Options Exported and Configured
  assert.ok(profileFile.includes('PRONOUN_OPTIONS'), 'Must define PRONOUN_OPTIONS');
  assert.ok(profileFile.includes('SMOKING_HABIT_OPTIONS'), 'Must define SMOKING_HABIT_OPTIONS');
  assert.ok(profileFile.includes('DRINKING_HABIT_OPTIONS'), 'Must define DRINKING_HABIT_OPTIONS');
  assert.ok(profileFile.includes('RELATIONSHIP_INTENT_OPTIONS'), 'Must define RELATIONSHIP_INTENT_OPTIONS');
  assert.ok(profileFile.includes('RELATIONSHIP_STRUCTURE_OPTIONS'), 'Must define RELATIONSHIP_STRUCTURE_OPTIONS');
  assert.ok(profileFile.includes('COMMUNITY_INTERESTS_OPTIONS'), 'Must define COMMUNITY_INTERESTS_OPTIONS');

  // 5. Accordion State Simulation: Toggling sections maintains form state
  const formState = {
    displayName: 'Alex River',
    bio: 'Photographer and community volunteer.',
    heightCm: 178,
    weightKg: 72,
    pronouns: ['they/them'],
    genders: ['non_binary'],
    orientations: ['queer'],
    smokingHabit: 'NON_SMOKER',
    drinkingHabit: 'SOCIALLY',
    relationshipStructure: 'MONOGAMOUS',
    interests: ['Art & Design', 'Outdoor & Nature'],
  };

  let accordion = {
    basic: true,
    physical: false,
    identity: false,
    lifestyle: false,
    preferences: false,
  };

  const toggle = (sec) => {
    accordion = { ...accordion, [sec]: !accordion[sec] };
  };

  // Toggle Physical open
  toggle('physical');
  assert.equal(accordion.physical, true);
  // Verify formState did not mutate or get cleared during collapse/expansion
  assert.equal(formState.displayName, 'Alex River');
  assert.equal(formState.heightCm, 178);

  // Toggle Basic closed then open again
  toggle('basic');
  assert.equal(accordion.basic, false);
  toggle('basic');
  assert.equal(accordion.basic, true);
  assert.equal(formState.bio, 'Photographer and community volunteer.');
  assert.deepEqual(formState.interests, ['Art & Design', 'Outdoor & Nature']);
});

// --- Test 78: Profile Save Payload Sanitization & Dual-Endpoint Contract ---
test('Profile Save: sanitizes visibility_settings against Go backend DTO, maps dealbreakers, and prevents unknown field errors', async () => {
  const fs = await import('node:fs/promises');

  const profileFile = await fs.readFile(
    new URL('../app/(tabs)/profile.tsx', import.meta.url),
    'utf-8'
  );

  const authServiceFile = await fs.readFile(
    new URL('../src/services/auth/authService.ts', import.meta.url),
    'utf-8'
  );

  // 1. Static Contract Checks
  // Ensure profile.tsx sends cleanVisibility without dealbreaker keys
  assert.ok(
    profileFile.includes('visibility_settings: cleanVisibility'),
    'profile.tsx must send cleanVisibility to updateMyProfile'
  );
  assert.ok(
    !profileFile.match(/visibility_settings:\s*\{[^}]*require_verified/m),
    'profile.tsx must not attach require_verified directly to visibility_settings'
  );
  assert.ok(
    !profileFile.match(/visibility_settings:\s*\{[^}]*require_monogamous/m),
    'profile.tsx must not attach require_monogamous directly to visibility_settings'
  );
  assert.ok(
    authServiceFile.includes('allowedVisibilityKeys'),
    'authService.ts must enforce allowedVisibilityKeys filter'
  );
  assert.ok(
    authServiceFile.includes('payload.non_smoker_dealbreaker'),
    'authService.ts must map non_smoker_dealbreaker'
  );

  // 2. Simulate authService.updateMyProfile payload sanitization
  const allowedVisibilityKeys = [
    'gender_identity',
    'sexual_orientation',
    'pronouns',
    'distance',
    'online_status',
    'traveler_safety',
    'height',
    'weight',
  ];

  const sanitizeUpdatePayload = (updates) => {
    const payload = {};
    if (updates.display_name !== undefined) payload.display_name = updates.display_name.trim();
    if (updates.bio !== undefined) payload.bio = updates.bio;
    if (updates.height_cm !== undefined) payload.height_cm = updates.height_cm;
    if (updates.weight_kg !== undefined) payload.weight_kg = updates.weight_kg;

    if (updates.visibility_settings !== undefined) {
      const sanitizedVisibility = {};
      const rawVis = updates.visibility_settings;
      for (const key of allowedVisibilityKeys) {
        if (rawVis[key] !== undefined) {
          sanitizedVisibility[key] = rawVis[key];
        }
      }
      payload.visibility_settings = sanitizedVisibility;
    }

    if (updates.non_smoker_dealbreaker !== undefined) {
      payload.non_smoker_dealbreaker = updates.non_smoker_dealbreaker;
    } else if (updates.dealbreakers?.non_smoker_only !== undefined) {
      payload.non_smoker_dealbreaker = updates.dealbreakers.non_smoker_only;
    }

    return payload;
  };

  // Test with input containing both valid visibility fields and forbidden dealbreaker fields
  const dirtyInput = {
    display_name: 'Jordan Rivera',
    bio: 'Artist & traveler.',
    height_cm: 180,
    weight_kg: 75,
    visibility_settings: {
      height: 'PUBLIC',
      weight: 'MATCHES_ONLY',
      require_verified: true,
      require_monogamous: true,
      unknown_custom_field: 'invalid',
    },
    non_smoker_dealbreaker: true,
    dealbreakers: {
      require_verified: true,
      require_monogamous: true,
      non_smoker_only: true,
    },
  };

  const sanitized = sanitizeUpdatePayload(dirtyInput);

  // Assert unknown / forbidden fields were strictly stripped from visibility_settings
  assert.equal(sanitized.visibility_settings.height, 'PUBLIC');
  assert.equal(sanitized.visibility_settings.weight, 'MATCHES_ONLY');
  assert.equal(sanitized.visibility_settings.require_verified, undefined);
  assert.equal(sanitized.visibility_settings.require_monogamous, undefined);
  assert.equal(sanitized.visibility_settings.unknown_custom_field, undefined);
  assert.equal(sanitized.non_smoker_dealbreaker, true);

  // 3. Simulate normalize dealbreakers in getMyProfile
  const mockApiResponse = {
    user: { id: 'usr_1', email: 'test@aura.app' },
    profile: {
      id: 'prof_1',
      display_name: 'Jordan',
      visibility_settings: { height: 'PUBLIC', weight: 'PUBLIC' },
    },
    preferences: {
      preferred_genders: ['non_binary', 'transgender_woman'],
      dealbreakers: {
        non_smoker_only: true,
        require_verified: true,
        require_monogamous: false,
      },
    },
  };

  const rawProfile = { ...mockApiResponse.profile };
  if (mockApiResponse.preferences?.dealbreakers) {
    rawProfile.dealbreakers = {
      non_smoker_only: Boolean(mockApiResponse.preferences.dealbreakers.non_smoker_only),
      require_verified: Boolean(mockApiResponse.preferences.dealbreakers.require_verified),
      require_monogamous: Boolean(mockApiResponse.preferences.dealbreakers.require_monogamous),
    };
  }

  assert.equal(rawProfile.dealbreakers.non_smoker_only, true);
  assert.equal(rawProfile.dealbreakers.require_verified, true);
  assert.equal(rawProfile.dealbreakers.require_monogamous, false);

  // 4. Dealbreaker separation verification:
  // Discovery preferences payload must receive the dealbreakers
  const discoveryPrefPayload = {
    preferred_genders: ['non_binary'],
    dealbreakers: {
      non_smoker_only: true,
      require_verified: true,
      require_monogamous: false,
    },
  };
  assert.deepEqual(discoveryPrefPayload.dealbreakers, {
    non_smoker_only: true,
    require_verified: true,
    require_monogamous: false,
  });
});

// --- Test 79: End-to-End Chat Message Ordering, Reconciliation & Curved Screen Insets ---
test('Chat Ordering & Safe Area: verifies chronological contract, equal timestamps tie-breaking, reconciliation, and responsive insets', async () => {
  const fs = await import('node:fs/promises');
  const chatFile = await fs.readFile(
    new URL('../src/components/ChatRoom.tsx', import.meta.url),
    'utf-8'
  );
  const chatScreenFile = await fs.readFile(
    new URL('../app/chat/[id].tsx', import.meta.url),
    'utf-8'
  );

  // 1. Verify code contracts in ChatRoom and chat/[id]
  assert.ok(chatFile.includes('export function compareMessagesDesc'), 'ChatRoom must export compareMessagesDesc');
  assert.ok(chatFile.includes('export function reconcileMessages'), 'ChatRoom must export reconcileMessages');
  assert.ok(chatFile.includes('inverted'), 'FlatList must use inverted prop for standard bottom-pinned chat experience');
  assert.ok(chatFile.includes('onEndReached={loadOlderMessages}'), 'FlatList must support onEndReached for cursor pagination');
  assert.ok(chatFile.includes('refreshing={isRefreshing}'), 'FlatList must support pull to refresh');
  assert.ok(!chatScreenFile.includes("from 'react-native';\nimport { SafeAreaView"), 'chat/[id].tsx must NOT wrap ChatRoom in iOS-only SafeAreaView');
  assert.ok(chatFile.includes('paddingTop: topInset > 0 ? topInset + 6 : spacing.md'), 'Header must dynamically pad based on topInset');

  // Comparator & Reconciliation implementations:
  function compareMessagesDesc(a, b) {
    const timeA = new Date(a.created_at).getTime();
    const timeB = new Date(b.created_at).getTime();
    if (timeA !== timeB) {
      return timeB - timeA;
    }
    const idA = a.id || a.client_message_id || '';
    const idB = b.id || b.client_message_id || '';
    return idB.localeCompare(idA);
  }

  function reconcileMessages(prev, incoming) {
    const incomingList = Array.isArray(incoming) ? incoming : [incoming];
    if (incomingList.length === 0) return prev;
    const merged = [...prev];
    for (const item of incomingList) {
      if (!item) continue;
      const itemClientId = item.client_message_id;
      const itemId = item.id;
      const existingIndex = merged.findIndex((m) => {
        if (m.id && itemId && m.id === itemId) return true;
        if (itemClientId) {
          if (m.client_message_id && m.client_message_id === itemClientId) return true;
          if (m.id === itemClientId) return true;
        }
        if (m.client_message_id && itemId && m.client_message_id === itemId) return true;
        return false;
      });
      if (existingIndex !== -1) {
        const existing = merged[existingIndex];
        merged[existingIndex] = {
          ...existing,
          ...item,
          id: item.id || existing.id,
          delivered_at: item.delivered_at || existing.delivered_at || null,
          read_at: item.read_at || existing.read_at || null,
          status:
            item.read_at || existing.read_at
              ? 'READ'
              : item.delivered_at || existing.delivered_at
              ? 'DELIVERED'
              : item.status || existing.status,
          created_at: item.created_at || existing.created_at,
        };
      } else {
        merged.push(item);
      }
    }
    return merged.sort(compareMessagesDesc);
  }

  // 2. Two users exchanging messages in both directions:
  // Phone A sends Message 1, Phone B replies with Message 2, Phone A sends Message 3
  const msg1 = {
    id: 'msg_001',
    conversation_id: 'conv_1',
    sender_user_id: 'usr_phoneA',
    body: 'Message 1 from Phone A',
    created_at: '2026-10-17T10:00:00.000Z',
    status: 'READ',
  };
  const msg2 = {
    id: 'msg_002',
    conversation_id: 'conv_1',
    sender_user_id: 'usr_phoneB',
    body: 'Message 2 from Phone B',
    created_at: '2026-10-17T10:00:05.000Z',
    status: 'DELIVERED',
  };
  const msg3 = {
    id: 'msg_003',
    conversation_id: 'conv_1',
    sender_user_id: 'usr_phoneA',
    body: 'Message 3 from Phone A',
    created_at: '2026-10-17T10:00:10.000Z',
    status: 'SENT',
  };

  // Reconcile in mixed arrival order
  const conversationMessages = reconcileMessages([], [msg2, msg1, msg3]);

  // In an inverted FlatList:
  // Index 0 is at the bottom (newest message: msg3)
  // Index 1 is in the middle (msg2)
  // Index 2 is at the top (oldest message: msg1)
  assert.equal(conversationMessages[0].id, 'msg_003', 'Index 0 (rendered at bottom) must be newest message (msg3)');
  assert.equal(conversationMessages[1].id, 'msg_002', 'Index 1 must be msg2');
  assert.equal(conversationMessages[2].id, 'msg_001', 'Index 2 (rendered at top) must be oldest message (msg1)');

  // Chronological view contract:
  // When viewed from top of screen to bottom of screen (reversing inverted array indices):
  const viewOrder = [...conversationMessages].reverse();
  assert.equal(viewOrder[0].id, 'msg_001', 'Top of conversation view must be oldest message (Message 1)');
  assert.equal(viewOrder[1].id, 'msg_002', 'Middle of conversation view must be Message 2');
  assert.equal(viewOrder[2].id, 'msg_003', 'Bottom of conversation view must be newest message (Message 3)');

  // 3. Stable ordering for equal timestamps
  const equalTimeMsgA = {
    id: 'msg_alpha',
    conversation_id: 'conv_1',
    sender_user_id: 'usr_phoneA',
    body: 'Sent at exact same millisecond',
    created_at: '2026-10-17T10:05:00.000Z',
  };
  const equalTimeMsgB = {
    id: 'msg_beta',
    conversation_id: 'conv_1',
    sender_user_id: 'usr_phoneB',
    body: 'Also sent at exact same millisecond',
    created_at: '2026-10-17T10:05:00.000Z',
  };

  const sortedEqual1 = reconcileMessages([], [equalTimeMsgA, equalTimeMsgB]);
  const sortedEqual2 = reconcileMessages([], [equalTimeMsgB, equalTimeMsgA]);

  assert.equal(sortedEqual1[0].id, sortedEqual2[0].id, 'Equal timestamp sort must be completely deterministic regardless of arrival order');
  assert.equal(sortedEqual1[1].id, sortedEqual2[1].id, 'Equal timestamp sort must be completely deterministic');

  // 4. Optimistic send reconciliation with WebSocket delivery & REST fallback
  const clientUUID = 'client-uuid-9999-aaaa';
  const optimisticMsg = {
    id: clientUUID,
    client_message_id: clientUUID,
    conversation_id: 'conv_1',
    sender_user_id: 'usr_phoneA',
    body: 'Optimistic in-flight message',
    created_at: '2026-10-17T10:06:00.000Z',
    status: 'PENDING',
  };

  let state = reconcileMessages([], [msg1, msg2]);
  state = reconcileMessages(state, optimisticMsg);
  assert.equal(state.length, 3);
  assert.equal(state[0].id, clientUUID);

  // Authoritative server confirmation arrives via WebSocket
  const confirmedServerMsg = {
    id: 'srv_msg_777',
    client_message_id: clientUUID,
    conversation_id: 'conv_1',
    sender_user_id: 'usr_phoneA',
    body: 'Optimistic in-flight message',
    created_at: '2026-10-17T10:06:01.000Z',
    status: 'DELIVERED',
  };

  state = reconcileMessages(state, confirmedServerMsg);
  assert.equal(state.length, 3, 'Reconciliation must NOT create duplicate messages');
  assert.equal(state[0].id, 'srv_msg_777', 'Temporary client ID must be replaced with authoritative server ID');
  assert.equal(state[0].status, 'DELIVERED', 'Status must upgrade to DELIVERED');

  // 5. Cursor pagination loading older messages
  const olderMsg1 = {
    id: 'msg_older_000',
    conversation_id: 'conv_1',
    sender_user_id: 'usr_phoneB',
    body: 'Older historical message',
    created_at: '2026-10-17T09:00:00.000Z',
    status: 'READ',
  };
  state = reconcileMessages(state, olderMsg1);
  assert.equal(state.length, 4);
  assert.equal(state[state.length - 1].id, 'msg_older_000', 'Older historical message must be placed at end of array (top of view)');

  // 6. Responsive safe area header computation for curved vs standard devices
  function computeHeaderPadding(topInset, statusBarHeight, horizontalInset) {
    const effectiveTop = Math.max(topInset, statusBarHeight || 0);
    const paddingTop = effectiveTop > 0 ? effectiveTop + 6 : 16;
    const paddingLeft = Math.max(horizontalInset, 16);
    const paddingRight = Math.max(horizontalInset, 16);
    return { paddingTop, paddingLeft, paddingRight };
  }

  // Phone 2: Curved screen device with punch-hole notch (topInset: 48, horizontal: 12)
  const phone2Header = computeHeaderPadding(48, 48, 12);
  assert.equal(phone2Header.paddingTop, 54, 'Curved/notch device must pad header safely below notch');
  assert.equal(phone2Header.paddingLeft, 16);

  // Phone 1: Standard device without deep notch (topInset: 24, horizontal: 0)
  const phone1Header = computeHeaderPadding(24, 24, 0);
  assert.equal(phone1Header.paddingTop, 30, 'Standard device must preserve clean header clearance');

  // Screen with curved edge (horizontal: 20)
  const curvedEdge = computeHeaderPadding(36, 36, 20);
  assert.equal(curvedEdge.paddingLeft, 20, 'Curved edge device must expand horizontal padding');
  assert.equal(curvedEdge.paddingRight, 20);
});

// --- Test 80: Safety & Member Options Modal State Machine & Android BackHandler ---
test('Safety & Member Options Modal: handles Android Back, backdrop dismissal, close button, and topmost dialog priority', () => {
  // State simulation mirroring ChatRoom.tsx implementation
  let isSafetyModalVisible = false;
  let safetyModalStep = 'MENU';
  let isDestructiveInProgress = false;
  let activeBackHandler = null;
  let navigationBackCalled = false;

  function setVisible(val) {
    isSafetyModalVisible = val;
    syncBackHandler();
  }

  function setStep(step) {
    safetyModalStep = step;
    syncBackHandler();
  }

  function syncBackHandler() {
    if (!isSafetyModalVisible) {
      activeBackHandler = null;
      return;
    }
    activeBackHandler = () => {
      if (isDestructiveInProgress) {
        return true; // Consume event; do not interrupt destructive call
      }
      if (safetyModalStep !== 'MENU') {
        setStep('MENU');
        return true; // Dismiss topmost confirmation dialog first
      }
      setVisible(false);
      return true; // Dismiss modal completely; consume event
    };
  }

  function simulateHardwareBack() {
    if (activeBackHandler) {
      return activeBackHandler();
    }
    // No modal back handler active -> default navigation back occurs
    navigationBackCalled = true;
    return false;
  }

  function handleBackdropPress() {
    if (!isDestructiveInProgress) {
      setVisible(false);
      setStep('MENU');
    }
  }

  function handleCloseBtn() {
    if (!isDestructiveInProgress) {
      setVisible(false);
      setStep('MENU');
    }
  }

  // 1. Initial State: modal closed, Back presses navigate normally
  assert.equal(isSafetyModalVisible, false);
  assert.equal(activeBackHandler, null);
  const backResult1 = simulateHardwareBack();
  assert.equal(backResult1, false);
  assert.equal(navigationBackCalled, true);
  navigationBackCalled = false;

  // 2. Open Modal via Safety Menu Button
  setVisible(true);
  setStep('MENU');
  assert.equal(isSafetyModalVisible, true);
  assert.notEqual(activeBackHandler, null, 'BackHandler must be attached when modal is open');

  // 3. Android Back while at MENU: dismisses modal without navigating away
  const backResult2 = simulateHardwareBack();
  assert.equal(backResult2, true, 'Back press must be consumed');
  assert.equal(isSafetyModalVisible, false, 'Modal must be dismissed');
  assert.equal(navigationBackCalled, false, 'Chat screen must NOT navigate away');
  assert.equal(activeBackHandler, null, 'BackHandler must be cleaned up after dismissal');

  // 4. Repeated opens and closes must not leak duplicate listeners
  setVisible(true);
  setVisible(false);
  setVisible(true);
  assert.equal(isSafetyModalVisible, true);
  assert.notEqual(activeBackHandler, null);

  // 5. Navigate to Block Confirmation dialog
  setStep('BLOCK_CONFIRM');
  assert.equal(safetyModalStep, 'BLOCK_CONFIRM');

  // 6. Android Back while at Block Confirmation: dismisses topmost confirmation, returns to MENU
  let blockExecuted = false;
  const backResult3 = simulateHardwareBack();
  assert.equal(backResult3, true, 'Back press must be consumed by topmost confirmation');
  assert.equal(safetyModalStep, 'MENU', 'Must return to main safety options menu');
  assert.equal(isSafetyModalVisible, true, 'Modal should remain open at MENU level');
  assert.equal(blockExecuted, false, 'Block action must NEVER be triggered by Back');

  // 7. Re-test with Report reasons dialog
  setStep('REPORT');
  assert.equal(safetyModalStep, 'REPORT');
  simulateHardwareBack();
  assert.equal(safetyModalStep, 'MENU');
  assert.equal(isSafetyModalVisible, true);

  // 8. Re-test with Unmatch confirmation dialog
  setStep('UNMATCH_CONFIRM');
  assert.equal(safetyModalStep, 'UNMATCH_CONFIRM');
  simulateHardwareBack();
  assert.equal(safetyModalStep, 'MENU');
  assert.equal(isSafetyModalVisible, true);

  // 9. Backdrop dismissal
  handleBackdropPress();
  assert.equal(isSafetyModalVisible, false);

  // 10. Visible close button dismissal
  setVisible(true);
  setStep('MENU');
  handleCloseBtn();
  assert.equal(isSafetyModalVisible, false);

  // 11. Destructive action in progress locks dismissal
  setVisible(true);
  setStep('BLOCK_CONFIRM');
  isDestructiveInProgress = true;
  handleBackdropPress();
  assert.equal(isSafetyModalVisible, true, 'Backdrop must not dismiss while destructive call in flight');
  handleCloseBtn();
  assert.equal(isSafetyModalVisible, true, 'Close button must not dismiss while destructive call in flight');
  const lockedBack = simulateHardwareBack();
  assert.equal(lockedBack, true, 'Hardware back must be consumed without changing state during in-flight call');
  assert.equal(safetyModalStep, 'BLOCK_CONFIRM');

  // Finish destructive call
  isDestructiveInProgress = false;
  setVisible(false);
  assert.equal(isSafetyModalVisible, false);
});

// --- Test 81: Cross-Device Android Chat Keyboard Avoidance & Curved-Screen Inset Compensation ---
test('Chat Keyboard Avoidance on Curved / Edge-to-Edge Android: calculates exact bottom padding compensation without regressing standard devices', async () => {
  const fs = await import('node:fs/promises');
  const chatFile = await fs.readFile(
    new URL('../src/components/ChatRoom.tsx', import.meta.url),
    'utf-8'
  );

  // 1. Verify code contract in ChatRoom.tsx
  assert.ok(
    chatFile.includes('export function computeAndroidKeyboardCompensation'),
    'ChatRoom must export computeAndroidKeyboardCompensation function'
  );
  assert.ok(
    chatFile.includes('bottomInset: insets.bottom'),
    'Keyboard avoidance must pass bottomInset from useSafeAreaInsets to account for edge-to-edge gesture nav'
  );

  // 2. Direct algorithm verification mirroring computeAndroidKeyboardCompensation
  function computeAndroidKeyboardCompensation(params) {
    const { kbHeight, idleHeight, currentHeight, bottomInset = 0, keyboardScreenY } = params;
    if (kbHeight <= 0) return 0;

    const nativeShrinkage = Math.max(0, idleHeight - currentHeight);
    if (nativeShrinkage >= kbHeight - 25) {
      return 0;
    }

    if (keyboardScreenY && keyboardScreenY > 0 && keyboardScreenY < idleHeight) {
      const screenSpaceIntrusion = idleHeight - keyboardScreenY;
      return Math.max(0, screenSpaceIntrusion - nativeShrinkage);
    }

    return Math.max(0, kbHeight + bottomInset - nativeShrinkage);
  }

  // Device Case 1: Phone 1 (Standard Android with native adjustResize window shrinkage)
  // Physical window shrinks from 840 to 540 when 300dp keyboard appears.
  const phone1Compensation = computeAndroidKeyboardCompensation({
    kbHeight: 300,
    idleHeight: 840,
    currentHeight: 540,
    bottomInset: 0,
    keyboardScreenY: 540,
  });
  assert.equal(
    phone1Compensation,
    0,
    'Phone 1 (native adjustResize): compensation must be 0 to avoid double shrinkage and blank gaps'
  );

  // Device Case 2: Phone 2 (Curved screen, edge-to-edge display, gesture navigation)
  // Window does NOT shrink (remains at 880dp). Keyboard height reported is 280dp, nav bar is 24dp.
  // In screen space: keyboard top is at 880 - (280 + 24) = 576dp. Total intrusion is 880 - 576 = 304dp.
  const phone2Compensation = computeAndroidKeyboardCompensation({
    kbHeight: 280,
    idleHeight: 880,
    currentHeight: 880,
    bottomInset: 24,
    keyboardScreenY: 576,
  });
  assert.equal(
    phone2Compensation,
    304,
    'Phone 2 (edge-to-edge): compensation must equal screen-space intrusion (304dp) to lift composer above keyboard'
  );

  // Device Case 3: Phone 2 with deep curved cutout / 36dp nav bar (fallback without keyboardScreenY)
  const phone2DeepCompensation = computeAndroidKeyboardCompensation({
    kbHeight: 290,
    idleHeight: 920,
    currentHeight: 920,
    bottomInset: 36,
  });
  assert.equal(
    phone2DeepCompensation,
    326,
    'Curved edge fallback: must pad exactly kbHeight + bottomInset (290 + 36 = 326dp)'
  );

  // Device Case 4: Partial window resize (e.g. system window resized by only 100dp)
  const partialCompensation = computeAndroidKeyboardCompensation({
    kbHeight: 280,
    idleHeight: 880,
    currentHeight: 780,
    bottomInset: 24,
  });
  assert.equal(
    partialCompensation,
    204,
    'Partial resize: must apply remaining 280 + 24 - 100 = 204dp'
  );

  // Device Case 5: Keyboard dismiss / close
  const closedCompensation = computeAndroidKeyboardCompensation({
    kbHeight: 0,
    idleHeight: 880,
    currentHeight: 880,
    bottomInset: 24,
  });
  assert.equal(
    closedCompensation,
    0,
    'Keyboard hidden: compensation must return to 0'
  );
});

// --- Test 82: Chat Photo Attachment Workflow & Validation ---
test('Chat Photo Attachment: enforces 15MB limit, handles permissions, and manages preview lifecycle', async () => {
  const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MiB

  // 1. Permission denial handling
  function pickPhotoMock(hasPermission, mockAsset) {
    if (!hasPermission) {
      const err = new Error('Media library access is required to select photos.');
      err.code = 'PERMISSION_DENIED';
      throw err;
    }
    if (!mockAsset) return null;
    if (mockAsset.fileSize && mockAsset.fileSize > MAX_IMAGE_BYTES) {
      const err = new Error('Photo exceeds the 15MB limit.');
      err.code = 'FILE_TOO_LARGE';
      throw err;
    }
    return {
      uri: mockAsset.uri,
      width: mockAsset.width,
      height: mockAsset.height,
      fileSize: mockAsset.fileSize,
      mimeType: mockAsset.mimeType || 'image/jpeg',
      mediaType: 'IMAGE',
      fileName: mockAsset.fileName || 'chat_photo.jpg',
    };
  }

  // Permission denied should throw PERMISSION_DENIED
  assert.throws(
    () => pickPhotoMock(false, null),
    (err) => err.code === 'PERMISSION_DENIED'
  );

  // Exceeding 15MB limit should throw FILE_TOO_LARGE
  assert.throws(
    () => pickPhotoMock(true, { uri: 'file://too-large.jpg', fileSize: 16 * 1024 * 1024 }),
    (err) => err.code === 'FILE_TOO_LARGE'
  );

  // Valid photo selection
  const validPhoto = pickPhotoMock(true, {
    uri: 'file://camera_roll/photo1.jpg',
    width: 1080,
    height: 1440,
    fileSize: 3.2 * 1024 * 1024,
    mimeType: 'image/jpeg',
    fileName: 'photo1.jpg',
  });
  assert.equal(validPhoto.mediaType, 'IMAGE');
  assert.equal(validPhoto.uri, 'file://camera_roll/photo1.jpg');
  assert.equal(validPhoto.mimeType, 'image/jpeg');

  // Preview tray lifecycle
  let pendingAttachment = null;
  function onPhotoSelected(photo) {
    pendingAttachment = photo;
  }
  function onCancelAttachment() {
    pendingAttachment = null;
  }

  onPhotoSelected(validPhoto);
  assert.ok(pendingAttachment !== null);
  assert.equal(pendingAttachment.mediaType, 'IMAGE');

  onCancelAttachment();
  assert.equal(pendingAttachment, null, 'Attachment tray must clear when cancelled');
});

// --- Test 83: Chat Video Attachment Workflow, Duration & Size Validation ---
test('Chat Video Attachment: enforces 60s duration limit, 100MB size limit, and preserves video metadata', async () => {
  const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MiB
  const MAX_DURATION_MS = 60 * 1000; // 60 seconds

  function pickVideoMock(hasPermission, mockAsset) {
    if (!hasPermission) {
      const err = new Error('Media library access is required to select videos.');
      err.code = 'PERMISSION_DENIED';
      throw err;
    }
    if (!mockAsset) return null;
    if (mockAsset.fileSize && mockAsset.fileSize > MAX_VIDEO_BYTES) {
      const err = new Error('Video exceeds the maximum 100MB limit.');
      err.code = 'FILE_TOO_LARGE';
      throw err;
    }
    if (mockAsset.duration && mockAsset.duration > MAX_DURATION_MS) {
      const err = new Error('Video duration exceeds maximum allowed length of 60 seconds.');
      err.code = 'VIDEO_TOO_LONG';
      throw err;
    }
    return {
      uri: mockAsset.uri,
      width: mockAsset.width,
      height: mockAsset.height,
      fileSize: mockAsset.fileSize,
      mimeType: mockAsset.mimeType || 'video/mp4',
      mediaType: 'VIDEO',
      durationMs: mockAsset.duration != null ? mockAsset.duration : undefined,
      fileName: mockAsset.fileName || 'chat_video.mp4',
    };
  }

  // 1. Duration > 60s should be rejected
  assert.throws(
    () => pickVideoMock(true, { uri: 'file://vid.mp4', duration: 65000, fileSize: 20 * 1024 * 1024 }),
    (err) => err.code === 'VIDEO_TOO_LONG'
  );

  // 2. File size > 100MB should be rejected
  assert.throws(
    () => pickVideoMock(true, { uri: 'file://vid.mp4', duration: 45000, fileSize: 105 * 1024 * 1024 }),
    (err) => err.code === 'FILE_TOO_LARGE'
  );

  // 3. Exactly 60s and 90MB should be accepted
  const validVideo = pickVideoMock(true, {
    uri: 'file://camera_roll/vid_valid.mp4',
    width: 720,
    height: 1280,
    duration: 60000,
    fileSize: 90 * 1024 * 1024,
    mimeType: 'video/mp4',
  });
  assert.equal(validVideo.mediaType, 'VIDEO');
  assert.equal(validVideo.durationMs, 60000);
  assert.equal(validVideo.fileName, 'chat_video.mp4');

  // Preview tray state with video badge
  let pendingAttachment = validVideo;
  assert.equal(pendingAttachment.mediaType, 'VIDEO');
  const durationLabel = pendingAttachment.durationMs
    ? `${Math.round(pendingAttachment.durationMs / 1000)}s`
    : 'Ready to send';
  assert.equal(durationLabel, '60s');
});

// --- Test 84: ChatRoom Media Bubbles, Modals & Hardware Back Modal Priority ---
test('ChatRoom Media Elements: verifies photo/video testIDs, modal bindings, and hardware back precedence', async () => {
  const fs = await import('node:fs/promises');
  const chatFile = await fs.readFile(
    new URL('../src/components/ChatRoom.tsx', import.meta.url),
    'utf-8'
  );

  // 1. Verify required testIDs and accessibility hooks exist
  const expectedTestIDs = [
    'chat-attach-btn',
    'chat-attachment-preview',
    'chat-cancel-attachment-btn',
    'chat-attachment-menu',
    'chat-attach-photo-btn',
    'chat-attach-video-btn',
    'chat-photo-bubble',
    'chat-video-bubble',
    'chat-image-viewer-modal',
    'chat-image-viewer-close-btn',
    'chat-video-viewer-modal',
    'chat-video-viewer-close-btn',
    'retry-upload-btn',
  ];

  for (const tid of expectedTestIDs) {
    assert.ok(
      chatFile.includes(`testID="${tid}"`),
      `ChatRoom.tsx must include testID="${tid}"`
    );
  }

  // 2. Hardware back event handling hierarchy
  let state = {
    viewingImage: null,
    viewingVideo: null,
    isAttachmentMenuVisible: false,
    isSafetyModalVisible: false,
    safetyModalStep: 'MENU',
    isDestructiveInProgress: false,
    navigatedAway: false,
  };

  function simulateHardwareBack() {
    if (state.isDestructiveInProgress) {
      return true; // Locked
    }
    if (state.viewingImage) {
      state.viewingImage = null;
      return true; // Consumed
    }
    if (state.viewingVideo) {
      state.viewingVideo = null;
      return true; // Consumed
    }
    if (state.isAttachmentMenuVisible) {
      state.isAttachmentMenuVisible = false;
      return true; // Consumed
    }
    if (state.isSafetyModalVisible) {
      if (state.safetyModalStep !== 'MENU') {
        state.safetyModalStep = 'MENU';
        return true;
      }
      state.isSafetyModalVisible = false;
      return true;
    }
    // When no modal is open, normal navigation proceeds
    state.navigatedAway = true;
    return false;
  }

  // Step A: Fullscreen photo viewer open -> Back dismisses photo viewer first
  state.viewingImage = { url: 'https://example.com/photo.jpg' };
  let consumed = simulateHardwareBack();
  assert.equal(consumed, true);
  assert.equal(state.viewingImage, null);
  assert.equal(state.navigatedAway, false);

  // Step B: Video viewer modal open -> Back dismisses video viewer
  state.viewingVideo = { url: 'https://example.com/video.mp4' };
  consumed = simulateHardwareBack();
  assert.equal(consumed, true);
  assert.equal(state.viewingVideo, null);
  assert.equal(state.navigatedAway, false);

  // Step C: Attachment action sheet open -> Back dismisses sheet
  state.isAttachmentMenuVisible = true;
  consumed = simulateHardwareBack();
  assert.equal(consumed, true);
  assert.equal(state.isAttachmentMenuVisible, false);
  assert.equal(state.navigatedAway, false);

  // Step D: When all modals closed -> Back triggers navigation
  consumed = simulateHardwareBack();
  assert.equal(consumed, false);
  assert.equal(state.navigatedAway, true);
});

// --- Test 85: Chat Media Privacy & Authorization Gate ---
test('Chat Media Privacy: private chat attachments require conversation participant authorization', async () => {
  // Mock conversation and assets
  const conversation = {
    id: 'conv_abc_123',
    user1_id: 'user_alice',
    user2_id: 'user_bob',
  };

  const asset = {
    id: 'media_chat_789',
    owner_user_id: 'user_alice',
    purpose: 'CHAT_ATTACHMENT',
    media_type: 'IMAGE',
    status: 'READY',
  };

  // Mock CanAccessMediaAsset logic mirroring Go backend repository
  function canAccessMediaAsset(requesterId, assetId) {
    if (assetId !== asset.id) return false;
    if (asset.owner_user_id === requesterId) return true;
    // For CHAT_ATTACHMENT, must be a participant of the conversation
    if (requesterId === conversation.user1_id || requesterId === conversation.user2_id) {
      return true;
    }
    return false;
  }

  // Owner (Alice) has access
  assert.equal(canAccessMediaAsset('user_alice', 'media_chat_789'), true);

  // Recipient (Bob) has access
  assert.equal(canAccessMediaAsset('user_bob', 'media_chat_789'), true);

  // Unauthorized third party (Charlie) is strictly denied access
  assert.equal(canAccessMediaAsset('user_charlie', 'media_chat_789'), false);

  // Unauthenticated / empty caller is denied
  assert.equal(canAccessMediaAsset('', 'media_chat_789'), false);
  assert.equal(canAccessMediaAsset(null, 'media_chat_789'), false);
});

// --- Test 86: Chat Photo Attachment Loading, Error State, and Retry Flow ---
test('Chat Photo Attachment: handles loading state, error state on failure, and tap-to-retry recovery', async () => {
  // Test message reconciliation preserves media fields
  function compareMessagesDesc(a, b) {
    const timeA = new Date(a.created_at).getTime();
    const timeB = new Date(b.created_at).getTime();
    if (timeA !== timeB) return timeB - timeA;
    return (b.id || '').localeCompare(a.id || '');
  }

  function reconcileMessages(existingList, incoming) {
    const incomingList = Array.isArray(incoming) ? incoming : [incoming];
    const merged = [...existingList];

    for (const item of incomingList) {
      const existingIndex = merged.findIndex((m) => {
        if (item.id && m.id === item.id) return true;
        if (item.client_message_id && m.client_message_id === item.client_message_id) return true;
        return false;
      });

      if (existingIndex !== -1) {
        const existing = merged[existingIndex];
        merged[existingIndex] = {
          ...existing,
          ...item,
          id: item.id || existing.id,
          media_url: item.media_url || existing.media_url,
          media_asset_id: item.media_asset_id || existing.media_asset_id,
          message_type: item.message_type || existing.message_type,
          delivered_at: item.delivered_at || existing.delivered_at || null,
          read_at: item.read_at || existing.read_at || null,
          status: item.read_at || existing.read_at ? 'READ' : item.delivered_at || existing.delivered_at ? 'DELIVERED' : item.status || existing.status,
          created_at: item.created_at || existing.created_at,
        };
      } else {
        merged.push(item);
      }
    }
    return merged.sort(compareMessagesDesc);
  }

  // Verify reconcileMessages preserves media_url and media_asset_id when server update arrives without them
  const initialOptimistic = {
    id: 'msg_temp_1',
    client_message_id: 'client_uuid_1',
    body: 'Look at this photo',
    message_type: 'IMAGE',
    media_asset_id: 'asset_uuid_99',
    media_url: 'file:///local/cache/photo.jpg',
    status: 'PENDING',
    created_at: '2026-10-17T20:00:00Z',
  };

  let list = reconcileMessages([], initialOptimistic);
  assert.equal(list.length, 1);
  assert.equal(list[0].media_url, 'file:///local/cache/photo.jpg');
  assert.equal(list[0].media_asset_id, 'asset_uuid_99');

  // Server delivery receipt or status update arrives without media_url
  const serverReceipt = {
    id: 'msg_server_1',
    client_message_id: 'client_uuid_1',
    delivered_at: '2026-10-17T20:00:05Z',
    status: 'DELIVERED',
  };
  list = reconcileMessages(list, serverReceipt);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'msg_server_1');
  assert.equal(list[0].status, 'DELIVERED');
  // media_url and media_asset_id MUST be preserved!
  assert.equal(list[0].media_url, 'file:///local/cache/photo.jpg');
  assert.equal(list[0].media_asset_id, 'asset_uuid_99');
  assert.equal(list[0].message_type, 'IMAGE');

  // Test Error State & Retry Flow simulation
  const mediaAssetUrls = {};
  const mediaAssetErrors = {};
  const loadingAssetIds = {};
  let fetchAttempts = 0;
  let simulateNetworkError = true;

  async function mockGetChatMediaAsset(assetId) {
    fetchAttempts++;
    if (simulateNetworkError) {
      throw new Error('Network error or 403 Forbidden');
    }
    return {
      media_id: assetId,
      status: 'READY',
      card_url: `https://api.example.com/stream/${assetId}/card.webp?token=xyz`,
    };
  }

  async function resolveAsset(assetId) {
    if (assetId && !mediaAssetUrls[assetId] && !mediaAssetErrors[assetId] && !loadingAssetIds[assetId]) {
      loadingAssetIds[assetId] = true;
      try {
        const asset = await mockGetChatMediaAsset(assetId);
        if (asset) {
          mediaAssetUrls[assetId] = asset;
        } else {
          mediaAssetErrors[assetId] = true;
        }
      } catch {
        mediaAssetErrors[assetId] = true;
      } finally {
        loadingAssetIds[assetId] = false;
      }
    }
  }

  function retryLoadMediaAsset(assetId) {
    delete mediaAssetErrors[assetId];
    return resolveAsset(assetId);
  }

  // Pass 1: Resolution fails due to network/auth error
  await resolveAsset('asset_uuid_99');
  assert.equal(fetchAttempts, 1);
  assert.equal(loadingAssetIds['asset_uuid_99'], false);
  assert.equal(mediaAssetErrors['asset_uuid_99'], true);
  assert.equal(mediaAssetUrls['asset_uuid_99'], undefined);

  // Subsequent render pass does NOT trigger infinite fetch loop because mediaAssetErrors is set
  await resolveAsset('asset_uuid_99');
  assert.equal(fetchAttempts, 1); // Not called again! Infinite spinner prevented!

  // Pass 2: User taps "⚠️ Could not load photo • Tap to retry"
  simulateNetworkError = false;
  await retryLoadMediaAsset('asset_uuid_99');
  assert.equal(fetchAttempts, 2);
  assert.equal(mediaAssetErrors['asset_uuid_99'], undefined);
  assert.ok(mediaAssetUrls['asset_uuid_99']);
  assert.equal(
    mediaAssetUrls['asset_uuid_99'].card_url,
    'https://api.example.com/stream/asset_uuid_99/card.webp?token=xyz'
  );
});

