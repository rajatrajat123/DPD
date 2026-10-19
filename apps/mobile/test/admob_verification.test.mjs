import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('AdMob Config: app.json and AD_UNIT_IDS contain standard Google test IDs', async () => {
  const appJson = JSON.parse(
    await fs.readFile(new URL('../app.json', import.meta.url), 'utf-8')
  );

  const googleMobileAdsPlugin = appJson.expo.plugins.find(
    (p) => Array.isArray(p) && p[0] === 'react-native-google-mobile-ads'
  );
  assert.ok(googleMobileAdsPlugin, 'app.json must configure react-native-google-mobile-ads plugin');

  const { androidAppId, iosAppId } = googleMobileAdsPlugin[1];
  assert.equal(androidAppId, 'ca-app-pub-3940256099942544~3347511713', 'Android App ID must be Google test ID');
  assert.equal(iosAppId, 'ca-app-pub-3940256099942544~1458002511', 'iOS App ID must be Google test ID');

  const admobServiceFile = await fs.readFile(
    new URL('../src/services/ads/admobService.ts', import.meta.url),
    'utf-8'
  );

  assert.ok(
    admobServiceFile.includes('ca-app-pub-3940256099942544/6300978111'),
    'Android banner test unit ID must be ca-app-pub-3940256099942544/6300978111'
  );
  assert.ok(
    admobServiceFile.includes('ca-app-pub-3940256099942544/5224354917'),
    'Android rewarded test unit ID must be ca-app-pub-3940256099942544/5224354917'
  );
  assert.ok(
    admobServiceFile.includes('ca-app-pub-3940256099942544/1033173712'),
    'Android interstitial test unit ID must be ca-app-pub-3940256099942544/1033173712'
  );
});

test('AdMob Rewarded & Interstitial: Proper event types, concurrency guard, and timeout safety', async () => {
  const admobServiceFile = await fs.readFile(
    new URL('../src/services/ads/admobService.ts', import.meta.url),
    'utf-8'
  );

  // Rewarded ad event listeners: RewardedAdEventType has LOADED & EARNED_REWARD, AdEventType has CLOSED & ERROR
  assert.ok(
    admobServiceFile.includes('const { RewardedAd, RewardedAdEventType, AdEventType } = mobileAds;'),
    'showRewardedAd must destructure both RewardedAdEventType and AdEventType'
  );
  assert.ok(
    admobServiceFile.includes('RewardedAdEventType.LOADED'),
    'showRewardedAd must listen to RewardedAdEventType.LOADED'
  );
  assert.ok(
    admobServiceFile.includes('RewardedAdEventType.EARNED_REWARD'),
    'showRewardedAd must listen to RewardedAdEventType.EARNED_REWARD'
  );
  assert.ok(
    admobServiceFile.includes('AdEventType.CLOSED'),
    'showRewardedAd must listen to AdEventType.CLOSED for modal close'
  );
  assert.ok(
    admobServiceFile.includes('AdEventType.ERROR'),
    'showRewardedAd must listen to AdEventType.ERROR for load/display failure'
  );

  // Concurrency guard
  assert.ok(
    admobServiceFile.includes('private isShowingAd = false;'),
    'AdMobService must declare isShowingAd concurrency guard'
  );
  assert.ok(
    admobServiceFile.includes('if (this.isShowingAd) {'),
    'showRewardedAd and showInterstitialAd must check isShowingAd'
  );

  // Timeout safety
  assert.ok(
    admobServiceFile.includes('25000'),
    'showRewardedAd must implement a 25-second timeout safety guard'
  );
  assert.ok(
    admobServiceFile.includes('5000'),
    'showInterstitialAd must implement a timeout safety guard'
  );

  // Test transaction ID generation
  assert.ok(
    admobServiceFile.includes('test-admob-'),
    'showRewardedAd must generate test transaction ID on reward'
  );
});

test('AdMob Privacy Guarantee: FORBIDDEN_PRIVACY_KEYS and Non-Personalized ad configuration', async () => {
  const admobServiceFile = await fs.readFile(
    new URL('../src/services/ads/admobService.ts', import.meta.url),
    'utf-8'
  );

  const forbiddenKeys = [
    'gender',
    'sexual_orientation',
    'orientation',
    'pronouns',
    'dating_preferences',
    'chat',
    'latitude',
    'longitude',
  ];

  for (const key of forbiddenKeys) {
    assert.ok(
      admobServiceFile.includes(`'${key}'`),
      `FORBIDDEN_PRIVACY_KEYS must include ${key}`
    );
  }

  assert.ok(
    admobServiceFile.includes('requestNonPersonalizedAdsOnly: true'),
    'Ad requests must enforce non-personalized ads only'
  );
});

test('AdBreakManager: Cadence of 15 unique profiles, profile deduplication, and completion-only reset', async () => {
  const admobServiceFile = await fs.readFile(
    new URL('../src/services/ads/admobService.ts', import.meta.url),
    'utf-8'
  );

  assert.ok(
    admobServiceFile.includes('const threshold = 15;'),
    'AdBreakManager must enforce a threshold of 15 profiles'
  );
  assert.ok(
    admobServiceFile.includes('this.viewedProfileIds.has(profileId)'),
    'AdBreakManager must deduplicate profile views using viewedProfileIds set'
  );
  assert.ok(
    admobServiceFile.includes('onAdCompleted()'),
    'AdBreakManager must provide onAdCompleted callback'
  );
  assert.ok(
    admobServiceFile.includes('onAdFailed()'),
    'AdBreakManager must provide onAdFailed callback that preserves counter'
  );
});

