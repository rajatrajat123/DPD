import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, typography, spacing, borderRadius, useTheme } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';
import { storeBilling } from '../../src/services/billing/storeBilling';
import { discoveryService } from '../../src/services/discovery/discoveryService';
import { admobService } from '../../src/services/ads/admobService';
import { chatService } from '../../src/services/chat/chatService';
import { IncomingLikeCard, LikesYouResponse, Match } from '../../src/types';
import { AgeVerificationBanner } from '../../src/components/AgeVerificationBanner';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_CARD_WIDTH = (SCREEN_WIDTH - spacing.lg * 2 - spacing.md) / 2;

function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return '00:00:00';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export default function LikesScreen() {
  const router = useRouter();
  const { user, isAgeVerified } = useAuth();
  const { colors } = useTheme();

  const [hasVipAccess, setHasVipAccess] = useState(false);
  const [nearbyCount, setNearbyCount] = useState<string>('');
  const [likesData, setLikesData] = useState<LikesYouResponse | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isWatchingAd, setIsWatchingAd] = useState(false);
  const [adFeedback, setAdFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);

  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);

  const loadLikesData = useCallback(async () => {
    try {
      // 1. Check authoritative billing entitlements
      let canSeeLikes = false;
      try {
        const entitlements = await storeBilling.getActiveEntitlements();
        const rawEnts = entitlements?.entitlements;
        const entitlementList: string[] = Array.isArray(rawEnts)
          ? rawEnts.map((e: any) => (typeof e === 'string' ? e : e?.entitlement_code || ''))
          : [];
        canSeeLikes = entitlementList.includes('SEE_WHO_LIKED_YOU');
        setHasVipAccess(canSeeLikes);
      } catch {
        // Default to free tier on entitlement fetch error
        setHasVipAccess(false);
      }

      // 2. Fetch privacy-preserving nearby count summary
      try {
        const summary = await discoveryService.getMatchingSummary();
        if (summary?.nearby_count_bracket) {
          setNearbyCount(summary.nearby_count_bracket);
        }
      } catch {
        // Summary fallback
      }

      // 3. Fetch Likes You response
      try {
        const resp = await discoveryService.getLikesYou(50, 0);
        setLikesData(resp);
        setSecondsRemaining(resp.ad_reset_in_seconds || 0);
      } catch {
        // Failed to load likes
      }

      // 4. If VIP, also fetch mutual matches
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

  // Live countdown timer for 25-hour ad limit reset
  useEffect(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    if (secondsRemaining > 0) {
      countdownTimerRef.current = setInterval(() => {
        setSecondsRemaining((prev) => {
          if (prev <= 1) {
            if (countdownTimerRef.current) {
              clearInterval(countdownTimerRef.current);
              countdownTimerRef.current = null;
            }
            // Cooldown finished, reload data
            loadLikesData();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    };
  }, [secondsRemaining, loadLikesData]);

  const onRefresh = () => {
    setIsRefreshing(true);
    setAdFeedback(null);
    loadLikesData();
  };

  const handleUpgrade = () => {
    router.push('/(tabs)/membership');
  };

  const handleWatchAd = async () => {
    if (isWatchingAd) return;

    if (likesData && !likesData.can_watch_ad) {
      Alert.alert(
        'Limit Reached',
        `You have reached the maximum of 5 rewarded ads per 25-hour window. Next unlock available in ${formatCountdown(secondsRemaining)}.`
      );
      return;
    }

    setAdFeedback(null);
    setIsWatchingAd(true);

    try {
      const userId = user?.id || 'guest_user';
      // Present rewarded ad with specific Likes You unlock purpose
      const adResult = await admobService.showRewardedAd(userId, 'likes_you_unlock');

      if (!adResult.rewarded) {
        setAdFeedback({
          type: 'error',
          message: adResult.error || 'Ad could not be completed. Please try again.',
        });
        return;
      }

      // Unlock 2 profiles via backend endpoint
      const unlockRes = await discoveryService.unlockLikesYouWithAd(adResult.transactionId);

      if (unlockRes.success) {
        const count = unlockRes.unlocked_count || 2;
        setAdFeedback({
          type: 'success',
          message: `✨ ${count} profile${count === 1 ? '' : 's'} unlocked!`,
        });

        if (unlockRes.likes_you) {
          setLikesData(unlockRes.likes_you);
          setSecondsRemaining(unlockRes.ad_reset_in_seconds || 0);
        } else {
          await loadLikesData();
        }
      } else {
        setAdFeedback({
          type: 'error',
          message: 'Unable to verify ad reward on the server. Please try again.',
        });
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to unlock profiles. Please try again.';
      setAdFeedback({
        type: 'error',
        message: errMsg,
      });
    } finally {
      setIsWatchingAd(false);
    }
  };

  const handleCardPress = (card: IncomingLikeCard) => {
    if (hasVipAccess || card.is_revealed) {
      // Navigate to chat/connection
      router.push({
        pathname: '/chat/[id]',
        params: {
          id: card.user_id,
          name: card.display_name,
          recipientId: card.user_id,
          avatar: card.photos?.[0]?.card_url || '',
        },
      });
    } else {
      Alert.alert(
        'Profile Hidden',
        'Watch a rewarded video ad above to reveal 2 liked profiles, or upgrade to Aura VIP for instant reveals.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Watch Ad', onPress: handleWatchAd },
          { text: 'Upgrade to VIP', onPress: handleUpgrade },
        ]
      );
    }
  };

  const totalLikesCount = likesData?.total_likes || 0;
  const revealedCount = likesData?.revealed_count || 0;
  const incomingLikes = likesData?.likes || [];
  const adsWatched = likesData?.ads_watched_in_window || 0;
  const maxAds = likesData?.max_ads_per_window || 5;
  const canWatchAd = likesData?.can_watch_ad ?? true;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Likes</Text>
          <Text style={[styles.subtitle, { color: colors.gold }]}>
            {hasVipAccess ? 'Aura VIP • Instant Sparks' : 'Interested In Your Profile'}
          </Text>
        </View>
        <View style={styles.headerRight}>
          {totalLikesCount > 0 && (
            <View style={[styles.counterBadge, { backgroundColor: colors.card, borderColor: colors.gold }]}>
              <Text style={[styles.counterText, { color: colors.gold, fontWeight: '700' }]}>
                ♥ {totalLikesCount}
              </Text>
            </View>
          )}
          {nearbyCount ? (
            <View style={[styles.counterBadge, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]}>
              <Text style={[styles.counterText, { color: colors.gold }]}>📍 {nearbyCount}</Text>
            </View>
          ) : null}
        </View>
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
          {/* FREE USER EXPERIENCE */}
          {!hasVipAccess ? (
            <View style={styles.lockedContainer}>
              {/* VIP Upgrade Banner */}
              <View style={[styles.vipBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.vipIconWrap, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]}>
                  <Text style={styles.vipIcon}>👑</Text>
                </View>
                <Text style={[styles.vipBannerTitle, { color: colors.text }]}>See Who Liked You</Text>
                <Text style={[styles.vipBannerBody, { color: colors.textMuted }]}>
                  Upgrade to Aura VIP to reveal all incoming likes instantly and match with zero wait.
                </Text>
                <TouchableOpacity style={[styles.upgradeBtn, { backgroundColor: colors.gold }]} onPress={handleUpgrade} activeOpacity={0.85}>
                  <Text style={[styles.upgradeBtnText, { color: colors.textInverse }]}>Upgrade to Aura VIP</Text>
                </TouchableOpacity>
              </View>

              {/* Rewarded Ad Unlock Card */}
              <View style={[styles.adRewardCard, { backgroundColor: colors.card, borderColor: canWatchAd ? colors.gold : colors.borderSubtle }]}>
                <View style={styles.adRewardHeader}>
                  <View style={[styles.adIconCircle, { backgroundColor: canWatchAd ? colors.goldMuted : colors.cardElevated }]}>
                    <Text style={styles.adIconText}>{canWatchAd ? '🎬' : '⏳'}</Text>
                  </View>
                  <View style={styles.adRewardHeaderText}>
                    <Text style={[styles.adRewardTitle, { color: colors.text }]}>
                      {canWatchAd ? 'Watch Ad to Unlock 2 Profiles' : '25-Hour Ad Limit Reached'}
                    </Text>
                    <Text style={[styles.adRewardSubtitle, { color: colors.textMuted }]}>
                      {canWatchAd
                        ? 'Watch a quick video to reveal 2 liked profiles.'
                        : 'Maximum 5 ads (10 profiles unlocked) in this rolling window.'}
                    </Text>
                  </View>
                </View>

                {/* Window Quota Progress */}
                <View style={styles.adProgressContainer}>
                  <View style={styles.adProgressRow}>
                    <Text style={[styles.adProgressLabel, { color: colors.textMuted }]}>Window Progress</Text>
                    <Text style={[styles.adProgressValue, { color: colors.gold }]}>
                      {adsWatched} / {maxAds} Ads Watched ({adsWatched * 2} / 10 Profiles)
                    </Text>
                  </View>
                  <View style={[styles.progressBarTrack, { backgroundColor: colors.cardElevated }]}>
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${Math.min(100, (adsWatched / maxAds) * 100)}%`,
                          backgroundColor: canWatchAd ? colors.gold : colors.textMuted,
                        },
                      ]}
                    />
                  </View>
                </View>

                {/* Feedback Banner */}
                {adFeedback && (
                  <View
                    style={[
                      styles.feedbackBanner,
                      adFeedback.type === 'success'
                        ? { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: colors.emerald }
                        : { backgroundColor: 'rgba(239, 68, 68, 0.15)', borderColor: '#ef4444' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.feedbackText,
                        { color: adFeedback.type === 'success' ? colors.emerald : '#ef4444' },
                      ]}
                    >
                      {adFeedback.message}
                    </Text>
                  </View>
                )}

                {/* Ad Button or Live Countdown */}
                {canWatchAd ? (
                  <TouchableOpacity
                    style={[styles.watchAdBtn, { backgroundColor: colors.gold }]}
                    onPress={handleWatchAd}
                    disabled={isWatchingAd}
                    activeOpacity={0.85}
                  >
                    {isWatchingAd ? (
                      <View style={styles.adBtnLoadingRow}>
                        <ActivityIndicator color={colors.textInverse} size="small" />
                        <Text style={[styles.watchAdBtnText, { color: colors.textInverse, marginLeft: 8 }]}>
                          Loading Video...
                        </Text>
                      </View>
                    ) : (
                      <Text style={[styles.watchAdBtnText, { color: colors.textInverse }]}>
                        ▶ Watch Video to Unlock 2 Likes
                      </Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.limitCooldownBox, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
                    <Text style={[styles.limitCooldownLabel, { color: colors.textMuted }]}>
                      Next ad unlock available in:
                    </Text>
                    <Text style={[styles.limitCountdownText, { color: colors.gold }]}>
                      {formatCountdown(secondsRemaining)}
                    </Text>
                    <TouchableOpacity style={styles.instantRevealLink} onPress={handleUpgrade} activeOpacity={0.8}>
                      <Text style={[styles.instantRevealLinkText, { color: colors.gold }]}>
                        Skip wait with Aura VIP →
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Likes Activity Section */}
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionHeading, { color: colors.textMuted }]}>
                  INCOMING LIKES ({totalLikesCount})
                </Text>
                {revealedCount > 0 && (
                  <Text style={[styles.revealedCounterText, { color: colors.emerald }]}>
                    ✓ {revealedCount} Unlocked
                  </Text>
                )}
              </View>

              {/* Empty State */}
              {totalLikesCount === 0 ? (
                <View style={[styles.emptyContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={[styles.emptyIconCircle, { backgroundColor: colors.likeMuted, borderColor: colors.like }]}>
                    <Text style={styles.emptyIconText}>♥</Text>
                  </View>
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No New Likes Right Now</Text>
                  <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
                    As soon as members in your area swipe right on your profile, their cards will appear here.
                  </Text>
                  <TouchableOpacity style={[styles.emptyRefreshBtn, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]} onPress={onRefresh} activeOpacity={0.8}>
                    <Text style={[styles.emptyRefreshBtnText, { color: colors.gold }]}>Check Again</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.grid}>
                  {incomingLikes.map((card) => {
                    const isRevealed = card.is_revealed;
                    const primaryPhoto = card.photos && card.photos.length > 0 ? card.photos[0].card_url : null;

                    return (
                      <TouchableOpacity
                        key={card.user_id}
                        style={[
                          styles.likeCard,
                          {
                            backgroundColor: colors.card,
                            borderColor: card.is_super_like ? colors.gold : isRevealed ? colors.emerald : colors.borderSubtle,
                          },
                        ]}
                        onPress={() => handleCardPress(card)}
                        activeOpacity={0.85}
                      >
                        {/* UNREVEALED / BLURRED CARD */}
                        {!isRevealed ? (
                          <View style={styles.blurredCardInner}>
                            {/* Background Silhouette */}
                            <View style={styles.silhouetteWrap}>
                              <Text style={styles.silhouetteIcon}>👤</Text>
                            </View>

                            {/* Lock Overlay */}
                            <View style={styles.lockOverlay}>
                              <View style={[styles.padlockCircle, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]}>
                                <Text style={styles.padlockText}>🔒</Text>
                              </View>
                              <Text style={[styles.lockedCardText, { color: colors.gold }]}>
                                {card.is_super_like ? '⭐ Super Like!' : 'Someone liked you'}
                              </Text>
                              <Text style={[styles.distanceText, { color: colors.textMuted }]}>
                                ~{card.approximate_distance_km} km away
                              </Text>
                              <View style={[styles.tapToUnlockBadge, { backgroundColor: colors.cardElevated }]}>
                                <Text style={[styles.tapToUnlockText, { color: colors.gold }]}>
                                  Tap to reveal
                                </Text>
                              </View>
                            </View>
                          </View>
                        ) : (
                          /* UNLOCKED CARD */
                          <View style={styles.revealedCardInner}>
                            {primaryPhoto ? (
                              <Image source={{ uri: primaryPhoto }} style={styles.cardImage} />
                            ) : (
                              <View style={[styles.cardImage, styles.cardImageFallback, { backgroundColor: colors.cardElevated }]}>
                                <Text style={[styles.cardMonogram, { color: colors.gold }]}>
                                  {card.display_name.charAt(0)}
                                </Text>
                              </View>
                            )}

                            {/* Super Like Badge */}
                            {card.is_super_like && (
                              <View style={[styles.superLikeBadge, { backgroundColor: colors.gold }]}>
                                <Text style={[styles.superLikeBadgeText, { color: colors.textInverse }]}>
                                  ⭐ Super Like
                                </Text>
                              </View>
                            )}

                            {/* Card Footer */}
                            <View style={styles.cardGradientOverlay}>
                              <View style={styles.cardNameRow}>
                                <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>
                                  {card.display_name}, {card.age}
                                </Text>
                                {card.is_photo_verified && (
                                  <Text style={styles.cardVerified}>✓</Text>
                                )}
                              </View>
                              <Text style={[styles.cardDistanceRow, { color: colors.textMuted }]}>
                                📍 ~{card.approximate_distance_km} km away
                              </Text>
                              <Text style={styles.cardActionHint}>Tap to connect</Text>
                            </View>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          ) : (
            /* VIP / PREMIUM USER EXPERIENCE */
            <View style={styles.vipContainer}>
              <View style={styles.unlockedHeader}>
                <View style={styles.vipBadgeRow}>
                  <View style={[styles.vipCrownBadge, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]}>
                    <Text style={styles.vipCrownIcon}>👑</Text>
                    <Text style={[styles.vipCrownText, { color: colors.gold }]}>AURA VIP UNLIMITED</Text>
                  </View>
                </View>
                <Text style={[styles.unlockedTitle, { color: colors.text }]}>Your Incoming Sparks</Text>
                <Text style={[styles.unlockedSubtitle, { color: colors.textMuted }]}>
                  All profiles interested in you are unlocked and ready for mutual connection.
                </Text>
              </View>

              {/* Mutual Sparks (VIP) */}
              {matches.length > 0 && (
                <View style={{ marginBottom: spacing.lg }}>
                  <Text style={[styles.sectionHeading, { color: colors.gold, marginBottom: spacing.sm }]}>
                    Mutual Sparks ({matches.length})
                  </Text>
                  <View style={styles.grid}>
                    {matches.map((m) => (
                      <TouchableOpacity
                        key={m.id}
                        style={[styles.likeCard, { backgroundColor: colors.card, borderColor: colors.gold }]}
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
                          <Text style={styles.cardDistanceRow}>Mutual Spark</Text>
                          <Text style={styles.cardActionHint}>Tap to chat</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {totalLikesCount === 0 && matches.length === 0 ? (
                <View style={[styles.emptyContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
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
                <View>
                  {totalLikesCount > 0 && (
                    <View style={styles.sectionHeaderRow}>
                      <Text style={[styles.sectionHeading, { color: colors.textMuted }]}>
                        INCOMING LIKES ({totalLikesCount})
                      </Text>
                    </View>
                  )}
                  <View style={styles.grid}>
                  {incomingLikes.map((card) => {
                    const primaryPhoto = card.photos && card.photos.length > 0 ? card.photos[0].card_url : null;
                    return (
                      <TouchableOpacity
                        key={card.user_id}
                        style={[
                          styles.likeCard,
                          {
                            backgroundColor: colors.card,
                            borderColor: card.is_super_like ? colors.gold : colors.border,
                          },
                        ]}
                        onPress={() => handleCardPress(card)}
                        activeOpacity={0.85}
                      >
                        {primaryPhoto ? (
                          <Image source={{ uri: primaryPhoto }} style={styles.cardImage} />
                        ) : (
                          <View style={[styles.cardImage, styles.cardImageFallback, { backgroundColor: colors.cardElevated }]}>
                            <Text style={[styles.cardMonogram, { color: colors.gold }]}>
                              {card.display_name.charAt(0)}
                            </Text>
                          </View>
                        )}

                        {card.is_super_like && (
                          <View style={[styles.superLikeBadge, { backgroundColor: colors.gold }]}>
                            <Text style={[styles.superLikeBadgeText, { color: colors.textInverse }]}>
                              ⭐ Super Like
                            </Text>
                          </View>
                        )}

                        <View style={styles.cardGradientOverlay}>
                          <View style={styles.cardNameRow}>
                            <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>
                              {card.display_name}, {card.age}
                            </Text>
                            {card.is_photo_verified && (
                              <Text style={styles.cardVerified}>✓</Text>
                            )}
                          </View>
                          <Text style={[styles.cardDistanceRow, { color: colors.textMuted }]}>
                            📍 ~{card.approximate_distance_km} km away
                          </Text>
                          <Text style={styles.cardActionHint}>Tap to connect</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  </View>
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  counterBadge: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderWidth: 1,
  },
  counterText: {
    ...typography.caption,
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
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  vipIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: spacing.xs,
  },
  vipIcon: {
    fontSize: 24,
  },
  vipBannerTitle: {
    ...typography.h2,
    fontSize: 18,
    marginBottom: 4,
  },
  vipBannerBody: {
    ...typography.bodySmall,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  upgradeBtn: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
  },
  upgradeBtnText: {
    ...typography.button,
    fontWeight: '700',
    fontSize: 13,
  },
  adRewardCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    marginBottom: spacing.xl,
  },
  adRewardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  adIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  adIconText: {
    fontSize: 22,
  },
  adRewardHeaderText: {
    flex: 1,
  },
  adRewardTitle: {
    ...typography.bodyLarge,
    fontWeight: '700',
    fontSize: 15,
  },
  adRewardSubtitle: {
    ...typography.caption,
    fontSize: 12,
    marginTop: 2,
  },
  adProgressContainer: {
    marginBottom: spacing.md,
  },
  adProgressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  adProgressLabel: {
    ...typography.caption,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  adProgressValue: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  feedbackBanner: {
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    borderWidth: 1,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  feedbackText: {
    ...typography.bodySmall,
    fontWeight: '600',
    fontSize: 12,
  },
  watchAdBtn: {
    borderRadius: borderRadius.full,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchAdBtnText: {
    ...typography.button,
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  adBtnLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  limitCooldownBox: {
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
  },
  limitCooldownLabel: {
    ...typography.caption,
    fontSize: 12,
    marginBottom: 4,
  },
  limitCountdownText: {
    ...typography.h2,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 6,
  },
  instantRevealLink: {
    marginTop: 4,
  },
  instantRevealLinkText: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '700',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionHeading: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  revealedCounterText: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  likeCard: {
    width: GRID_CARD_WIDTH,
    height: GRID_CARD_WIDTH * 1.35,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
  },
  blurredCardInner: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  silhouetteWrap: {
    opacity: 0.1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  silhouetteIcon: {
    fontSize: 68,
    color: colors.textMuted,
  },
  lockOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(9, 10, 14, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.sm,
  },
  padlockCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  padlockText: {
    fontSize: 15,
  },
  lockedCardText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  distanceText: {
    ...typography.caption,
    fontSize: 10,
    marginTop: 2,
  },
  tapToUnlockBadge: {
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  tapToUnlockText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '600',
  },
  revealedCardInner: {
    width: '100%',
    height: '100%',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardImageFallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardMonogram: {
    ...typography.h1,
    fontSize: 36,
  },
  superLikeBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    zIndex: 10,
  },
  superLikeBadgeText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  cardGradientOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.sm,
    backgroundColor: 'rgba(9, 10, 14, 0.88)',
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
    fontSize: 13,
    flexShrink: 1,
  },
  cardVerified: {
    fontSize: 11,
    color: colors.emerald,
    fontWeight: '700',
  },
  cardDistanceRow: {
    ...typography.caption,
    fontSize: 10,
    marginTop: 1,
  },
  cardActionHint: {
    ...typography.caption,
    color: colors.gold,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  vipContainer: {
    width: '100%',
  },
  unlockedHeader: {
    marginBottom: spacing.lg,
  },
  vipBadgeRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  vipCrownBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  vipCrownIcon: {
    fontSize: 12,
  },
  vipCrownText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  unlockedTitle: {
    ...typography.h2,
    marginTop: 4,
  },
  unlockedSubtitle: {
    ...typography.bodySmall,
    marginTop: 2,
  },
  emptyContainer: {
    borderRadius: borderRadius.xl,
    padding: spacing.xxl,
    alignItems: 'center',
    borderWidth: 1,
    marginTop: spacing.md,
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1,
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
    marginBottom: spacing.xs,
  },
  emptyBody: {
    ...typography.bodySmall,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  emptyRefreshBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  emptyRefreshBtnText: {
    ...typography.caption,
    fontWeight: '700',
    fontSize: 12,
  },
});
