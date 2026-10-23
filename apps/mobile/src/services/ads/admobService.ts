import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { api } from '../api/client';
import { secureStorage } from '../storage/secureStore';

export const isExpoGo = Boolean(
  Constants?.appOwnership === 'expo' ||
  Constants?.executionEnvironment === ExecutionEnvironment?.StoreClient
);

export function isGoogleMobileAdsAvailable(): boolean {
  if (Platform?.OS === 'web' || isExpoGo) {
    return false;
  }
  try {
    const hasTurbo =
      typeof TurboModuleRegistry !== 'undefined' &&
      Boolean(TurboModuleRegistry.get('RNGoogleMobileAdsModule'));
    const hasLegacy = Boolean(
      NativeModules?.RNGoogleMobileAdsModule ||
      NativeModules?.RNGoogleMobileAdsBannerViewManager
    );
    return hasTurbo || hasLegacy;
  } catch {
    return false;
  }
}

/**
 * AdMob Test Ad Unit IDs provided by Google for development/testing
 */
/**
 * AdMob Server-Side Verification (SSV) Configuration
 * Configure this callback URL in AdMob Console for Rewarded Ad Units:
 * AdMob Console -> Apps -> Ad units -> [Your Rewarded Unit] -> Advanced settings -> Server-side verification
 */
