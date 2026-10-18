import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
  Dimensions,
  LayoutChangeEvent,
  FlatList,
  RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { colors, typography, spacing, borderRadius, useTheme } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';
import { DiscoveryCandidate, SwipeResponse, DiscoveryPreferences, DiscoveryMessagingQuota } from '../../src/types';
import { discoveryService } from '../../src/services/discovery/discoveryService';
import { DiscoveryCard } from '../../src/components/DiscoveryCard';
import { SponsoredCard } from '../../src/components/SponsoredCard';
import { DealbreakerEmptyState } from '../../src/components/DealbreakerEmptyState';
import { AgeVerificationBanner } from '../../src/components/AgeVerificationBanner';
import { MatchCelebrationModal } from '../../src/components/MatchCelebrationModal';
import { SwipeQuotaModal } from '../../src/components/SwipeQuotaModal';
import { DiscoveryMessageQuotaModal } from '../../src/components/DiscoveryMessageQuotaModal';
import { DiscoveryFilterModal } from '../../src/components/DiscoveryFilterModal';
import { QuickMessageComposer } from '../../src/components/QuickMessageComposer';
import { computeAndroidKeyboardCompensation } from '../../src/utils/keyboardAvoidance';
import { storeBilling } from '../../src/services/billing/storeBilling';
import { authService } from '../../src/services/auth/authService';
import { admobService, adBreakManager, SwipeAllowance, isGoogleMobileAdsAvailable } from '../../src/services/ads/admobService';
import { secureStorage } from '../../src/services/storage/secureStore';

const DISCOVERY_LAYOUT_KEY = 'aura_discovery_layout_mode';

