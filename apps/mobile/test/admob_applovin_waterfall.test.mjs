import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Mediation: AppLovin Maven repository is configured in android/build.gradle', async () => {
  const buildGradle = await fs.readFile(
    new URL('../android/build.gradle', import.meta.url),
    'utf-8'
  );
  assert.ok(
    buildGradle.includes('artifacts.applovin.com/android'),
    'android/build.gradle must include AppLovin Maven repository'
  );
});

test('Mediation: Google Mobile Ads AppLovin adapter is integrated in android/app/build.gradle', async () => {
  const appBuildGradle = await fs.readFile(
    new URL('../android/app/build.gradle', import.meta.url),
    'utf-8'
  );
  assert.ok(
    appBuildGradle.includes('com.google.ads.mediation:applovin'),
    'android/app/build.gradle must declare com.google.ads.mediation:applovin dependency'
  );
});

test('15-Swipe Rewarded Ad Flow: Discovery index.tsx triggers handleRewardedAdBreak', async () => {
  const indexTsx = await fs.readFile(
    new URL('../app/(tabs)/index.tsx', import.meta.url),
    'utf-8'
  );

  // 1. Must invoke handleRewardedAdBreak on 15 swipes threshold, NOT showInterstitialAd
  assert.ok(
    indexTsx.includes('handleRewardedAdBreak();'),
    'index.tsx must trigger handleRewardedAdBreak() when swipe threshold is reached'
  );

  // 2. handleRewardedAdBreak must call showRewardedAd
  assert.ok(
    indexTsx.includes('admobService.showRewardedAd(userId, \'swipe_cadence_reward\')'),
    'handleRewardedAdBreak must request a rewarded ad with swipe_cadence_reward tag'
  );

  // 3. Must only grant reward when result.rewarded is true
  assert.ok(
    indexTsx.includes('if (result.rewarded) {') &&
    indexTsx.includes('claimBonusReward(result.transactionId') &&
    indexTsx.includes('adBreakManager.onAdCompleted()'),
    'handleRewardedAdBreak must grant reward and complete ad break ONLY when result.rewarded is true'
  );

  // 4. Must fail ad break on non-rewarded
  assert.ok(
    indexTsx.includes('adBreakManager.onAdFailed()'),
    'handleRewardedAdBreak must call adBreakManager.onAdFailed() when ad is not rewarded'
  );
});

test('Swipe Allowance Reward Claim: discoveryService and SwipeQuotaModal connect claimSwipeAdReward', async () => {
  const discoveryServiceFile = await fs.readFile(
    new URL('../src/services/discovery/discoveryService.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(
    discoveryServiceFile.includes('claimSwipeAdReward(transactionId?: string'),
    'discoveryService must define claimSwipeAdReward'
  );
  assert.ok(
    discoveryServiceFile.includes('/api/v1/swipes/claim-reward'),
    'claimSwipeAdReward must POST to /api/v1/swipes/claim-reward'
  );

  const quotaModalFile = await fs.readFile(
    new URL('../src/components/SwipeQuotaModal.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(
    quotaModalFile.includes('onRewardGranted(result.rewardAmount >= 5 ? result.rewardAmount : 5, result.transactionId);'),
    'SwipeQuotaModal must pass transactionId and 5 bonus likes on rewarded completion'
  );
});

test('Ad Inspector: admobService defines openAdInspector with strict __DEV__ guard', async () => {
  const admobServiceFile = await fs.readFile(
    new URL('../src/services/ads/admobService.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(
    admobServiceFile.includes('async openAdInspector(): Promise<void>'),
    'admobService must define openAdInspector'
  );
  assert.ok(
    admobServiceFile.includes('if (!__DEV__)'),
    'openAdInspector must be strictly gated by __DEV__'
  );
  assert.ok(
    admobServiceFile.includes('mobileAds.default().openAdInspector()'),
    'openAdInspector must call native Google Mobile Ads openAdInspector'
  );
});

test('Developer Diagnostics: Settings screen exposes Ad Inspector button gated to __DEV__', async () => {
  const settingsFile = await fs.readFile(
    new URL('../app/(tabs)/settings.tsx', import.meta.url),
    'utf-8'
  );
  assert.ok(
    settingsFile.includes('{__DEV__ && (') &&
    settingsFile.includes('testID="open-ad-inspector-btn"') &&
    settingsFile.includes('admobService.openAdInspector()'),
    'settings.tsx must render Ad Inspector launch button only in __DEV__ environments'
  );
});

test('Mediation Architecture: No standalone AppLovin MAX SDK bypasses Google AdMob controller', async () => {
  const packageJson = JSON.parse(
    await fs.readFile(new URL('../package.json', import.meta.url), 'utf-8')
  );
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  assert.equal(
    allDeps['react-native-applovin-max'],
    undefined,
    'Must not include standalone react-native-applovin-max package that would bypass AdMob'
  );
});
