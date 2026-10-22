import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, typography, spacing, borderRadius, useTheme } from '../src/theme';
import { referralService } from '../src/services/referral/referralService';
import { UserReferralStatus } from '../src/types';

export default function ReferralsScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const [status, setStatus] = useState<UserReferralStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setErrorMessage(null);
      const data = isRefresh
        ? await referralService.refreshReferralStatus()
        : await referralService.getMyReferralStatus();
      setStatus(data);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load referral status. Please try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleShare = async () => {
    if (!status?.referral_code) return;
    await referralService.shareInviteLink(status.referral_code, status.invite_url);
  };

  const handleCopy = async () => {
    if (!status?.referral_code) return;
    const copied = await referralService.copyOrShareCode(status.referral_code, status.invite_url);
    if (copied) {
      Alert.alert('Share Invite', `Invite code ${status.referral_code} is ready to share!`);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityLabel="Go back"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={[styles.backBtnText, { color: colors.gold }]}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Referrals & Rewards</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => loadStatus(true)}
            tintColor={colors.gold}
            colors={[colors.gold]}
          />
        }
      >
        {isLoading && !isRefreshing ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.gold} />
            <Text style={[styles.loadingText, { color: colors.textMuted }]}>
              Evaluating referral rewards...
            </Text>
          </View>
        ) : errorMessage ? (
          <View style={[styles.errorCard, { backgroundColor: colors.card, borderColor: colors.ruby }]}>
            <Text style={[styles.errorTitle, { color: colors.ruby }]}>Connection Issue</Text>
            <Text style={[styles.errorText, { color: colors.textMuted }]}>{errorMessage}</Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: colors.gold }]}
              onPress={() => loadStatus(false)}
            >
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : status ? (
          <>
            {/* Banner: Paid Subscription coexistence notice */}
            {status.has_paid_subscription && (
              <View style={[styles.vipNoticeCard, { backgroundColor: colors.card, borderColor: colors.gold }]}>
                <Text style={[styles.vipNoticeTitle, { color: colors.gold }]}>
                  👑 Active Aura {status.paid_subscription_tier || 'VIP'} Member
                </Text>
                <Text style={[styles.vipNoticeDesc, { color: colors.textMuted }]}>
                  You already enjoy premium ad-free access. Any ad-supported referral rewards you unlock will be preserved on your account.
                </Text>
              </View>
            )}

            {/* Referral Code Card */}
            <View style={[styles.codeCard, { backgroundColor: colors.card, borderColor: colors.gold }]}>
              <Text style={[styles.codeCardBadge, { color: colors.gold }]}>YOUR UNIQUE INVITE CODE</Text>
              <Text style={[styles.codeValue, { color: colors.text }]} selectable>
                {status.referral_code}
              </Text>
              <Text style={[styles.codeInstructions, { color: colors.textMuted }]}>
                Share with friends. When they register and verify their account, you unlock free access!
              </Text>

              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: colors.gold }]}
                  onPress={handleShare}
                  activeOpacity={0.8}
                >
                  <Text style={styles.primaryBtnText}>Share Invite Link</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.secondaryBtn, { borderColor: colors.gold, backgroundColor: colors.cardElevated }]}
                  onPress={handleCopy}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.secondaryBtnText, { color: colors.gold }]}>Copy Code</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Active Reward Status Card */}
            <View style={[styles.rewardStatusCard, { backgroundColor: colors.card, borderColor: colors.borderSubtle }]}>
              <View style={styles.rewardStatusHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Reward Status</Text>
                <View
                  style={[
                    styles.statusPill,
                    {
                      backgroundColor:
                        status.reward_status === 'ACTIVE'
                          ? '#059669' // emerald green
                          : status.reward_status === 'EXPIRED'
                          ? '#DC2626' // red
                          : colors.cardElevated,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusPillText,
                      {
                        color: status.reward_status === 'NONE' ? colors.textMuted : '#FFFFFF',
                      },
                    ]}
                  >
                    {status.reward_status === 'ACTIVE'
                      ? 'ACTIVE'
                      : status.reward_status === 'EXPIRED'
                      ? 'EXPIRED'
                      : 'NO ACTIVE REWARD'}
                  </Text>
                </View>
              </View>

              {status.reward_status === 'ACTIVE' ? (
                <View style={styles.rewardDetails}>
                  <Text style={[styles.daysRemainingText, { color: colors.gold }]}>
                    {status.days_remaining} {status.days_remaining === 1 ? 'day' : 'days'} remaining
                  </Text>
                  <Text style={[styles.rewardSubtext, { color: colors.textMuted }]}>
                    {status.days_granted} days of ad-supported access granted
                  </Text>
                  <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />
                  <View style={styles.dateRow}>
                    <Text style={[styles.dateLabel, { color: colors.textMuted }]}>Activated:</Text>
                    <Text style={[styles.dateVal, { color: colors.text }]}>{formatDate(status.activated_at)}</Text>
                  </View>
                  <View style={styles.dateRow}>
                    <Text style={[styles.dateLabel, { color: colors.textMuted }]}>Expires:</Text>
                    <Text style={[styles.dateVal, { color: colors.text }]}>{formatDate(status.expires_at)}</Text>
                  </View>
                </View>
              ) : (
                <Text style={[styles.noRewardDesc, { color: colors.textMuted }]}>
                  {status.reward_status === 'EXPIRED'
                    ? 'Your previous reward period has ended. Invite more friends to earn extended free access!'
                    : 'Invite at least 1 friend to activate 30 days of ad-supported free access.'}
                </Text>
              )}

              {/* Distinction notice */}
              <View style={[styles.distinctionBox, { backgroundColor: colors.cardElevated }]}>
                <Text style={[styles.distinctionText, { color: colors.textSubtle }]}>
                  ℹ️ Ad-supported free access includes standard advertisements and does not grant paid Aura Plus / Aura Black ad-free privileges.
                </Text>
              </View>
            </View>

            {/* Milestones & Progress Tracker */}
            <View style={[styles.progressCard, { backgroundColor: colors.card, borderColor: colors.borderSubtle }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Reward Milestones</Text>
              <Text style={[styles.progressSubtitle, { color: colors.textMuted }]}>
                {status.verified_count} of 3 verified referrals completed
              </Text>

              {/* Visual Progress Bar */}
              <View style={[styles.progressBarTrack, { backgroundColor: colors.cardElevated }]}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      backgroundColor: colors.gold,
                      width: `${Math.min(100, Math.round((status.verified_count / 3) * 100))}%`,
                    },
                  ]}
                />
              </View>

              {/* Milestone 1 */}
              <View style={[styles.milestoneItem, { borderBottomColor: colors.borderSubtle }]}>
                <View
                  style={[
                    styles.milestoneBadge,
                    {
                      backgroundColor:
                        status.verified_count >= 1 ? colors.gold : colors.cardElevated,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.milestoneBadgeText,
                      { color: status.verified_count >= 1 ? colors.textInverse : colors.textMuted },
                    ]}
                  >
                    {status.verified_count >= 1 ? '✓' : '1'}
                  </Text>
                </View>
                <View style={styles.milestoneInfo}>
                  <Text style={[styles.milestoneTitle, { color: colors.text }]}>
                    1 Verified Referral
                  </Text>
                  <Text style={[styles.milestoneDesc, { color: colors.textMuted }]}>
                    30 days of ad-supported free access
                  </Text>
                </View>
                <Text
                  style={[
                    styles.milestoneStatus,
                    { color: status.verified_count >= 1 ? '#059669' : colors.textMuted },
                  ]}
                >
                  {status.verified_count >= 1 ? 'Unlocked' : 'In Progress'}
                </Text>
              </View>

              {/* Milestone 2 */}
              <View style={styles.milestoneItem}>
                <View
                  style={[
                    styles.milestoneBadge,
                    {
                      backgroundColor:
                        status.verified_count >= 3 ? colors.gold : colors.cardElevated,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.milestoneBadgeText,
                      { color: status.verified_count >= 3 ? colors.textInverse : colors.textMuted },
                    ]}
                  >
                    {status.verified_count >= 3 ? '✓' : '3'}
                  </Text>
                </View>
                <View style={styles.milestoneInfo}>
                  <Text style={[styles.milestoneTitle, { color: colors.text }]}>
                    3 Verified Referrals
                  </Text>
                  <Text style={[styles.milestoneDesc, { color: colors.textMuted }]}>
                    60 days total ad-supported free access
                  </Text>
                </View>
                <Text
                  style={[
                    styles.milestoneStatus,
                    { color: status.verified_count >= 3 ? '#059669' : colors.textMuted },
                  ]}
                >
                  {status.verified_count >= 3 ? 'Unlocked' : 'In Progress'}
                </Text>
              </View>

              {status.next_milestone && (
                <View style={[styles.nextMilestoneBanner, { backgroundColor: colors.cardElevated }]}>
                  <Text style={[styles.nextMilestoneText, { color: colors.gold }]}>
                    ★ Next: {status.next_milestone.description}
                  </Text>
                </View>
              )}
            </View>

            {/* Referral History */}
            <View style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.borderSubtle }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Referral History</Text>
              {status.recent_referrals.length === 0 ? (
                <Text style={[styles.noReferralsText, { color: colors.textMuted }]}>
                  No referrals yet. Share your code above to start earning rewards!
                </Text>
              ) : (
                status.recent_referrals.map((item, index) => (
                  <View
                    key={index}
                    style={[
                      styles.historyItem,
                      index < status.recent_referrals.length - 1 && {
                        borderBottomColor: colors.borderSubtle,
                        borderBottomWidth: 1,
                      },
                    ]}
                  >
                    <View style={styles.historyLeft}>
                      <Text style={[styles.historyID, { color: colors.text }]}>
                        {item.masked_identifier}
                      </Text>
                      <Text style={[styles.historyDate, { color: colors.textMuted }]}>
                        Joined {formatDate(item.attributed_at)}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.historyStatusPill,
                        {
                          backgroundColor:
                            item.status === 'VERIFIED' ? '#064E3B' : '#78350F',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.historyStatusText,
                          {
                            color: item.status === 'VERIFIED' ? '#34D399' : '#FBBF24',
                          },
                        ]}
                      >
                        {item.status === 'VERIFIED' ? 'Verified' : 'Pending Verification'}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  backBtn: {
    paddingVertical: spacing.xs,
    paddingRight: spacing.sm,
  },
  backBtnText: {
    ...typography.body,
    fontWeight: '600',
    fontSize: 16,
  },
  headerTitle: {
    ...typography.h3,
    fontWeight: '700',
  },
  headerSpacer: {
    width: 48,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  centerContainer: {
    paddingVertical: spacing.xxxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...typography.body,
    marginTop: spacing.md,
  },
  errorCard: {
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    alignItems: 'center',
  },
  errorTitle: {
    ...typography.h3,
    marginBottom: spacing.xs,
  },
  errorText: {
    ...typography.body,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  retryBtnText: {
    ...typography.body,
    fontWeight: '700',
    color: '#000000',
  },
  vipNoticeCard: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  vipNoticeTitle: {
    ...typography.caption,
    fontWeight: '700',
    marginBottom: 4,
  },
  vipNoticeDesc: {
    ...typography.caption,
    lineHeight: 18,
  },
  codeCard: {
    padding: spacing.xl,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  codeCardBadge: {
    ...typography.caption,
    letterSpacing: 1.5,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  codeValue: {
    ...typography.h1,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 2,
    marginVertical: spacing.sm,
  },
  codeInstructions: {
    ...typography.caption,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  btnRow: {
    flexDirection: 'row',
    gap: spacing.md,
    width: '100%',
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  primaryBtnText: {
    ...typography.body,
    fontWeight: '700',
    color: '#000000',
  },
  secondaryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  secondaryBtnText: {
    ...typography.body,
    fontWeight: '600',
  },
  rewardStatusCard: {
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  rewardStatusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.h3,
    fontWeight: '700',
  },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  statusPillText: {
    ...typography.caption,
    fontWeight: '700',
    fontSize: 11,
  },
  rewardDetails: {
    marginTop: spacing.xs,
  },
  daysRemainingText: {
    ...typography.h2,
    fontWeight: '800',
  },
  rewardSubtext: {
    ...typography.caption,
    marginTop: 2,
  },
  divider: {
    height: 1,
    marginVertical: spacing.md,
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  dateLabel: {
    ...typography.caption,
  },
  dateVal: {
    ...typography.caption,
    fontWeight: '600',
  },
  noRewardDesc: {
    ...typography.body,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  distinctionBox: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  distinctionText: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 16,
  },
  progressCard: {
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  progressSubtitle: {
    ...typography.caption,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  progressBarTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  milestoneItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  milestoneBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  milestoneBadgeText: {
    ...typography.caption,
    fontWeight: '800',
  },
  milestoneInfo: {
    flex: 1,
  },
  milestoneTitle: {
    ...typography.body,
    fontWeight: '700',
  },
  milestoneDesc: {
    ...typography.caption,
    marginTop: 2,
  },
  milestoneStatus: {
    ...typography.caption,
    fontWeight: '700',
  },
  nextMilestoneBanner: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  nextMilestoneText: {
    ...typography.caption,
    fontWeight: '700',
  },
  historyCard: {
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  noReferralsText: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 20,
  },
  historyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  historyLeft: {
    flex: 1,
  },
  historyID: {
    ...typography.body,
    fontWeight: '600',
  },
  historyDate: {
    ...typography.caption,
    marginTop: 2,
  },
  historyStatusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  historyStatusText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
  },
});
