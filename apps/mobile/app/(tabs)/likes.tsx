import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, typography, spacing, borderRadius, useTheme } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';
import { storeBilling } from '../../src/services/billing/storeBilling';
import { discoveryService } from '../../src/services/discovery/discoveryService';
import { chatService } from '../../src/services/chat/chatService';
import { Match } from '../../src/types';
import { AgeVerificationBanner } from '../../src/components/AgeVerificationBanner';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_CARD_WIDTH = (SCREEN_WIDTH - spacing.lg * 2 - spacing.md) / 2;

export default function LikesScreen() {
  const router = useRouter();
  const { isAgeVerified } = useAuth();
  const { colors } = useTheme();

  const [hasVipAccess, setHasVipAccess] = useState(false);
  const [nearbyCount, setNearbyCount] = useState<string>('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadLikesData = useCallback(async () => {
    try {
      // 1. Check authoritative billing entitlements
      const entitlements = await storeBilling.getActiveEntitlements();
      const rawEnts = entitlements?.entitlements;
      const entitlementList: string[] = Array.isArray(rawEnts)
        ? rawEnts.map((e: any) => (typeof e === 'string' ? e : e?.entitlement_code || ''))
        : [];
      const canSeeLikes = entitlementList.includes('SEE_WHO_LIKED_YOU');
      setHasVipAccess(canSeeLikes);

      // 2. Fetch privacy-preserving nearby count summary
      try {
        const summary = await discoveryService.getMatchingSummary();
        if (summary?.nearby_count_bracket) {
          setNearbyCount(summary.nearby_count_bracket);
        }
      } catch {
        // Summary fallback
      }

      // 3. If entitled, fetch available match Sparks
      if (canSeeLikes) {
        try {
          const res = await chatService.getMatches();
          setMatches(res || []);
        } catch {
          setMatches([]);
        }
      }
    } catch {
      // Offline fallback
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadLikesData();
  }, [loadLikesData]);

  const onRefresh = () => {
    setIsRefreshing(true);
    loadLikesData();
  };

  const handleUpgrade = () => {
    router.push('/(tabs)/membership');
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Likes</Text>
          <Text style={[styles.subtitle, { color: colors.gold }]}>Interested In Your Profile</Text>
        </View>
        {nearbyCount ? (
          <View style={[styles.counterBadge, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]}>
            <Text style={[styles.counterText, { color: colors.gold }]}>📍 {nearbyCount}</Text>
          </View>
        ) : null}
      </View>

      {!isAgeVerified && (
        <AgeVerificationBanner onVerifyPress={() => router.push('/(auth)/verify-age')} />
      )}

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.gold} size="large" />
          <Text style={styles.loadingText}>Loading likes...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.gold}
              colors={[colors.gold]}
            />
          }
        >
          {/* Locked Free Tier View */}
          {!hasVipAccess ? (
            <View style={styles.lockedContainer}>
              <View style={[styles.vipBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.vipIconWrap, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]}>
                  <Text style={styles.vipIcon}>👑</Text>
                </View>
                <Text style={[styles.vipBannerTitle, { color: colors.text }]}>See Who Liked You</Text>
                <Text style={[styles.vipBannerBody, { color: colors.textMuted }]}>
                  Reveal everyone who has sent you a Like and match with them instantly without waiting in the deck.
                </Text>
                <TouchableOpacity style={[styles.upgradeBtn, { backgroundColor: colors.gold }]} onPress={handleUpgrade} activeOpacity={0.85}>
                  <Text style={[styles.upgradeBtnText, { color: colors.textInverse }]}>Upgrade to Aura VIP</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.previewHeading}>Recent Activity (Locked)</Text>

              {/* Privacy-preserving blurred placeholder cards */}
              <View style={styles.grid}>
                {[1, 2, 3, 4].map((item) => (
                  <View key={item} style={[styles.lockedCard, { backgroundColor: colors.card, borderColor: colors.borderSubtle }]}>
                    <View style={styles.silhouetteWrap}>
                      <Text style={styles.silhouetteIcon}>👤</Text>
                    </View>
                    <View style={styles.lockOverlay}>
                      <View style={[styles.padlockCircle, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]}>
                        <Text style={styles.padlockText}>🔒</Text>
                      </View>
                      <Text style={[styles.lockedCardText, { color: colors.gold }]}>Liked your profile</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            /* Entitled VIP View */
            <View style={styles.unlockedContainer}>
              <View style={styles.unlockedHeader}>
                <Text style={[styles.unlockedTitle, { color: colors.text }]}>Your Incoming Sparks</Text>
                <Text style={[styles.unlockedSubtitle, { color: colors.textMuted }]}>
                  You hold active Aura VIP access. Tap any member to connect.
                </Text>
              </View>

              {matches.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <View style={[styles.emptyIconCircle, { backgroundColor: colors.cardElevated }]}>
                    <Text style={styles.emptyIconText}>♥</Text>
                  </View>
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No New Likes Right Now</Text>
                  <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
                    As soon as members in your area swipe right on your profile, their cards will appear here.
                  </Text>
                  <TouchableOpacity style={[styles.emptyRefreshBtn, { backgroundColor: colors.gold }]} onPress={onRefresh} activeOpacity={0.8}>
                    <Text style={[styles.emptyRefreshBtnText, { color: colors.textInverse }]}>Check Again</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.grid}>
                  {matches.map((m) => (
                    <TouchableOpacity
                      key={m.id}
                      style={[styles.matchCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                      onPress={() =>
                        router.push({
                          pathname: '/chat/[id]',
                          params: {
                            id: m.id,
                            name: m.target_profile.display_name,
                            recipientId: m.target_profile.user_id,
                            avatar: m.target_profile.avatar_url || '',
                          },
                        })
                      }
                      activeOpacity={0.85}
                    >
                      {m.target_profile.avatar_url ? (
                        <Image source={{ uri: m.target_profile.avatar_url }} style={styles.cardImage} />
                      ) : (
                        <View style={[styles.cardImage, styles.cardImageFallback, { backgroundColor: colors.cardElevated }]}>
                          <Text style={[styles.cardMonogram, { color: colors.gold }]}>
                            {m.target_profile.display_name.charAt(0)}
                          </Text>
                        </View>
                      )}

                      <View style={styles.cardGradientOverlay}>
                        <View style={styles.cardNameRow}>
                          <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>
                            {m.target_profile.display_name}
                          </Text>
                          {m.target_profile.is_verified && (
                            <Text style={styles.cardVerified}>✓</Text>
                          )}
                        </View>
                        <Text style={styles.cardMatchedDate}>Mutual Spark</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      )}
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
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    letterSpacing: 1,
  },
  subtitle: {
    ...typography.caption,
    color: colors.gold,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  counterBadge: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.border,
  },
  counterText: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  lockedContainer: {
    width: '100%',
  },
  vipBanner: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.gold,
    marginBottom: spacing.xl,
  },
  vipIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.goldMuted,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  vipIcon: {
    fontSize: 26,
  },
  vipBannerTitle: {
    ...typography.h2,
    color: colors.text,
    fontSize: 20,
    marginBottom: 6,
  },
  vipBannerBody: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  upgradeBtn: {
    backgroundColor: colors.gold,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
  },
  upgradeBtnText: {
    ...typography.button,
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 13,
  },
  previewHeading: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  lockedCard: {
    width: GRID_CARD_WIDTH,
    height: GRID_CARD_WIDTH * 1.35,
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  silhouetteWrap: {
    opacity: 0.12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  silhouetteIcon: {
    fontSize: 64,
    color: colors.textMuted,
  },
  lockOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(9, 10, 14, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.sm,
  },
  padlockCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.goldMuted,
    borderWidth: 1,
    borderColor: colors.gold,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  padlockText: {
    fontSize: 16,
  },
  lockedCardText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.gold,
    fontWeight: '600',
    textAlign: 'center',
  },
  unlockedContainer: {
    width: '100%',
  },
  unlockedHeader: {
    marginBottom: spacing.lg,
  },
  unlockedTitle: {
    ...typography.h2,
    color: colors.text,
  },
  unlockedSubtitle: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
  },
  matchCard: {
    width: GRID_CARD_WIDTH,
    height: GRID_CARD_WIDTH * 1.35,
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardImageFallback: {
    backgroundColor: colors.cardElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardMonogram: {
    ...typography.h1,
    color: colors.gold,
    fontSize: 36,
  },
  cardGradientOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.sm,
    backgroundColor: 'rgba(9, 10, 14, 0.85)',
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  cardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardName: {
    ...typography.bodyLarge,
    fontWeight: '700',
    color: colors.text,
    fontSize: 14,
    flexShrink: 1,
  },
  cardVerified: {
    fontSize: 11,
    color: colors.emerald,
    fontWeight: '700',
  },
  cardMatchedDate: {
    ...typography.caption,
    color: colors.gold,
    fontSize: 10,
    marginTop: 1,
  },
  emptyContainer: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    padding: spacing.xxl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.md,
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.likeMuted,
    borderWidth: 1,
    borderColor: colors.like,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emptyIconText: {
    fontSize: 26,
    color: colors.like,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  emptyBody: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  emptyRefreshBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: colors.goldMuted,
  },
  emptyRefreshBtnText: {
    ...typography.caption,
    color: colors.gold,
    fontWeight: '700',
    fontSize: 12,
  },
});
