import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Likes You: rewarded-ad unlock service methods and types', async () => {
  const discoveryServiceFile = await fs.readFile(
    new URL('../src/services/discovery/discoveryService.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(
    discoveryServiceFile.includes('getLikesYou(limit = 20, offset = 0)'),
    'discoveryService must provide getLikesYou method'
  );
  assert.ok(
    discoveryServiceFile.includes('/api/v1/discovery/likes-you?limit='),
    'getLikesYou must query /api/v1/discovery/likes-you'
  );
  assert.ok(
    discoveryServiceFile.includes('unlockLikesYouWithAd(transactionId?: string, rawQuery?: string)'),
    'discoveryService must provide unlockLikesYouWithAd'
  );
  assert.ok(
    discoveryServiceFile.includes('/api/v1/discovery/likes-you/unlock-ad'),
    'unlockLikesYouWithAd must post to /api/v1/discovery/likes-you/unlock-ad'
  );

  const typesFile = await fs.readFile(
    new URL('../src/types/index.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(typesFile.includes('export interface IncomingLikeCard'), 'types must export IncomingLikeCard');
  assert.ok(typesFile.includes('export interface LikesYouResponse'), 'types must export LikesYouResponse');
  assert.ok(typesFile.includes('export interface LikesYouUnlockAdResponse'), 'types must export LikesYouUnlockAdResponse');
  assert.ok(typesFile.includes('ads_watched_in_window: number'), 'LikesYouResponse must have ads_watched_in_window');
  assert.ok(typesFile.includes('max_ads_per_window: number'), 'LikesYouResponse must have max_ads_per_window');
  assert.ok(typesFile.includes('can_watch_ad: boolean'), 'LikesYouResponse must have can_watch_ad');
  assert.ok(typesFile.includes('ad_reset_in_seconds: number'), 'LikesYouResponse must have ad_reset_in_seconds');
});

test('Likes You: AdMob service separates reward purposes with customData', async () => {
  const admobFile = await fs.readFile(
    new URL('../src/services/ads/admobService.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(
    admobFile.includes("showRewardedAd(userId: string, customData: string = 'bonus_likes_reward')"),
    'showRewardedAd must accept customData parameter'
  );
  assert.ok(
    admobFile.includes('customData,') || admobFile.includes('customData: customData'),
    'showRewardedAd must pass customData into ssvOptions'
  );
});

test('Likes You: Mobile screen enforces 2-profile unlock, 5-ad/25h limit, and honest unblurred/blurred cards', async () => {
  const likesScreenFile = await fs.readFile(
    new URL('../app/(tabs)/likes.tsx', import.meta.url),
    'utf-8'
  );

  // 1. Calls getLikesYou and passes likes_you_unlock purpose
  assert.ok(
    likesScreenFile.includes('discoveryService.getLikesYou'),
    'likes screen must fetch real incoming likes from discoveryService'
  );
  assert.ok(
    likesScreenFile.includes("showRewardedAd(userId, 'likes_you_unlock')"),
    'likes screen must request rewarded ad with likes_you_unlock purpose'
  );
  assert.ok(
    likesScreenFile.includes('discoveryService.unlockLikesYouWithAd'),
    'likes screen must call backend unlockLikesYouWithAd'
  );

  // 2. Rolling 25-hour limit and countdown
  assert.ok(
    likesScreenFile.includes('25-Hour Ad Limit Reached'),
    'likes screen must display 25-hour ad limit reached header'
  );
  assert.ok(
    likesScreenFile.includes('formatCountdown'),
    'likes screen must format remaining countdown time'
  );
  assert.ok(
    likesScreenFile.includes('Next ad unlock available in'),
    'likes screen must display live countdown message when limit is reached'
  );

  // 3. Free user blurred cards with "Someone liked you" (Requirement 1)
  assert.ok(
    likesScreenFile.includes('Someone liked you'),
    'unrevealed card must display "Someone liked you"'
  );
  assert.ok(
    likesScreenFile.includes('Watch Ad to Unlock 2 Profiles') || likesScreenFile.includes('Watch Video to Unlock 2 Likes'),
    'screen must clearly state 2 profiles unlocked per ad'
  );

  // 4. Honest empty state (Requirement 5: No fake likes or fake profiles)
  assert.ok(
    likesScreenFile.includes('No New Likes Right Now'),
    'likes screen must provide honest empty state'
  );
  assert.ok(
    !likesScreenFile.includes('[1, 2, 3, 4].map'),
    'likes screen must not render fake dummy placeholder profile cards'
  );

  // 5. Total Incoming Likes counter reads backend database total, not loaded array length
  assert.ok(
    likesScreenFile.includes('INCOMING LIKES ({totalLikesCount})'),
    'likes screen must display INCOMING LIKES ({totalLikesCount})'
  );
  assert.ok(
    !likesScreenFile.includes('Incoming Likes ({incomingLikes.length})'),
    'likes screen must not use array length of visible profiles for incoming likes counter'
  );
  assert.ok(
    likesScreenFile.includes('totalLikesCount = likesData?.total_likes || 0'),
    'totalLikesCount must be derived from backend total_likes response'
  );
});