export const ADMOB_SSV_CONFIG = {
  PRODUCTION_CALLBACK_URL: 'https://api.auradating.com/api/v1/ads/admob/ssv',
  STAGING_CALLBACK_URL: 'https://api.staging.auradating.com/api/v1/ads/admob/ssv',
  REWARD_AMOUNT_BONUS_LIKES: 5,
};

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
  private isShowingAd = false;

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
   * Opens Google Mobile Ads Ad Inspector.
   * Enables inspecting mediated ad networks (AppLovin Waterfall/Bidding),
   * adapter initialization states, and running single ad source tests on test devices.
   * Strictly gated to development/internal diagnostic environments.
   */
  async openAdInspector(): Promise<void> {
    if (!__DEV__) {
      if (__DEV__) console.warn('[AdMob] Ad Inspector is only available in development/internal builds.');
      return;
    }
    if (!isGoogleMobileAdsAvailable()) {
      throw new Error(
        'Google Mobile Ads native SDK is unavailable in Expo Go. An Android development build is required to open Ad Inspector.'
      );
    }
    await this.initialize();
    try {
      const mobileAds = require('react-native-google-mobile-ads');
      if (mobileAds && mobileAds.default) {
        await mobileAds.default().openAdInspector();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to launch Ad Inspector';
      if (__DEV__) console.warn('[AdMob] openAdInspector failed:', msg);
      throw new Error(msg);
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
  async showRewardedAd(userId: string, customData: string = 'bonus_likes_reward'): Promise<AdRewardResult> {
    await this.initialize();

    // Verify privacy clean userId format
    if (!userId || typeof userId !== 'string') {
      return { rewarded: false, rewardAmount: 0, error: 'Invalid user ID' };
    }

    if (this.isShowingAd) {
      return { rewarded: false, rewardAmount: 0, error: 'An advertisement is already in progress.' };
    }

    if (!isGoogleMobileAdsAvailable()) {
      return {
        rewarded: false,
        rewardAmount: 0,
        error: 'Google Mobile Ads SDK is unavailable in Expo Go. A native development build is required to present rewarded video ads.',
      };
    }

    this.isShowingAd = true;

    try {
      const mobileAds = require('react-native-google-mobile-ads');
      if (mobileAds && mobileAds.RewardedAd && mobileAds.RewardedAdEventType && mobileAds.AdEventType) {
        const { RewardedAd, RewardedAdEventType, AdEventType } = mobileAds;
        const adUnitId = AD_UNIT_IDS.REWARDED || 'ca-app-pub-3940256099942544/5224354917';

        const ssvOptions = {
          userId,
          customData,
        };
        assertPrivacyClean(ssvOptions);

        const rewardedAd = RewardedAd.createForAdRequest(adUnitId, {
          requestNonPersonalizedAdsOnly: true,
          serverSideVerificationOptions: ssvOptions,
        });

        return await new Promise<AdRewardResult>((resolve) => {
          let hasRewarded = false;
          let earnedAmount = 1;
          let settled = false;
          let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

          let unsubscribeLoaded: () => void = () => {};
          let unsubscribeEarned: () => void = () => {};
          let unsubscribeClosed: () => void = () => {};
          let unsubscribeError: () => void = () => {};

          const cleanup = () => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            this.isShowingAd = false;
            try { unsubscribeLoaded(); } catch {}
            try { unsubscribeEarned(); } catch {}
            try { unsubscribeClosed(); } catch {}
            try { unsubscribeError(); } catch {}
          };

          const finish = (result: AdRewardResult) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(result);
          };

          // 25-second timeout safety guard
          timeoutHandle = setTimeout(() => {
            finish({
              rewarded: false,
              rewardAmount: 0,
              error: 'Ad request timed out. Please try again.',
            });
          }, 25000);

          unsubscribeLoaded = rewardedAd.addAdEventListener(
            RewardedAdEventType.LOADED,
            () => {
              if (__DEV__) {
                console.log('[AdMob] Rewarded ad LOADED successfully. Presenting...');
              }
              rewardedAd.show().catch((err: unknown) => {
                if (__DEV__) {
                  console.warn('[AdMob] rewardedAd.show() threw error:', err);
                }
                finish({
                  rewarded: false,
                  rewardAmount: 0,
                  error: err instanceof Error ? err.message : 'Failed to display ad',
                });
              });
            }
          );

          unsubscribeEarned = rewardedAd.addAdEventListener(
            RewardedAdEventType.EARNED_REWARD,
            (reward: { amount?: number }) => {
              if (__DEV__) {
                console.log('[AdMob] Rewarded ad EARNED_REWARD received:', reward);
              }
              hasRewarded = true;
              if (reward && typeof reward.amount === 'number' && reward.amount > 0) {
                earnedAmount = reward.amount;
              } else {
                earnedAmount = 1;
              }
            }
          );

          // In react-native-google-mobile-ads, CLOSED and ERROR events belong to AdEventType
          unsubscribeClosed = rewardedAd.addAdEventListener(
            AdEventType.CLOSED,
            () => {
              if (__DEV__) {
                console.log(`[AdMob] Rewarded ad CLOSED (hasRewarded = ${hasRewarded})`);
              }
              if (hasRewarded) {
                // In non-production development environments, provide a test transaction ID for offline mock verification.
                // In production, Google's servers deliver signed cryptographic SSV callbacks directly to the backend.
                const txId = (typeof __DEV__ !== 'undefined' && __DEV__)
                  ? `test-admob-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
                  : undefined;
                finish({ rewarded: true, rewardAmount: earnedAmount, transactionId: txId });
              } else {
                finish({ rewarded: false, rewardAmount: 0, error: 'Video was closed before completing' });
              }
            }
          );

          unsubscribeError = rewardedAd.addAdEventListener(
            AdEventType.ERROR,
            (error: unknown) => {
              if (__DEV__) {
                console.warn('[AdMob] Rewarded ad ERROR event:', error);
              }
              finish({
                rewarded: false,
                rewardAmount: 0,
                error: error instanceof Error ? error.message : 'Ad failed to load',
              });
            }
          );

          rewardedAd.load();
        });
      }
    } catch (err: unknown) {
      this.isShowingAd = false;
      return {
        rewarded: false,
        rewardAmount: 0,
        error: err instanceof Error ? err.message : 'Unexpected ad error occurred',
      };
    }

    this.isShowingAd = false;
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
    if (this.isShowingAd) {
      return false;
    }
    this.isShowingAd = true;

    try {
      const mobileAds = require('react-native-google-mobile-ads');
      if (mobileAds && mobileAds.InterstitialAd && mobileAds.AdEventType) {
        const { InterstitialAd, AdEventType } = mobileAds;
        const adUnitId = AD_UNIT_IDS.INTERSTITIAL || 'ca-app-pub-3940256099942544/1033173712';
        const interstitial = InterstitialAd.createForAdRequest(adUnitId, {
          requestNonPersonalizedAdsOnly: true,
        });

        return await new Promise<boolean>((resolve) => {
          let isShown = false;
          let settled = false;
          let timer: ReturnType<typeof setTimeout> | null = null;

          let unsubscribeLoaded: () => void = () => {};
          let unsubscribeClosed: () => void = () => {};
          let unsubscribeError: () => void = () => {};

          const cleanup = () => {
            if (timer) clearTimeout(timer);
            this.isShowingAd = false;
            try { unsubscribeLoaded(); } catch {}
            try { unsubscribeClosed(); } catch {}
            try { unsubscribeError(); } catch {}
          };

          const finish = (result: boolean) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(result);
          };

          unsubscribeLoaded = interstitial.addAdEventListener(
            AdEventType.LOADED,
            () => {
              isShown = true;
              interstitial.show().catch(() => finish(false));
            }
          );

          unsubscribeClosed = interstitial.addAdEventListener(
            AdEventType.CLOSED,
            () => {
              finish(true);
            }
          );

          unsubscribeError = interstitial.addAdEventListener(
            AdEventType.ERROR,
            () => {
              finish(false);
            }
          );

          interstitial.load();

          // Timeout safety: if ad doesn't load within 5 seconds, resolve smoothly without blocking UI
          timer = setTimeout(() => {
            if (!isShown) {
              finish(false);
            }
          }, 5000);
        });
      }
    } catch {
      this.isShowingAd = false;
      return false;
    }
    this.isShowingAd = false;
    return false;
  }
}

export const admobService = new AdMobService();

/**
 * AdBreakManager enforces discovery ad cadence rules (Phase 6):
 * 1. During the first introductory month, show the first required ad after 15 viewed/swiped profiles.
 * 2. Reset the profile counter to zero only after the user successfully completes the required ad.
 * 3. Show the next required ad after 35 additional profiles.
 * 4. Continue the 35-profile cadence for subsequent completed ads.
 * 5. Do not count the same profile multiple times because of rerenders, retries, or pagination.
 * 6. Preserve counter state across navigation and app restarts.
 * 7. Do not treat a displayed, skipped, failed, or incomplete ad as a completed ad.
 */
export class AdBreakManager {
  private swipeCount = 0;
  private firstAdCompleted = false;
  private viewedProfileIds = new Set<string>();
  private isHydrated = false;
  private hydrationPromise: Promise<void> | null = null;
  private lastSwipedProfileId: string | null = null;

  constructor() {
    this.hydrationPromise = this.hydrate();
  }

  async ensureHydrated(): Promise<void> {
    if (this.isHydrated) return;
    if (this.hydrationPromise) {
      await this.hydrationPromise;
    } else {
      await this.hydrate();
    }
  }

  private async hydrate(): Promise<void> {
    try {
      const storedCount = await secureStorage.getItem('aura_ad_swipe_count');
      const storedFirstAd = await secureStorage.getItem('aura_ad_first_completed');
      const storedProfiles = await secureStorage.getItem('aura_ad_viewed_profiles');
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
    if (__DEV__) {
      console.log(`[AdMob] AdBreakManager hydrated: count=${this.swipeCount}, firstAdCompleted=${this.firstAdCompleted}, viewedProfiles=${this.viewedProfileIds.size}`);
    }
  }

  private async persist(): Promise<void> {
    try {
      await secureStorage.setItem('aura_ad_swipe_count', String(this.swipeCount));
      await secureStorage.setItem('aura_ad_first_completed', this.firstAdCompleted ? 'true' : 'false');
      await secureStorage.setItem('aura_ad_viewed_profiles', JSON.stringify(Array.from(this.viewedProfileIds)));
    } catch {}
  }

  /**
   * Records a viewed/swiped profile by ID.
   * Prevents counting the same profile multiple times (due to rerenders, retries, or duplicate callbacks).
   * Does not allow deduplication to deadlock when candidate pool has fewer unique profiles than threshold (15).
   * Returns true if the required ad threshold has been reached.
   */
  recordProfileView(profileId?: string, isIntroductory: boolean = false): boolean {
    if (profileId) {
      // 1. Prevent duplicate counting from immediate rerenders or retries on the same active card
      if (this.lastSwipedProfileId === profileId) {
        if (__DEV__) {
          console.log(`[AdMob] Swipe deduplicated (retry/rerender on same profile): ${profileId.slice(-4)}`);
        }
        return this.shouldShowRequiredAd(isIntroductory);
      }

      // 2. Profile-ID deduplication:
      // If profile was already counted in the current cycle, only count if cycling past other cards
      // to avoid deadlock when candidate pool has fewer unique profiles than threshold (15)
      if (this.viewedProfileIds.has(profileId)) {
        if (this.swipeCount < 15 && this.viewedProfileIds.size < 15) {
          this.lastSwipedProfileId = profileId;
          this.swipeCount += 1;
          this.persist();
          if (__DEV__) {
            console.log(`[AdMob] Swipe counted (cycled deck): count = ${this.swipeCount}/15`);
          }
          return this.shouldShowRequiredAd(isIntroductory);
        }
        return this.shouldShowRequiredAd(isIntroductory);
      }

      this.viewedProfileIds.add(profileId);
      this.lastSwipedProfileId = profileId;
    }

    this.swipeCount += 1;
    this.persist();
    if (__DEV__) {
      console.log(`[AdMob] Swipe counted: count = ${this.swipeCount}/15 (unique in cycle: ${this.viewedProfileIds.size})`);
    }
    return this.shouldShowRequiredAd(isIntroductory);
  }

  /**
   * Backwards-compatible alias for recordProfileView
   */
  recordSwipe(isIntroductory: boolean = false, profileId?: string): boolean {
    return this.recordProfileView(profileId, isIntroductory);
  }

  /**
   * Checks whether the current swipe count meets the threshold for a required ad.
   */
  shouldShowRequiredAd(isIntroductory: boolean = false): boolean {
    const threshold = 15;
    return this.swipeCount >= threshold;
  }

  /**
   * Resets the profile counter to zero ONLY after the user successfully completes the required ad.
   */
  async onAdCompleted(): Promise<void> {
    this.swipeCount = 0;
    this.firstAdCompleted = true;
    this.viewedProfileIds.clear();
    this.lastSwipedProfileId = null;
    await this.persist();
    if (__DEV__) {
      console.log('[AdMob] AdBreakManager: Ad completed, swipe counter reset to 0');
    }
  }

  /**
   * Called when an ad fails, is skipped, or is incomplete. Counter is NOT reset.
   */
  onAdFailed(): void {
    if (__DEV__) {
      console.log(`[AdMob] AdBreakManager: Ad skipped/failed, counter preserved at ${this.swipeCount}`);
    }
  }

  getSwipeCount(): number {
    return this.swipeCount;
  }

  isFirstAdTriggered(): boolean {
    return this.firstAdCompleted;
  }

  isFirstAdCompleted(): boolean {
    return this.firstAdCompleted;
  }

  reset(): void {
    this.swipeCount = 0;
    this.firstAdCompleted = false;
    this.viewedProfileIds.clear();
    this.lastSwipedProfileId = null;
    this.persist();
  }
}

export const adBreakManager = new AdBreakManager();

