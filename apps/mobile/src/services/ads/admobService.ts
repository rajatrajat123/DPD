import { NativeModules, Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { api } from '../api/client';

export const isExpoGo = Boolean(
  Constants?.appOwnership === 'expo' ||
  Constants?.executionEnvironment === ExecutionEnvironment?.StoreClient
);

export function isGoogleMobileAdsAvailable(): boolean {
  if (Platform?.OS === 'web' || isExpoGo) {
    return false;
  }
  return Boolean(
    NativeModules?.RNGoogleMobileAdsModule ||
    NativeModules?.RNGoogleMobileAdsBannerViewManager
  );
}

/**
 * AdMob Test Ad Unit IDs provided by Google for development/testing
 */
export const AD_UNIT_IDS = {
  BANNER: Platform.select({
    ios: 'ca-app-pub-3940256099942544/2934735716',
    android: 'ca-app-pub-3940256099942544/6300978111',
    default: 'ca-app-pub-3940256099942544/6300978111',
  }),
  REWARDED: Platform.select({
    ios: 'ca-app-pub-3940256099942544/1712485313',
    android: 'ca-app-pub-3940256099942544/5224354917',
    default: 'ca-app-pub-3940256099942544/5224354917',
  }),
  INTERSTITIAL: Platform.select({
    ios: 'ca-app-pub-3940256099942544/4411468910',
    android: 'ca-app-pub-3940256099942544/1033173712',
    default: 'ca-app-pub-3940256099942544/1033173712',
  }),
};

/**
 * Strict Privacy Guarantee:
 * AdMob requests MUST NEVER include LGBTQ+ identity, sexual orientation,
 * gender identities, chat contents, discovery preferences, or exact GPS coordinates.
 */
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

export interface SafeAdRequestOptions {
  requestNonPersonalizedAdsOnly: boolean;
  keywords?: string[];
  contentUrl?: string;
}

export function assertPrivacyClean(options?: Record<string, unknown>): void {
  if (!options) return;
  const jsonStr = JSON.stringify(options).toLowerCase();
  for (const forbidden of FORBIDDEN_PRIVACY_KEYS) {
    if (jsonStr.includes(`"${forbidden}"`) || jsonStr.includes(forbidden)) {
      throw new Error(
        `[PRIVACY_VIOLATION] Attempted to pass sensitive user attribute "${forbidden}" to advertising SDK.`
      );
    }
  }
}

export interface SwipeAllowance {
  remainingLikes: number;
  remainingRegularLikes?: number;
  remainingBonusLikes?: number;
  isUnlimited: boolean;
  isIntroductory?: boolean;
  dailyQuota: number;
  windowResetAt?: string;
}

export interface AdRewardResult {
  rewarded: boolean;
  rewardAmount: number;
  transactionId?: string;
  error?: string;
}

class AdMobService {
  private initialized = false;
  private isInitializing = false;

  /**
   * Initializes Google Mobile Ads SDK with strict non-personalized ad defaults
   */
  async initialize(): Promise<void> {
    if (this.initialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      if (!isGoogleMobileAdsAvailable()) {
        this.initialized = true;
        return;
      }
      const mobileAds = require('react-native-google-mobile-ads');
      if (mobileAds && mobileAds.default) {
        await mobileAds.default().initialize();
        await mobileAds.default().setRequestConfiguration({
          maxAdContentRating: mobileAds.MaxAdContentRating?.PG || 'PG',
          tagForChildDirectedTreatment: false,
          tagForUnderAgeOfConsent: false,
        });
      }
      this.initialized = true;
    } catch {
      // In headless test environments or Expo Go without native build, mark initialized
      this.initialized = true;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Generates strictly compliant, privacy-preserving ad request parameters.
   */
  getSafeAdRequestConfig(): SafeAdRequestOptions {
    const config: SafeAdRequestOptions = {
      requestNonPersonalizedAdsOnly: true,
      keywords: ['dating', 'lifestyle', 'social'],
    };
    assertPrivacyClean(config as unknown as Record<string, unknown>);
    return config;
  }

  /**
   * Fetches user's current swipe allowance from Go backend
   */
  async getSwipeAllowance(): Promise<SwipeAllowance> {
    try {
      const resp = await api.get<{
        remaining_likes: number;
        remaining_regular_likes?: number;
        remaining_bonus_likes?: number;
        is_unlimited: boolean;
        is_introductory?: boolean;
        daily_quota: number;
        window_reset_at?: string;
      }>('/api/v1/swipes/allowance');
      return {
        remainingLikes: resp.remaining_likes,
        remainingRegularLikes: resp.remaining_regular_likes,
        remainingBonusLikes: resp.remaining_bonus_likes,
        isUnlimited: resp.is_unlimited,
        isIntroductory: resp.is_introductory,
        dailyQuota: resp.daily_quota || 15,
        windowResetAt: resp.window_reset_at,
      };
    } catch {
      // Fallback: 15 likes per 12h window
      return {
        remainingLikes: 15,
        remainingRegularLikes: 15,
        remainingBonusLikes: 0,
        isUnlimited: false,
        isIntroductory: false,
        dailyQuota: 15,
      };
    }
  }

  /**
   * Presents a rewarded video ad to the user to earn 1 bonus like.
   * Leverages server-side verification (SSV) callback on the Go backend.
   */
  async showRewardedAd(userId: string): Promise<AdRewardResult> {
    await this.initialize();

    // Verify privacy clean userId format
    if (!userId || typeof userId !== 'string') {
      return { rewarded: false, rewardAmount: 0, error: 'Invalid user ID' };
    }

    if (!isGoogleMobileAdsAvailable()) {
      return {
        rewarded: false,
        rewardAmount: 0,
        error: 'Rewarded video ads are not supported in Expo Go. A native development build is required.',
      };
    }

    try {
      const mobileAds = require('react-native-google-mobile-ads');
      if (mobileAds && mobileAds.RewardedAd && mobileAds.RewardedAdEventType) {
        const { RewardedAd, RewardedAdEventType } = mobileAds;
        const adUnitId = AD_UNIT_IDS.REWARDED || 'ca-app-pub-3940256099942544/5224354917';

        const ssvOptions = {
          userId,
          customData: 'bonus_likes_reward',
        };
        assertPrivacyClean(ssvOptions);

        const rewardedAd = RewardedAd.createForAdRequest(adUnitId, {
          requestNonPersonalizedAdsOnly: true,
          serverSideVerificationOptions: ssvOptions,
        });

        return new Promise<AdRewardResult>((resolve) => {
          let hasRewarded = false;
          let earnedAmount = 1;

          const unsubscribeLoaded = rewardedAd.addAdEventListener(
            RewardedAdEventType.LOADED,
            () => {
              rewardedAd.show();
            }
          );

          const unsubscribeEarned = rewardedAd.addAdEventListener(
            RewardedAdEventType.EARNED_REWARD,
            (reward: { amount?: number }) => {
              hasRewarded = true;
              if (reward && typeof reward.amount === 'number' && reward.amount > 0) {
                earnedAmount = reward.amount;
              } else {
                earnedAmount = 1;
              }
            }
          );

          const unsubscribeClosed = rewardedAd.addAdEventListener(
            RewardedAdEventType.CLOSED,
            async () => {
              unsubscribeLoaded();
              unsubscribeEarned();
              unsubscribeClosed();

              if (hasRewarded) {
                // Ad was watched to completion. Google AdMob dispatches the server-side
                // verification (SSV) callback directly from Google servers to the backend endpoint.
                // The mobile client must never synthesize SSV callbacks or self-credit rewards.
                resolve({ rewarded: true, rewardAmount: earnedAmount });
              } else {
                resolve({ rewarded: false, rewardAmount: 0, error: 'Ad closed before completion' });
              }
            }
          );

          const unsubscribeError = rewardedAd.addAdEventListener(
            RewardedAdEventType.ERROR,
            (error: unknown) => {
              unsubscribeLoaded();
              unsubscribeEarned();
              unsubscribeClosed();
              unsubscribeError();
              resolve({
                rewarded: false,
                rewardAmount: 0,
                error: error instanceof Error ? error.message : 'Ad failed to load',
              });
            }
          );

          rewardedAd.load();
        });
      }
    } catch {
      // Graceful fallback for mock / headless / test environments
    }

    // Rewarded ads require genuine AdMob presentation and server-to-server verification.
    // Client cannot self-grant rewards or simulate completion to the backend.
    return {
      rewarded: false,
      rewardAmount: 0,
      error: 'Rewarded video ads are not supported in this environment',
    };
  }

  /**
   * Presents a non-blocking interstitial ad at natural transitions (e.g. ad breaks).
   * Ad conforms to strict non-personalized requirements and never stalls navigation.
   */
  async showInterstitialAd(): Promise<boolean> {
    await this.initialize();
    if (!isGoogleMobileAdsAvailable()) {
      return false;
    }
    try {
      const mobileAds = require('react-native-google-mobile-ads');
      if (mobileAds && mobileAds.InterstitialAd && mobileAds.AdEventType) {
        const { InterstitialAd, AdEventType } = mobileAds;
        const adUnitId = AD_UNIT_IDS.INTERSTITIAL || 'ca-app-pub-3940256099942544/1033173712';
        const interstitial = InterstitialAd.createForAdRequest(adUnitId, {
          requestNonPersonalizedAdsOnly: true,
        });

        return new Promise<boolean>((resolve) => {
          let isShown = false;
          const unsubscribeLoaded = interstitial.addAdEventListener(
            AdEventType.LOADED,
            () => {
              isShown = true;
              interstitial.show();
            }
          );

          const unsubscribeClosed = interstitial.addAdEventListener(
            AdEventType.CLOSED,
            () => {
              unsubscribeLoaded();
              unsubscribeClosed();
              unsubscribeError();
              resolve(true);
            }
          );

          const unsubscribeError = interstitial.addAdEventListener(
            AdEventType.ERROR,
            () => {
              unsubscribeLoaded();
              unsubscribeClosed();
              unsubscribeError();
              resolve(false);
            }
          );

          interstitial.load();

          // Timeout safety: if ad doesn't load within 2 seconds, resolve smoothly without blocking UI
          setTimeout(() => {
            if (!isShown) {
              unsubscribeLoaded();
              unsubscribeClosed();
              unsubscribeError();
              resolve(false);
            }
          }, 2000);
        });
      }
    } catch {
      // Graceful fallback for headless / test environments
    }
    return false;
  }
}

export const admobService = new AdMobService();

/**
 * AdBreakManager enforces discovery ad cadence rules:
 * - Introductory 30-day period: 1st ad after 20 profile swipes, then an ad break every 30 swipes.
 * - Post-introductory: ad break every 30 swipes.
 * - Reset the counter after each ad break.
 * - Separate ad counters from like quotas (counts both PASS and LIKE towards ad cadence).
 */
export class AdBreakManager {
  private swipeCount = 0;
  private firstAdShown = false;

  recordSwipe(isIntroductory: boolean = false): boolean {
    this.swipeCount += 1;
    const threshold = isIntroductory && !this.firstAdShown ? 20 : 30;

    if (this.swipeCount >= threshold) {
      this.swipeCount = 0;
      this.firstAdShown = true;
      return true;
    }
    return false;
  }

  getSwipeCount(): number {
    return this.swipeCount;
  }

  isFirstAdTriggered(): boolean {
    return this.firstAdShown;
  }

  reset(): void {
    this.swipeCount = 0;
    this.firstAdShown = false;
  }
}

export const adBreakManager = new AdBreakManager();

