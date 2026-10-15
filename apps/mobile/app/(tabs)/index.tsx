import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, typography, spacing } from '../../src/theme';
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
import { admobService, adBreakManager, SwipeAllowance } from '../../src/services/ads/admobService';

export default function DiscoveryScreen() {
  const router = useRouter();
  const { isAgeVerified, profile } = useAuth();

  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
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

  const loadFeed = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!isAgeVerified) {
        setIsLoading(false);
        return;
      }
      const feedRes = await discoveryService.getFeed(20);
      setCandidates(feedRes.candidates || []);
      setCurrentIndex(0);

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
    } catch {
      // Backend may be offline or in fallback mode
    } finally {
      setIsLoading(false);
    }
  }, [isAgeVerified]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

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
    setCurrentIndex((prev) => prev + 1);

    if (direction !== 'PASS' && allowance && !allowance.isUnlimited) {
      setAllowance((prev) =>
        prev ? { ...prev, remainingLikes: Math.max(0, prev.remainingLikes - 1) } : null
      );
    }

    // Trigger ad break after configured swipe thresholds (Rule 5: 1st after 20 in intro, then every 30)
    const isIntro = allowance?.isIntroductory ?? false;
    const shouldTriggerBreak = adBreakManager.recordSwipe(isIntro);
    if (shouldTriggerBreak) {
      setShowSponsoredBreak(true);
      admobService.showInterstitialAd().catch(() => {});
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
          {allowance ? (
            <View style={styles.allowancePill} testID="allowance-badge">
              <Text style={styles.allowanceText}>
                {allowance.isIntroductory
                  ? '✨ 30-Day Free Intro (Unlimited Likes)'
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

      {/* Mandatory Age Assurance Gating Notice */}
      {!isAgeVerified && (
        <AgeVerificationBanner onVerifyPress={() => router.push('/(auth)/verify-age')} />
      )}

      {/* Main Deck Container */}
      <View style={styles.content}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={colors.gold} size="large" />
            <Text style={styles.loadingText}>Curating your exclusive deck...</Text>
          </View>
        ) : showSponsoredBreak ? (
          <SponsoredCard onDismiss={() => setShowSponsoredBreak(false)} />
        ) : activeCandidate ? (
          <DiscoveryCard
            candidate={activeCandidate}
            onLike={() => handleSwipe('LIKE')}
            onPass={() => handleSwipe('PASS')}
            onSuperSpark={() => handleSwipe('SUPER_SPARK')}
            onRewind={handleRewind}
            canRewind={canRewind && currentIndex > 0}
          />
        ) : (
          <DealbreakerEmptyState
            onAdjustFilters={() => router.push('/(tabs)/profile')}
            onRefresh={loadFeed}
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
  },
  loadingContainer: {
    alignItems: 'center',
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
});