test('Modals Duplicate Click Protection: DiscoveryMessageQuotaModal and SwipeQuotaModal guard isWatchingAd', async () => {
  const discoModalFile = await fs.readFile(
    new URL('../src/components/DiscoveryMessageQuotaModal.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(
    discoModalFile.includes('const handleWatchAd = async () => {\n    if (isWatchingAd) return;'),
    'DiscoveryMessageQuotaModal must guard handleWatchAd with if (isWatchingAd) return;'
  );

  const swipeModalFile = await fs.readFile(
    new URL('../src/components/SwipeQuotaModal.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(
    swipeModalFile.includes('const handleWatchAd = async () => {\n    if (isWatchingAd) return;'),
    'SwipeQuotaModal must guard handleWatchAd with if (isWatchingAd) return;'
  );
});

test('EAS Configuration: eas.json has ads-test profile with apk buildType and internal distribution', async () => {
  const easJsonContent = await fs.readFile(
    new URL('../eas.json', import.meta.url),
    'utf-8'
  );
  const easJson = JSON.parse(easJsonContent);

  assert.ok(easJson.build, 'eas.json must have build configurations');
  assert.ok(easJson.build['ads-test'], 'eas.json must have ads-test profile');
  assert.equal(
    easJson.build['ads-test'].distribution,
    'internal',
    'ads-test profile must have internal distribution'
  );
  assert.equal(
    easJson.build['ads-test'].android.buildType,
    'apk',
    'ads-test profile must specify apk buildType for Android'
  );
  assert.equal(
    easJson.build['ads-test'].developmentClient,
    false,
    'ads-test must build standalone app without development client'
  );
});

test('Rewarded Ad Lifecycle: SDK unavailable rejects reward grant without transaction synthesis', async () => {
  const admobServiceFile = await fs.readFile(
    new URL('../src/services/ads/admobService.ts', import.meta.url),
    'utf-8'
  );
  const discoModalFile = await fs.readFile(
    new URL('../src/components/DiscoveryMessageQuotaModal.tsx', import.meta.url),
    'utf-8'
  );

  // 1. admobService must not return mock rewarded: true when SDK is unavailable
  assert.ok(
    !admobServiceFile.includes('mockTxId'),
    'admobService must never synthesize mockTxId when SDK is unavailable'
  );

  // 2. DiscoveryMessageQuotaModal must never synthesize ad-unlock fake fallback
  assert.ok(
    !discoModalFile.includes('ad-unlock-'),
    'DiscoveryMessageQuotaModal must not generate fake ad-unlock transaction IDs'
  );

  // 3. DiscoveryMessageQuotaModal must verify isGoogleMobileAdsAvailable before attempting ad presentation
  assert.ok(
    discoModalFile.includes('if (!isGoogleMobileAdsAvailable())'),
    'DiscoveryMessageQuotaModal must guard with isGoogleMobileAdsAvailable'
  );

  // 4. Must require both result.rewarded and result.transactionId before backend unlock
  assert.ok(
    discoModalFile.includes('if (!result.rewarded)'),
    'DiscoveryMessageQuotaModal must check result.rewarded'
  );
  assert.ok(
    discoModalFile.includes('if (!result.transactionId)'),
    'DiscoveryMessageQuotaModal must check result.transactionId'
  );
});

test('Rewarded Ad Lifecycle: Load failure (ERROR event) rejects reward grant', async () => {
  const admobServiceFile = await fs.readFile(
    new URL('../src/services/ads/admobService.ts', import.meta.url),
    'utf-8'
  );

  assert.ok(
    admobServiceFile.includes('unsubscribeError = rewardedAd.addAdEventListener(') &&
    admobServiceFile.includes('AdEventType.ERROR'),
    'showRewardedAd must subscribe to AdEventType.ERROR'
  );
  assert.ok(
    admobServiceFile.includes('rewarded: false') && admobServiceFile.includes('Ad failed to load'),
    'AdEventType.ERROR must resolve with rewarded: false and error message'
  );
});

test('Rewarded Ad Lifecycle: Premature close (CLOSED before EARNED_REWARD) rejects reward grant', async () => {
  const admobServiceFile = await fs.readFile(
    new URL('../src/services/ads/admobService.ts', import.meta.url),
    'utf-8'
  );

  assert.ok(
    admobServiceFile.includes('if (hasRewarded) {') &&
    admobServiceFile.includes('Video was closed before completing'),
    'AdEventType.CLOSED must verify hasRewarded before granting completion token'
  );
});

test('Rewarded Ad Lifecycle: Successful EARNED_REWARD + CLOSED grants completion token', async () => {
  const admobServiceFile = await fs.readFile(
    new URL('../src/services/ads/admobService.ts', import.meta.url),
    'utf-8'
  );

  assert.ok(
    admobServiceFile.includes('hasRewarded = true;'),
    'RewardedAdEventType.EARNED_REWARD must set hasRewarded flag'
  );
  assert.ok(
    admobServiceFile.includes('finish({ rewarded: true, rewardAmount: earnedAmount, transactionId: txId });'),
    'showRewardedAd must only grant reward after EARNED_REWARD and CLOSED events'
  );
});
