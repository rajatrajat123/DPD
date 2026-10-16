import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, typography, spacing, borderRadius } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';
import { DiscoveryCandidate, SwipeResponse } from '../../src/types';
import { discoveryService } from '../../src/services/discovery/discoveryService';
import { DiscoveryCard } from '../../src/components/DiscoveryCard';
import { SponsoredCard } from '../../src/components/SponsoredCard';
import { DealbreakerEmptyState } from '../../src/components/DealbreakerEmptyState';
import { AgeVerificationBanner } from '../../src/components/AgeVerificationBanner';
import { MatchCelebrationModal } from '../../src/components/MatchCelebrationModal';
import { SwipeQuotaModal } from '../../src/components/SwipeQuotaModal';
import { storeBilling } from '../../src/services/billing/storeBilling';
import { authService } from '../../src/services/auth/authService';
import { admobService, adBreakManager, SwipeAllowance, isGoogleMobileAdsAvailable } from '../../src/services/ads/admobService';

export default function DiscoveryScreen() {
  const router = useRouter();
  const { isAgeVerified, profile, refreshProfile } = useAuth();

  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [emptyStateReason, setEmptyStateReason] = useState<string>('');
  const [feedError, setFeedError] = useState<string | null>(null);
  const [nearbySummary, setNearbySummary] = useState<string>('');
  const [canRewind, setCanRewind] = useState(false);
  const [lastSwipedCandidate, setLastSwipedCandidate] = useState<DiscoveryCandidate | null>(null);
  const [showSponsoredBreak, setShowSponsoredBreak] = useState(false);
  const isSwipingRef = useRef(false);

  // Match Celebration Modal state
  const [matchedCandidate, setMatchedCandidate] = useState<DiscoveryCandidate | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // Daily Swipe Quota & Rewarded Ad Modal state
  const [allowance, setAllowance] = useState<SwipeAllowance | null>(null);
  const [showQuotaModal, setShowQuotaModal] = useState(false);

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

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  // Auto-replenish: when the user reaches near the end of the current deck, automatically load the next batch
  useEffect(() => {
    if (currentIndex > 0 && currentIndex >= candidates.length - 2 && !isLoading && hasMoreRef.current) {
      prefetchNextBatch();
    }
  }, [currentIndex, candidates.length, isLoading, prefetchNextBatch]);

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

  const handleSwipe = async (direction: 'LIKE' | 'PASS' | 'SUPER_SPARK') => {
    if (isSwipingRef.current) return;
    const candidate = candidates[currentIndex];
    if (!candidate) return;

    // Check client-side quota if limited and trying to LIKE
    if (direction !== 'PASS' && allowance && !allowance.isUnlimited && allowance.remainingLikes <= 0) {
      setShowQuotaModal(true);
      return;
    }

    isSwipingRef.current = true;
    setLastSwipedCandidate(candidate);
    const nextIdx = currentIndex + 1;
    setCurrentIndex(nextIdx);

    // Continuous browsing: prefetch next batch when approaching end of deck
    if (nextIdx >= candidates.length - 3) {
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
      const res: SwipeResponse = await discoveryService.swipe(candidate.user_id, direction);
      if (res.is_mutual_match) {
        setMatchedCandidate(candidate);
        setActiveConversationId(res.conversation_id || null);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('BONUS_LIKES_VERIFIED_ONLY') || errMsg.includes('photo-verified')) {
        Alert.alert(
          'Photo-Verified Profiles Only',
          'Bonus likes earned from sponsored videos can only be used on photo-verified profiles. You can continue passing or upgrade for unlimited likes.',
          [
            { text: 'Upgrade to Plus', onPress: () => router.push('/(tabs)/membership') },
            { text: 'Got It', style: 'cancel' },
          ]
        );
        setCurrentIndex((prev) => Math.max(0, prev - 1));
      } else if (errMsg.includes('SWIPE_LIMIT_REACHED') || errMsg.includes('limit reached')) {
        setShowQuotaModal(true);
        setCurrentIndex((prev) => Math.max(0, prev - 1));
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
      if (currentIndex > 0 && lastSwipedCandidate) {
        setCurrentIndex((prev) => prev - 1);
        Alert.alert('Rewound', `Restored ${lastSwipedCandidate.display_name} to your deck.`);
      }
    } catch (err) {
      Alert.alert('Rewind Unavailable', 'Could not undo your last swipe.');
    }
  };

  const activeCandidate = candidates[currentIndex];

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.brandGroup}>
          <Text style={styles.brandTitle}>AURA</Text>
          <Text style={styles.brandSubtitle}>Exclusive Discovery</Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.searchButton}
            onPress={() => router.push('/search')}
            activeOpacity={0.7}
            testID="discovery-search-button"
          >
            <Text style={styles.searchIcon}>🔍</Text>
          </TouchableOpacity>

          <View style={styles.headerBadges}>
            {allowance ? (
              <View style={styles.allowancePill} testID="allowance-badge">
                <Text style={styles.allowanceText}>
                  {allowance.isIntroductory
                    ? '✨ 30-Day Free Intro'
                    : allowance.isUnlimited
                    ? '✨ Unlimited'
                    : `💛 ${allowance.remainingLikes}/${allowance.dailyQuota} Likes`}
                </Text>
              </View>
            ) : null}

            {nearbySummary ? (
              <View style={styles.summaryPill}>
                <Text style={styles.summaryText}>📍 {nearbySummary} nearby</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {/* Mandatory Age Assurance Gating Notice */}
      {!isAgeVerified && (
        <AgeVerificationBanner
          onVerifyPress={() => router.push('/(auth)/verify-age')}
          onCheckStatus={handleCheckVerificationStatus}
        />
      )}

      {/* Main Deck Container */}
      <View style={styles.content}>
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
          <DiscoveryCard
            key={activeCandidate.user_id || activeCandidate.id || `candidate-${currentIndex}`}
            candidate={activeCandidate}
            onLike={() => handleSwipe('LIKE')}
            onPass={() => handleSwipe('PASS')}
            onSuperSpark={() => handleSwipe('SUPER_SPARK')}
            onRewind={handleRewind}
            canRewind={canRewind && currentIndex > 0}
          />
        ) : emptyStateReason === 'PHOTO_MINIMUM_REQUIRED' ? (
          <View style={styles.lockContainer} testID="photo-minimum-feed-state">
            <View style={styles.lockIconCircle}>
              <Text style={styles.lockIcon}>📸</Text>
            </View>
            <Text style={styles.lockTitle}>3 Photos Minimum Required</Text>
            <Text style={styles.lockSubtitle}>AUTHENTICITY STANDARD</Text>
            <Text style={styles.lockDescription}>
              To maintain high authenticity and prevent empty accounts, you must upload at least 3 approved profile
              photos before you can browse and match with other members.
            </Text>
            <View style={styles.lockButtonsContainer}>
              <TouchableOpacity
                style={styles.lockPrimaryButton}
                onPress={() => router.push('/(tabs)/profile')}
                activeOpacity={0.8}
              >
                <Text style={styles.lockPrimaryButtonText}>Upload Profile Photos</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.lockSecondaryButton}
                onPress={loadFeed}
                activeOpacity={0.8}
              >
                <Text style={styles.lockSecondaryButtonText}>Refresh Deck</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : !isAgeVerified ? (
          emptyStateReason === 'AGE_VERIFICATION_REQUIRED' ? (
            <View style={styles.lockContainer} testID="age-locked-feed-state">
              <View style={styles.lockIconCircle}>
                <Text style={styles.lockIcon}>🛡️</Text>
              </View>
              <Text style={styles.lockTitle}>18+ Age Assurance Required</Text>
              <Text style={styles.lockSubtitle}>MANDATORY COMMUNITY PROTECTION</Text>
              <Text style={styles.lockDescription}>
                Dating discovery, matching, and messaging are locked until your adult status is confirmed. Complete a
                quick verification selfie to unlock the deck and connect with members waiting nearby.
              </Text>
              <View style={styles.lockButtonsContainer}>
                <TouchableOpacity
                  style={styles.lockPrimaryButton}
                  onPress={() => router.push('/(auth)/verify-age')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.lockPrimaryButtonText}>Complete Age Verification</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.lockSecondaryButton}
                  onPress={handleCheckVerificationStatus}
                  activeOpacity={0.8}
                >
                  <Text style={styles.lockSecondaryButtonText}>Check Verification Status</Text>
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
                params: { id: cid, name: cname, recipientId: uid },
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
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
});