export default function DiscoveryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isAgeVerified, profile, refreshProfile } = useAuth();
  const { colors } = useTheme();

  const [layoutMode, setLayoutMode] = useState<'single' | 'double'>('double');
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [preferences, setPreferences] = useState<DiscoveryPreferences | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [emptyStateReason, setEmptyStateReason] = useState<string>('');
  const [feedError, setFeedError] = useState<string | null>(null);
  const [nearbySummary, setNearbySummary] = useState<string>('');
  const [canRewind, setCanRewind] = useState(false);
  const [lastSwipedCandidate, setLastSwipedCandidate] = useState<DiscoveryCandidate | null>(null);
  const [showSponsoredBreak, setShowSponsoredBreak] = useState(false);
  const isSwipingRef = useRef(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [avoidancePadding, setAvoidancePadding] = useState<number>(0);
  const avoidancePaddingRef = useRef<number>(0);
  const idleContainerHeightRef = useRef<number>(0);
  const currentContainerHeightRef = useRef<number>(0);
  const isKeyboardOpenRef = useRef<boolean>(false);
  const lastKeyboardHeightRef = useRef<number>(0);
  const lastKeyboardScreenYRef = useRef<number>(0);
  const [cardRegionHeight, setCardRegionHeight] = useState<number>(0);

  // My Favourites (private bookmarks, no likes/swipes/matches triggered)
  const [favouriteUserIds, setFavouriteUserIds] = useState<Set<string>>(new Set());

  const loadFavourites = useCallback(async () => {
    try {
      const res = await discoveryService.getFavourites();
      if (res?.favourites && Array.isArray(res.favourites)) {
        setFavouriteUserIds(new Set(res.favourites.map((f) => f.user_id)));
      }
    } catch {
      // non-blocking
    }
  }, []);

  const handleToggleFavourite = useCallback(async (target: DiscoveryCandidate) => {
    const targetId = target.user_id || target.id;
    if (!targetId) return;

    const wasFav = favouriteUserIds.has(targetId);
    // Optimistic UI update
    setFavouriteUserIds((prev) => {
      const next = new Set(prev);
      if (wasFav) {
        next.delete(targetId);
      } else {
        next.add(targetId);
      }
      return next;
    });

    try {
      if (wasFav) {
        await discoveryService.removeFavourite(targetId);
      } else {
        await discoveryService.addFavourite(targetId);
      }
    } catch {
      // Rollback on network failure
      setFavouriteUserIds((prev) => {
        const next = new Set(prev);
        if (wasFav) {
          next.add(targetId);
        } else {
          next.delete(targetId);
        }
        return next;
      });
      Alert.alert('Bookmark Failed', 'Could not update favourite. Please check your connection.');
    }
  }, [favouriteUserIds]);

  // Load saved layout preference on initial mount
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const saved = await secureStorage.getItem(DISCOVERY_LAYOUT_KEY);
        if (isMounted && (saved === 'single' || saved === 'double')) {
          setLayoutMode(saved);
        }
      } catch {
        // default remains 'double'
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  // Ensure keyboard dismisses cleanly when leaving the Discovery tab & sync saved layout on refocus
  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      (async () => {
        try {
          const saved = await secureStorage.getItem(DISCOVERY_LAYOUT_KEY);
          if (isMounted && (saved === 'single' || saved === 'double')) {
            setLayoutMode(saved);
          }
        } catch {
          // ignore
        }
      })();
      loadFavourites();
      return () => {
        isMounted = false;
        Keyboard.dismiss();
      };
    }, [loadFavourites])
  );

  const selectLayoutMode = useCallback((mode: 'single' | 'double') => {
    setLayoutMode(mode);
    secureStorage.setItem(DISCOVERY_LAYOUT_KEY, mode).catch(() => {});
  }, []);

  const toggleLayoutMode = useCallback(() => {
    setLayoutMode((prev) => {
      const next = prev === 'double' ? 'single' : 'double';
      secureStorage.setItem(DISCOVERY_LAYOUT_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const composerRef = useRef<View>(null);

  const updateAndroidAvoidance = useCallback(
    (kbHeight: number, keyboardScreenY?: number) => {
      if (Platform.OS !== 'android') return;
      const screenH = Dimensions.get('screen').height;
      const idleH = idleContainerHeightRef.current;
      const currentH = currentContainerHeightRef.current;
      const effectiveIdleH = idleH > 0 ? idleH : screenH;
      const effectiveCurrentH = currentH > 0 ? currentH : effectiveIdleH;
      const nativeShrinkage = Math.max(0, effectiveIdleH - effectiveCurrentH);

      // In screen coordinates: when adjustResize does not shrink the window (Phone B),
      // the container bottom sits at screenH. The keyboard intrudes by screenH - keyboardScreenY.
      // Passing screenH as idleHeight guarantees consistent screen-space calculation with keyboardScreenY.
      const compensation = computeAndroidKeyboardCompensation({
        kbHeight,
        idleHeight: screenH,
        currentHeight: screenH - nativeShrinkage,
        bottomInset: insets.bottom,
        keyboardScreenY: keyboardScreenY || (kbHeight > 0 ? screenH - kbHeight : screenH),
      });
      avoidancePaddingRef.current = compensation;
      setAvoidancePadding(compensation);

      setTimeout(() => {
        try {
          const effectiveScreenY = keyboardScreenY || (kbHeight > 0 ? screenH - kbHeight : screenH);
          composerRef.current?.measureInWindow((ix, iy, iw, ih) => {
            const composerBottom = iy + ih;
            const isCovered = kbHeight > 0 && composerBottom > effectiveScreenY + 2;
            let verdict = 'HEALTHY';
            if (isCovered) {
              verdict = `COVERED_BY_KEYBOARD (composer bottom ${composerBottom.toFixed(1)}px > keyboard top ${effectiveScreenY}px by ${(composerBottom - effectiveScreenY).toFixed(1)}px)`;
            } else {
              verdict = `HEALTHY (composer bottom ${composerBottom.toFixed(1)}px <= keyboard top ${effectiveScreenY}px by ${(effectiveScreenY - composerBottom).toFixed(1)}px)`;
            }

            console.log(
              '[AURA_DISCOVERY_LAYOUT_AUDIT]',
              JSON.stringify({
                trigger: 'composer_layout_verified',
                state: 'OPEN',
                verdict,
                kbHeight: Math.round(kbHeight),
                keyboardScreenY: Math.round(effectiveScreenY),
                composer: { y: Math.round(iy), height: Math.round(ih), bottom: Math.round(composerBottom) },
                compensation: Math.round(compensation),
                insets: { top: insets.top, bottom: insets.bottom },
              })
            );
          });
        } catch {
          // non-blocking
        }
      }, 50);
    },
    [insets.bottom, insets.top]
  );

  const handleContainerLayout = (e: LayoutChangeEvent) => {
    const height = e.nativeEvent.layout.height;
    currentContainerHeightRef.current = height;
    if (!isKeyboardOpenRef.current && height > 0) {
      if (idleContainerHeightRef.current === 0 || height >= idleContainerHeightRef.current - 50) {
        idleContainerHeightRef.current = height;
      }
    } else if (isKeyboardOpenRef.current && Platform.OS === 'android') {
      updateAndroidAvoidance(lastKeyboardHeightRef.current, lastKeyboardScreenYRef.current);
    }
  };

  // Monitor software keyboard visibility for responsive Discovery layout
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      setIsKeyboardOpen(true);
      isKeyboardOpenRef.current = true;
      const kbH = e?.endCoordinates?.height || 0;
      const kbScreenY = e?.endCoordinates?.screenY;
      lastKeyboardHeightRef.current = kbH;
      if (kbScreenY) {
        lastKeyboardScreenYRef.current = kbScreenY;
      }
      updateAndroidAvoidance(kbH, kbScreenY);
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setIsKeyboardOpen(false);
      isKeyboardOpenRef.current = false;
      lastKeyboardHeightRef.current = 0;
      avoidancePaddingRef.current = 0;
      setAvoidancePadding(0);

      try {
        console.log(
          '[AURA_DISCOVERY_LAYOUT_AUDIT]',
          JSON.stringify({
            trigger: 'keyboard_hidden',
            state: 'CLOSED',
            compensation: 0,
          })
        );
      } catch {
        // non-blocking audit
      }
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [updateAndroidAvoidance]);

  // Match Celebration Modal state
  const [matchedCandidate, setMatchedCandidate] = useState<DiscoveryCandidate | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // Daily Swipe Quota & Rewarded Ad Modal state
  const [allowance, setAllowance] = useState<SwipeAllowance | null>(null);
  const [showQuotaModal, setShowQuotaModal] = useState(false);

  // Discovery Messaging Quota (2 distinct profiles, 10m cooldown, rewarded ad unlock)
  const [messageQuota, setMessageQuota] = useState<DiscoveryMessagingQuota | null>(null);
  const [showMessageQuotaModal, setShowMessageQuotaModal] = useState(false);

  const loadMessagingQuota = useCallback(async () => {
    try {
      const q = await discoveryService.getMessagingQuota();
      setMessageQuota(q);
      return q;
    } catch {
      // non-blocking
      return null;
    }
  }, []);

  const isLoadingMoreRef = useRef(false);
  const nextCursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const prefetchNextBatch = useCallback(async () => {
    if (isLoadingMoreRef.current || !hasMoreRef.current) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const cursor = nextCursorRef.current || undefined;
      const feedRes = await discoveryService.getFeed(20, cursor);
      if (feedRes?.candidates && feedRes.candidates.length > 0) {
        setCandidates((prev) => {
          const existing = new Set(prev.map((c) => c.user_id));
          const unique = feedRes.candidates.filter((c) => !existing.has(c.user_id));
          return [...prev, ...unique];
        });
      }
      nextCursorRef.current = feedRes?.next_cursor || null;
      hasMoreRef.current = Boolean(feedRes?.next_cursor);
      if (feedRes?.empty_state_reason && (!feedRes.candidates || feedRes.candidates.length === 0)) {
        setEmptyStateReason(feedRes.empty_state_reason);
      }
    } catch {
      // Background prefetch error should not interrupt browsing
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, []);

  const loadFeed = useCallback(async () => {
    setIsLoading(true);
    setFeedError(null);
    nextCursorRef.current = null;
    hasMoreRef.current = true;
    try {
      const feedRes = await discoveryService.getFeed(20);
      setCandidates(feedRes.candidates || []);
      setCurrentIndex(0);
      nextCursorRef.current = feedRes.next_cursor || null;
      hasMoreRef.current = Boolean(feedRes.next_cursor);
      setEmptyStateReason(feedRes.empty_state_reason || '');

      const summaryRes = await discoveryService.getMatchingSummary();
      setNearbySummary(summaryRes.nearby_count_bracket);

      const entitlements = await storeBilling.getActiveEntitlements();
      const rawEnts = entitlements?.entitlements;
      const entitlementList: string[] = Array.isArray(rawEnts)
        ? rawEnts.map((e: any) => (typeof e === 'string' ? e : e?.entitlement_code || ''))
        : [];
      setCanRewind(entitlementList.includes('REWIND'));

      const allowRes = await admobService.getSwipeAllowance();
      setAllowance(allowRes);
      loadMessagingQuota();

      try {
        const prefs = await discoveryService.getPreferences();
        setPreferences(prefs);
      } catch {
        // fallback
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : (err?.message || 'Could not load discovery feed.');
      setFeedError(msg);
      if (err?.code === 'AGE_VERIFICATION_REQUIRED' || err?.status === 403) {
        setEmptyStateReason('AGE_VERIFICATION_REQUIRED');
        await refreshProfile();
      }
    } finally {
      setIsLoading(false);
    }
  }, [refreshProfile]);

  const hasActiveFilters = Boolean(
    preferences && (
      (preferences.min_age && preferences.min_age > 18) ||
      (preferences.max_age && preferences.max_age < 99) ||
      (preferences.min_height_cm && preferences.min_height_cm > 90) ||
      (preferences.max_height_cm && preferences.max_height_cm < 250) ||
      (preferences.min_weight_kg && preferences.min_weight_kg > 30) ||
      (preferences.max_weight_kg && preferences.max_weight_kg < 300) ||
      preferences.verified_profiles_only ||
      preferences.verified_only ||
      (preferences.preferred_orientations && preferences.preferred_orientations.length > 0) ||
      (preferences.dealbreakers && (
        preferences.dealbreakers.non_smoker_only ||
        preferences.dealbreakers.require_verified ||
        preferences.dealbreakers.require_monogamous
      ))
    )
  );

  useEffect(() => {
    loadFeed();
    loadFavourites();
  }, [loadFeed, loadFavourites]);

  // Auto-replenish: when the user reaches near the end of the current deck, automatically load the next batch
  useEffect(() => {
    if (candidates.length <= 4 && !isLoading && hasMoreRef.current) {
      prefetchNextBatch();
    }
  }, [candidates.length, isLoading, prefetchNextBatch]);

  const handleCheckVerificationStatus = async () => {
    try {
      const statusRes = await authService.getAgeAssuranceStatus();
      if (statusRes?.status === 'VERIFIED') {
        await refreshProfile();
        Alert.alert(
          'Age Verified',
          'Your 18+ age verification is approved! Likes, mutual matching, and messaging are now fully unlocked.'
        );
      } else if (statusRes?.status === 'REJECTED') {
        Alert.alert(
          'Verification Rejected',
          'We were unable to verify your age with the submitted selfie. Please submit a new verification selfie.',
          [
            { text: 'Retake Selfie', onPress: () => router.push('/(auth)/verify-age') },
            { text: 'Dismiss', style: 'cancel' },
          ]
        );
      } else {
        Alert.alert(
          'Verification Pending',
          'Your age verification is currently being reviewed by our team. You can continue browsing profiles in the meantime.'
        );
      }
    } catch {
      Alert.alert('Status Check Failed', 'Could not reach verification service. Please try again.');
    }
  };

  const [superLikeToast, setSuperLikeToast] = useState<string | null>(null);
  const showSuperLikeToast = useCallback((msg: string = 'Super Like sent ⭐') => {
    setSuperLikeToast(msg);
    setTimeout(() => {
      setSuperLikeToast(null);
    }, 3200);
  }, []);

  const handleSuperSpark = async (candidate: DiscoveryCandidate): Promise<SwipeResponse> => {
    if (allowance && !allowance.isUnlimited && allowance.remainingLikes <= 0) {
      setShowQuotaModal(true);
      throw new Error('SWIPE_LIMIT_REACHED');
    }

    isSwipingRef.current = true;
    try {
      const res = await discoveryService.swipe(candidate.user_id, 'SUPER_SPARK');
      if (allowance && !allowance.isUnlimited) {
        setAllowance((prev) =>
          prev ? { ...prev, remainingLikes: Math.max(0, prev.remainingLikes - 1) } : null
        );
      }
      return res;
    } catch (err: unknown) {
      isSwipingRef.current = false;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('SWIPE_LIMIT_REACHED') || errMsg.includes('limit reached')) {
        setShowQuotaModal(true);
      } else {
        Alert.alert('Super Like Failed', 'Could not deliver Super Like. Please try again.');
      }
      throw err;
    }
  };

  const handleSuperSparkComplete = (candidate: DiscoveryCandidate, res?: SwipeResponse | null) => {
    isSwipingRef.current = false;
    setLastSwipedCandidate(candidate);
    setCandidates((prev) => prev.filter((c) => c.user_id !== candidate.user_id));

    if (candidates.length <= 4) {
      prefetchNextBatch();
    }

    if (res?.is_mutual_match) {
      setMatchedCandidate(candidate);
      setActiveConversationId(res.conversation_id || null);
    } else {
      showSuperLikeToast('Super Like sent ⭐');
    }
  };

  const handleSwipe = async (direction: 'LIKE' | 'PASS' | 'SUPER_SPARK', introNote?: string) => {
    Keyboard.dismiss();
    if (isSwipingRef.current) return;
    const candidate = candidates[0];
    if (!candidate) return;

    if (direction === 'SUPER_SPARK') {
      try {
        const res = await handleSuperSpark(candidate);
        handleSuperSparkComplete(candidate, res);
        return res;
      } catch (err) {
        return;
      }
    }

    // Check client-side quota if limited and trying to LIKE
    if (direction !== 'PASS' && allowance && !allowance.isUnlimited && allowance.remainingLikes <= 0) {
      setShowQuotaModal(true);
      return;
    }

    // Check Discovery messaging quota if initiating an Intro Note
    if (introNote && messageQuota && !messageQuota.is_unlimited && messageQuota.is_locked) {
      setShowMessageQuotaModal(true);
      return;
    }

    isSwipingRef.current = true;
    setLastSwipedCandidate(candidate);
    setCandidates((prev) => prev.slice(1));

    // Continuous browsing: prefetch next batch when approaching end of deck
    if (candidates.length <= 4) {
      prefetchNextBatch();
    }

    if (direction !== 'PASS' && allowance && !allowance.isUnlimited) {
      setAllowance((prev) =>
        prev ? { ...prev, remainingLikes: Math.max(0, prev.remainingLikes - 1) } : null
      );
    }

    // Trigger full-screen interstitial ad break after every 15 unique browsed profiles for free users
    const isFreeUser = !allowance || !allowance.isUnlimited;
    if (isFreeUser && isGoogleMobileAdsAvailable()) {
      const shouldTriggerBreak = adBreakManager.recordProfileView(candidate.user_id, true);
      if (shouldTriggerBreak) {
        admobService.showInterstitialAd().then((completed) => {
          if (completed) {
            adBreakManager.onAdCompleted();
          } else {
            adBreakManager.onAdFailed();
          }
        }).catch(() => {
          adBreakManager.onAdFailed();
        });
      }
    }

    try {
      const res: SwipeResponse = await discoveryService.swipe(candidate.user_id, direction, introNote);
      if (res.is_mutual_match) {
        setMatchedCandidate(candidate);
        setActiveConversationId(res.conversation_id || null);
      } else if (introNote) {
        Alert.alert(
          'Intro Note Sent',
          `Your message request was delivered to ${candidate.display_name}. When they like you back, you'll be connected in Chat.`
        );
      }
      if (introNote) {
        loadMessagingQuota().then((updated) => {
          if (updated && !updated.is_unlimited && updated.is_locked) {
            setShowMessageQuotaModal(true);
          }
        });
      }
      return res;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes('DISCOVERY_MESSAGE_QUOTA_LOCKED') ||
        errMsg.includes('USAGE_LIMIT_REACHED') ||
        errMsg.includes('usage limit') ||
        errMsg.includes('cooldown is active') ||
        errMsg.includes('quota exhausted')
      ) {
        setShowMessageQuotaModal(true);
        loadMessagingQuota();
        setCandidates((prev) => [candidate, ...prev]);
      } else if (
        errMsg.includes('AWAITING_REPLY') ||
        errMsg.includes('cannot send another message until recipient replies')
      ) {
        Alert.alert(
          'Waiting for Reply',
          'You can only send one initial message to this profile until they reply.',
          [{ text: 'OK', style: 'default' }]
        );
        setCandidates((prev) => [candidate, ...prev]);
      } else if (errMsg.includes('BONUS_LIKES_VERIFIED_ONLY') || errMsg.includes('photo-verified')) {
        Alert.alert(
          'Photo-Verified Profiles Only',
          'Bonus likes earned from sponsored videos can only be used on photo-verified profiles. You can continue passing or upgrade for unlimited likes.',
          [
            { text: 'Upgrade to Plus', onPress: () => router.push('/(tabs)/membership') },
            { text: 'Got It', style: 'cancel' },
          ]
        );
        setCandidates((prev) => [candidate, ...prev]);
      } else if (errMsg.includes('SWIPE_LIMIT_REACHED') || errMsg.includes('limit reached')) {
        setShowQuotaModal(true);
        setCandidates((prev) => [candidate, ...prev]);
      } else {
        if (introNote) {
          Alert.alert('Send Failed', 'Could not deliver intro note. Please check your connection and try again.');
          setCandidates((prev) => [candidate, ...prev]);
        }
      }
      if (introNote) {
        throw err;
      }
    } finally {
      isSwipingRef.current = false;
    }
  };

  const handleRewind = async () => {
    if (!canRewind) {
      Alert.alert(
        'Aura Plus Feature',
        'Rewinding your last pass requires an active Aura Plus or Aura Black membership.',
        [
          { text: 'Upgrade to Plus', onPress: () => router.push('/(tabs)/membership') },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    try {
      await discoveryService.rewind();
      if (lastSwipedCandidate) {
        setCandidates((prev) => [lastSwipedCandidate, ...prev]);
        Alert.alert('Rewound', `Restored ${lastSwipedCandidate.display_name} to your deck.`);
      }
    } catch (err) {
      Alert.alert('Rewind Unavailable', 'Could not undo your last swipe.');
    }
  };

  const handleSwipeForCandidate = async (
    candidate: DiscoveryCandidate,
    direction: 'LIKE' | 'PASS' | 'SUPER_SPARK',
    introNote?: string
  ) => {
    Keyboard.dismiss();
    if (candidates.length > 0 && candidate.user_id === candidates[0].user_id) {
      return await handleSwipe(direction, introNote);
    }

    if (isSwipingRef.current) return;

    if (direction === 'SUPER_SPARK') {
      try {
        const res = await handleSuperSpark(candidate);
        handleSuperSparkComplete(candidate, res);
        return res;
      } catch (err) {
        return;
      }
    }

    if (direction !== 'PASS' && allowance && !allowance.isUnlimited && allowance.remainingLikes <= 0) {
      setShowQuotaModal(true);
      return;
    }

    if (introNote && messageQuota && !messageQuota.is_unlimited && messageQuota.is_locked) {
      setShowMessageQuotaModal(true);
      return;
    }

    isSwipingRef.current = true;
    setLastSwipedCandidate(candidate);

    setCandidates((prev) => prev.filter((c) => c.user_id !== candidate.user_id));

    if (candidates.length <= 4) {
      prefetchNextBatch();
    }

    if (direction !== 'PASS' && allowance && !allowance.isUnlimited) {
      setAllowance((prev) =>
        prev ? { ...prev, remainingLikes: Math.max(0, prev.remainingLikes - 1) } : null
      );
    }

    const isFreeUser = !allowance || !allowance.isUnlimited;
    if (isFreeUser && isGoogleMobileAdsAvailable()) {
      const shouldTriggerBreak = adBreakManager.recordProfileView(candidate.user_id, true);
      if (shouldTriggerBreak) {
        admobService
          .showInterstitialAd()
          .then((completed) => {
            if (completed) {
              adBreakManager.onAdCompleted();
            } else {
              adBreakManager.onAdFailed();
            }
          })
          .catch(() => {
            adBreakManager.onAdFailed();
          });
      }
    }

    try {
      const res: SwipeResponse = await discoveryService.swipe(candidate.user_id, direction, introNote);
      if (res.is_mutual_match) {
        setMatchedCandidate(candidate);
        setActiveConversationId(res.conversation_id || null);
      } else if (introNote) {
        Alert.alert(
          'Intro Note Sent',
          `Your message request was delivered to ${candidate.display_name}. When they like you back, you'll be connected in Chat.`
        );
      }
      if (introNote) {
        loadMessagingQuota().then((updated) => {
          if (updated && !updated.is_unlimited && updated.is_locked) {
            setShowMessageQuotaModal(true);
          }
        });
      }
      return res;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes('DISCOVERY_MESSAGE_QUOTA_LOCKED') ||
        errMsg.includes('USAGE_LIMIT_REACHED') ||
        errMsg.includes('usage limit') ||
        errMsg.includes('cooldown is active') ||
        errMsg.includes('quota exhausted')
      ) {
        setShowMessageQuotaModal(true);
        loadMessagingQuota();
        setCandidates((prev) => [candidate, ...prev]);
      } else if (
        errMsg.includes('AWAITING_REPLY') ||
        errMsg.includes('cannot send another message until recipient replies')
      ) {
        Alert.alert(
          'Waiting for Reply',
          'You can only send one initial message to this profile until they reply.',
          [{ text: 'OK', style: 'default' }]
        );
        setCandidates((prev) => [candidate, ...prev]);
      } else if (errMsg.includes('BONUS_LIKES_VERIFIED_ONLY') || errMsg.includes('photo-verified')) {
        Alert.alert(
          'Photo-Verified Profiles Only',
          'Bonus likes earned from sponsored videos can only be used on photo-verified profiles. You can continue passing or upgrade for unlimited likes.',
          [
            { text: 'Upgrade to Plus', onPress: () => router.push('/(tabs)/membership') },
            { text: 'Got It', style: 'cancel' },
          ]
        );
        setCandidates((prev) => [candidate, ...prev]);
      } else if (errMsg.includes('SWIPE_LIMIT_REACHED') || errMsg.includes('limit reached')) {
        setShowQuotaModal(true);
        setCandidates((prev) => [candidate, ...prev]);
      } else {
        if (introNote) {
          Alert.alert('Send Failed', 'Could not deliver intro note. Please check your connection and try again.');
          setCandidates((prev) => [candidate, ...prev]);
        }
      }
      if (introNote) {
        throw err;
      }
    } finally {
      isSwipingRef.current = false;
    }
  };

  const activeCandidate = candidates[0];

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoidContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        {/* Top Header */}
        <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
          <View style={styles.brandGroup}>
            <Text style={[styles.brandTitle, { color: colors.text }]}>AURA</Text>
            <Text style={[styles.brandSubtitle, { color: colors.gold }]}>Exclusive Discovery</Text>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity
              style={[styles.searchButton, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => router.push('/search')}
              activeOpacity={0.7}
              testID="discovery-search-button"
            >
              <Text style={styles.searchIcon}>🔍</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.filterButton, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setShowFilterModal(true)}
              activeOpacity={0.7}
              testID="discovery-filter-button"
            >
              <Text style={styles.filterIcon}>🎛️</Text>
              {hasActiveFilters && <View style={[styles.filterActiveDot, { backgroundColor: colors.gold }]} />}
            </TouchableOpacity>

            <View style={styles.headerBadges}>
              {allowance ? (
                <View style={[styles.allowancePill, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]} testID="allowance-badge">
                  <Text style={[styles.allowanceText, { color: colors.gold }]}>
                    {allowance.isIntroductory
                      ? '✨ 30-Day Free Intro'
                      : allowance.isUnlimited
                      ? '✨ Unlimited'
                      : `💛 ${allowance.remainingLikes}/${allowance.dailyQuota} Likes`}
                  </Text>
                </View>
              ) : null}

              {nearbySummary ? (
                <View style={[styles.summaryPill, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.summaryText, { color: colors.textMuted }]}>📍 {nearbySummary} nearby</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* Mandatory Age Assurance Gating Notice - collapsed while typing for vertical clearance */}
        {!isAgeVerified && !isKeyboardOpen && (
          <AgeVerificationBanner
            onVerifyPress={() => router.push('/(auth)/verify-age')}
            onCheckStatus={handleCheckVerificationStatus}
          />
        )}

        {/* Discovery Incomplete Notice if Height or Weight Missing */}
        {(!profile?.height_cm || !profile?.weight_kg) && !isKeyboardOpen && (
          <TouchableOpacity
            style={styles.incompleteBanner}
            onPress={() => router.push('/(tabs)/profile')}
            activeOpacity={0.8}
          >
            <View style={styles.incompleteBannerLeft}>
              <Text style={styles.incompleteBannerIcon}>⚠️</Text>
              <View>
                <Text style={styles.incompleteBannerTitle}>Profile Incomplete for Discovery</Text>
                <Text style={styles.incompleteBannerSubtitle}>Add height and weight to unlock matching in feeds</Text>
              </View>
            </View>
            <Text style={styles.incompleteBannerAction}>Complete ➔</Text>
          </TouchableOpacity>
        )}

        {/* Discovery Layout Toggle: Single Column vs Double Column (Positioned below banners, directly above profile cards) */}
        {!isKeyboardOpen && (
          <View style={styles.layoutToggleBarContainer}>
            <View
              style={[styles.layoutSegmentedContainer, { backgroundColor: colors.card, borderColor: colors.border }]}
              testID="discovery-layout-toggle"
            >
              <TouchableOpacity
                style={[
                  styles.layoutSegmentBtn,
                  layoutMode === 'single' && styles.layoutSegmentBtnActive,
                ]}
                onPress={() => selectLayoutMode('single')}
                activeOpacity={0.7}
                testID="discovery-layout-single"
                accessibilityLabel="Single column layout"
                accessibilityRole="button"
                accessibilityState={{ selected: layoutMode === 'single' }}
              >
                <View
                  style={[
                    styles.layoutIconSingle,
                    { borderColor: layoutMode === 'single' ? colors.gold : colors.textMuted },
                  ]}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.layoutSegmentBtn,
                  layoutMode === 'double' && styles.layoutSegmentBtnActive,
                ]}
                onPress={() => selectLayoutMode('double')}
                activeOpacity={0.7}
                testID="discovery-layout-double"
                accessibilityLabel="Double column layout"
                accessibilityRole="button"
                accessibilityState={{ selected: layoutMode === 'double' }}
              >
                <View style={styles.layoutIconGrid}>
                  <View style={[styles.layoutGridDot, { backgroundColor: layoutMode === 'double' ? colors.gold : colors.textMuted }]} />
                  <View style={[styles.layoutGridDot, { backgroundColor: layoutMode === 'double' ? colors.gold : colors.textMuted }]} />
                  <View style={[styles.layoutGridDot, { backgroundColor: layoutMode === 'double' ? colors.gold : colors.textMuted }]} />
                  <View style={[styles.layoutGridDot, { backgroundColor: layoutMode === 'double' ? colors.gold : colors.textMuted }]} />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Main Deck Container */}
        <View
          style={[styles.content, isKeyboardOpen && styles.contentKeyboard]}
          onLayout={handleContainerLayout}
        >
          {isLoading || (currentIndex >= candidates.length && (hasMoreRef.current || isLoadingMore)) ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={colors.gold} size="large" />
              <Text style={styles.loadingText}>Curating your exclusive deck...</Text>
            </View>
          ) : showSponsoredBreak ? (
            <SponsoredCard
              onDismiss={() => {
                setShowSponsoredBreak(false);
                adBreakManager.onAdCompleted();
              }}
            />
          ) : activeCandidate ? (
            layoutMode === 'double' ? (
              <View style={styles.doubleGridWrapper}>
                {superLikeToast && (
                  <View style={styles.superLikeToastPill} pointerEvents="none">
                    <Text style={styles.superLikeToastText}>{superLikeToast}</Text>
                  </View>
                )}
                <FlatList
                  testID="discovery-double-column-grid"
                  data={candidates}
                  keyExtractor={(item, index) => item.user_id || item.id || `candidate-${index}`}
                  numColumns={2}
                  columnWrapperStyle={styles.doubleColumnWrapper}
                  contentContainerStyle={[
                    styles.doubleGridContent,
                    { paddingBottom: insets.bottom + 90 },
                  ]}
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item }) => (
                    <DiscoveryCard
                      candidate={item}
                      layout="double"
                      isFavourite={favouriteUserIds.has(item.user_id || item.id)}
                      onToggleFavourite={() => handleToggleFavourite(item)}
                      onLike={() => handleSwipeForCandidate(item, 'LIKE')}
                      onPass={() => handleSwipeForCandidate(item, 'PASS')}
                      onSuperSpark={() => handleSuperSpark(item)}
                      onSuperSparkComplete={(res) => handleSuperSparkComplete(item, res)}
                      messageQuota={messageQuota}
                      onQuotaPress={() => setShowMessageQuotaModal(true)}
                      onQuotaUpdated={setMessageQuota}
                      onSendIntroNote={async (note) => {
                        await handleSwipeForCandidate(item, 'LIKE', note);
                      }}
                    />
                  )}
                  onEndReached={() => {
                    if (hasMoreRef.current && !isLoadingMore) {
                      prefetchNextBatch();
                    }
                  }}
                  onEndReachedThreshold={0.4}
                  refreshControl={
                    <RefreshControl
                      refreshing={isLoading}
                      onRefresh={loadFeed}
                      tintColor={colors.gold}
                      colors={[colors.gold]}
                    />
                  }
                />
              </View>
            ) : (
              <View
                style={[
                  styles.deckContainer,
                  isKeyboardOpen && styles.deckContainerKeyboard,
                  Platform.OS === 'android' && avoidancePadding > 0 && { paddingBottom: avoidancePadding },
                ]}
              >
                {superLikeToast && (
                  <View style={styles.superLikeToastPill} pointerEvents="none">
                    <Text style={styles.superLikeToastText}>{superLikeToast}</Text>
                  </View>
                )}
                {/* Region 1: Flexible Card Area (Takes remaining space, scales down to fit) */}
                <TouchableWithoutFeedback
                  disabled={!isKeyboardOpen}
                  onPress={Keyboard.dismiss}
                  accessible={false}
                >
                  <View
                    style={[styles.cardRegion, isKeyboardOpen && styles.cardRegionKeyboard]}
                    onLayout={(e) => {
                      const h = e.nativeEvent.layout.height;
                      if (h > 0 && Math.abs(h - cardRegionHeight) > 2) {
                        setCardRegionHeight(h);
                      }
                    }}
                  >
                    <DiscoveryCard
                      key={activeCandidate.user_id || activeCandidate.id || 'candidate-active'}
                      candidate={activeCandidate}
                      layout="single"
                      isFavourite={favouriteUserIds.has(activeCandidate.user_id || activeCandidate.id)}
                      onToggleFavourite={() => handleToggleFavourite(activeCandidate)}
                      onLike={() => handleSwipe('LIKE')}
                      onPass={() => handleSwipe('PASS')}
                      onSuperSpark={() => handleSuperSpark(activeCandidate)}
                      onSuperSparkComplete={(res) => handleSuperSparkComplete(activeCandidate, res)}
                      onRewind={handleRewind}
                      canRewind={canRewind && Boolean(lastSwipedCandidate)}
                      isKeyboardOpen={isKeyboardOpen}
                      maxCardHeight={cardRegionHeight}
                      messageQuota={messageQuota}
                      onQuotaPress={() => setShowMessageQuotaModal(true)}
                      onQuotaUpdated={setMessageQuota}
                      onSendIntroNote={async (note) => {
                        await handleSwipe('LIKE', note);
                      }}
                    />
                  </View>
                </TouchableWithoutFeedback>

                {/* Region 2: Dedicated Composer Area (Pinned right above keyboard) */}
                <View ref={composerRef} style={[styles.composerRegion, isKeyboardOpen && styles.composerRegionKeyboard]}>
                  <QuickMessageComposer
                    recipientId={activeCandidate.user_id || activeCandidate.id}
                    recipientName={activeCandidate.display_name}
                    onFocus={() => setIsKeyboardOpen(true)}
                    quota={messageQuota}
                    onQuotaPress={() => setShowMessageQuotaModal(true)}
                    onSend={async (note) => {
                      await handleSwipe('LIKE', note);
                    }}
                  />
                </View>
              </View>
            )
          ) : emptyStateReason === 'PHOTO_MINIMUM_REQUIRED' ? (
          <View style={styles.lockContainer} testID="photo-minimum-feed-state">
            <View style={[styles.lockIconCircle, { backgroundColor: colors.card, borderColor: colors.gold }]}>
              <Text style={styles.lockIcon}>📸</Text>
            </View>
            <Text style={[styles.lockTitle, { color: colors.text }]}>3 Photos Minimum Required</Text>
            <Text style={[styles.lockSubtitle, { color: colors.gold }]}>AUTHENTICITY STANDARD</Text>
            <Text style={[styles.lockDescription, { color: colors.textMuted }]}>
              To maintain high authenticity and prevent empty accounts, you must upload at least 3 approved profile
              photos before you can browse and match with other members.
            </Text>
            <View style={styles.lockButtonsContainer}>
              <TouchableOpacity
                style={[styles.lockPrimaryButton, { backgroundColor: colors.gold }]}
                onPress={() => router.push('/(tabs)/profile')}
                activeOpacity={0.8}
              >
                <Text style={[styles.lockPrimaryButtonText, { color: colors.textInverse }]}>Upload Profile Photos</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.lockSecondaryButton, { borderColor: colors.border }]}
                onPress={loadFeed}
                activeOpacity={0.8}
              >
                <Text style={[styles.lockSecondaryButtonText, { color: colors.text }]}>Refresh Deck</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : !isAgeVerified ? (
          emptyStateReason === 'AGE_VERIFICATION_REQUIRED' ? (
            <View style={styles.lockContainer} testID="age-locked-feed-state">
              <View style={[styles.lockIconCircle, { backgroundColor: colors.card, borderColor: colors.gold }]}>
                <Text style={styles.lockIcon}>🛡️</Text>
              </View>
              <Text style={[styles.lockTitle, { color: colors.text }]}>18+ Age Assurance Required</Text>
              <Text style={[styles.lockSubtitle, { color: colors.gold }]}>MANDATORY COMMUNITY PROTECTION</Text>
              <Text style={[styles.lockDescription, { color: colors.textMuted }]}>
                Dating discovery, matching, and messaging are locked until your adult status is confirmed. Complete a
                quick verification selfie to unlock the deck and connect with members waiting nearby.
              </Text>
              <View style={styles.lockButtonsContainer}>
                <TouchableOpacity
                  style={[styles.lockPrimaryButton, { backgroundColor: colors.gold }]}
                  onPress={() => router.push('/(auth)/verify-age')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.lockPrimaryButtonText, { color: colors.textInverse }]}>Complete Age Verification</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.lockSecondaryButton, { borderColor: colors.border }]}
                  onPress={handleCheckVerificationStatus}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.lockSecondaryButtonText, { color: colors.text }]}>Check Verification Status</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <DealbreakerEmptyState
              onAdjustFilters={() => router.push('/(tabs)/profile')}
              onRefresh={loadFeed}
              reason={emptyStateReason}
              errorMessage={feedError}
            />
          )
        ) : (
          <DealbreakerEmptyState
            onAdjustFilters={() => router.push('/(tabs)/profile')}
            onRefresh={loadFeed}
            reason={emptyStateReason}
            errorMessage={feedError}
          />
        )}
      </View>

      {/* Mutual Match Celebration Modal */}
      {matchedCandidate && (
        <MatchCelebrationModal
          visible={Boolean(matchedCandidate)}
          onClose={() => setMatchedCandidate(null)}
          onSendMessage={() => {
            const cid = activeConversationId;
            const cname = matchedCandidate.display_name;
            const uid = matchedCandidate.user_id;
            setMatchedCandidate(null);
            if (cid) {
              router.push({
                pathname: '/chat/[id]',
                params: {
                  id: cid,
                  name: cname,
                  recipientId: uid,
                  avatar: matchedCandidate.photos?.[0]?.url || '',
                },
              });
            } else {
              router.push('/(tabs)/chat');
            }
          }}
          targetName={matchedCandidate.display_name}
          targetPhoto={matchedCandidate.photos?.[0]?.url}
          myPhoto={profile?.photos?.[0]?.url}
        />
      )}

      {/* Daily Swipe Quota & Rewarded Ad Modal */}
      <SwipeQuotaModal
        visible={showQuotaModal}
        userId={profile?.id || 'aura_user'}
        onClose={() => setShowQuotaModal(false)}
        onRewardGranted={async (bonusAmount) => {
          try {
            const updated = await admobService.getSwipeAllowance();
            setAllowance(updated);
          } catch {
            setAllowance((prev) =>
              prev
                ? { ...prev, remainingLikes: prev.remainingLikes + (bonusAmount || 5) }
                : { remainingLikes: bonusAmount || 5, isUnlimited: false, dailyQuota: 15 }
            );
          }
          Alert.alert(
            'Bonus Likes Granted!',
            `You earned +${bonusAmount || 5} likes for photo-verified profiles from watching a sponsored video.`
          );
        }}
        onUpgradePress={() => router.push('/(tabs)/membership')}
      />

      {/* Discovery Message Quota & Rewarded Ad Modal */}
      <DiscoveryMessageQuotaModal
        visible={showMessageQuotaModal}
        userId={profile?.id || 'aura_user'}
        quota={messageQuota}
        onClose={() => setShowMessageQuotaModal(false)}
        onQuotaUpdated={(updated) => {
          setMessageQuota(updated);
        }}
        onUpgradePress={() => router.push('/(tabs)/membership')}
      />

      {/* Discovery Preferences & Dealbreakers Filter Sheet */}
      <DiscoveryFilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        currentPreferences={preferences}
        onApply={async (updated) => {
          setPreferences(updated);
          setShowFilterModal(false);
          await loadFeed();
        }}
      />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoidContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  layoutToggleBarContainer: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingTop: 6,
    paddingBottom: 2,
  },
  layoutSegmentedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    padding: 2,
    marginRight: 2,
  },
  layoutSegmentBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  layoutSegmentBtnActive: {
    backgroundColor: 'rgba(212, 175, 55, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.4)',
  },
  layoutIconSingle: {
    width: 13,
    height: 14,
    borderWidth: 1.5,
    borderRadius: 2,
  },
  layoutIconGrid: {
    width: 13,
    height: 13,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignContent: 'space-between',
  },
  layoutGridDot: {
    width: 5,
    height: 5,
    borderRadius: 1,
  },
  doubleGridWrapper: {
    flex: 1,
    width: '100%',
  },
  doubleColumnWrapper: {
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  doubleGridContent: {
    paddingTop: spacing.sm,
  },
  searchButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchIcon: {
    fontSize: 16,
  },
  filterButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  filterIcon: {
    fontSize: 16,
  },
  filterActiveDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.gold,
  },
  incompleteBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 149, 0, 0.12)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 149, 0, 0.3)',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  incompleteBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  incompleteBannerIcon: {
    fontSize: 14,
  },
  incompleteBannerTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: '#FF9500',
    fontSize: 11,
  },
  incompleteBannerSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
  },
  incompleteBannerAction: {
    ...typography.caption,
    color: colors.gold,
    fontWeight: '700',
    fontSize: 11,
    marginLeft: spacing.sm,
  },
  deckContainer: {
    flex: 1,
    width: '100%',
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deckContainerKeyboard: {
    flex: 1,
    width: '100%',
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: Platform.OS === 'android' ? 6 : 4,
  },
  cardRegion: {
    flex: 1,
    flexShrink: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  cardRegionKeyboard: {
    justifyContent: 'center',
    paddingVertical: 2,
  },
  composerRegion: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    zIndex: 10,
    paddingBottom: 2,
  },
  composerRegionKeyboard: {
    paddingBottom: Platform.OS === 'android' ? 6 : 4,
    paddingTop: 2,
  },
  headerBadges: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 4,
  },
  brandGroup: {
    flexDirection: 'column',
  },
  brandTitle: {
    ...typography.h2,
    color: colors.text,
    letterSpacing: 2,
  },
  brandSubtitle: {
    ...typography.caption,
    fontSize: 9,
    color: colors.gold,
    letterSpacing: 1,
  },
  allowancePill: {
    backgroundColor: 'rgba(212, 175, 55, 0.12)',
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  allowanceText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '600',
    color: colors.gold,
  },
  summaryPill: {
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 2,
  },
  contentKeyboard: {
    justifyContent: 'space-between',
    paddingVertical: 0,
  },
  loadingContainer: {
    alignItems: 'center',
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  lockContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
    width: '100%',
  },
  lockIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.gold,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  lockIcon: {
    fontSize: 32,
  },
  lockTitle: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  lockSubtitle: {
    ...typography.caption,
    color: colors.gold,
    letterSpacing: 1.5,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  lockDescription: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xxl,
    maxWidth: 320,
  },
  lockButtonsContainer: {
    width: '100%',
    maxWidth: 280,
    gap: spacing.sm,
  },
  lockPrimaryButton: {
    backgroundColor: colors.gold,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
    alignItems: 'center',
  },
  lockPrimaryButtonText: {
    ...typography.button,
    color: colors.textInverse,
    fontWeight: '700',
  },
  lockSecondaryButton: {
    backgroundColor: 'transparent',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  lockSecondaryButtonText: {
    ...typography.button,
    color: colors.text,
    fontWeight: '600',
  },
  superLikeToastPill: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    backgroundColor: colors.gold,
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: borderRadius.full,
    zIndex: 999,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  superLikeToastText: {
    color: colors.textInverse || '#0D0E12',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.3,
  },
});
