import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, useTheme } from '../../src/theme';
import Constants from 'expo-constants';
import { storeBilling } from '../../src/services/billing/storeBilling';
import { BillingPlan, EntitlementsResponse, Subscription } from '../../src/types';

export default function MembershipScreen() {
  const { colors } = useTheme();
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [entitlements, setEntitlements] = useState<EntitlementsResponse | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [isBoosting, setIsBoosting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const loadBillingData = useCallback(async () => {
    try {
      const [plansRes, entRes, subRes] = await Promise.all([
        storeBilling.getAvailablePlans(),
        storeBilling.getActiveEntitlements(),
        storeBilling.getSubscription(),
      ]);
      setPlans(plansRes || []);
      setEntitlements(entRes);
      setSubscription(subRes);
    } catch {
      // Backend fallback
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadBillingData();
  }, [loadBillingData]);

  const onRefresh = () => {
    setIsRefreshing(true);
    loadBillingData();
  };

  const executeNativeStorePurchase = async (plan: BillingPlan) => {
    setIsUpgrading(true);
    try {
      const result = await storeBilling.requestSubscriptionPurchase(plan.plan_code, plan.plan_code);
      if (result.success) {
        Alert.alert('Subscription Verified', `Welcome to ${plan.name}! Your premium benefits are active.`);
        await loadBillingData();
      } else {
        Alert.alert('Verification Notice', result.statusMessage || 'Store purchase could not be verified.');
      }
    } catch {
      Alert.alert('Error', 'Transaction verification failed.');
    } finally {
      setIsUpgrading(false);
    }
  };

  const handlePurchasePlan = async (plan: BillingPlan) => {
    try {
      const policy = await storeBilling.getStorefrontPolicy();

      if (policy.requires_choice_screen && policy.external_checkout_permitted && policy.external_checkout_url) {
        Alert.alert(
          `Subscribe to ${plan.name}`,
          `${policy.disclosure_notice}\n\nPrice: ${plan.currency} ${(plan.price_cents / 100).toFixed(2)} / ${plan.billing_period.toLowerCase()}`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Direct Web Checkout',
              onPress: async () => {
                const checkoutUrl = policy.external_checkout_url + '&plan=' + plan.plan_code;
                await Linking.openURL(checkoutUrl);
              },
            },
            {
              text: 'In-App Store Purchase',
              onPress: async () => {
                await executeNativeStorePurchase(plan);
              },
            },
          ]
        );
      } else {
        Alert.alert(
          `Upgrade to ${plan.name}`,
          `${policy.disclosure_notice}\n\nPrice: ${plan.currency} ${(plan.price_cents / 100).toFixed(2)} / ${plan.billing_period.toLowerCase()}`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Confirm In-App Purchase',
              onPress: async () => {
                await executeNativeStorePurchase(plan);
              },
            },
          ]
        );
      }
    } catch {
      await executeNativeStorePurchase(plan);
    }
  };

  const handleActivateBoost = async () => {
    if (!entitlements || entitlements.boost_credits_remaining <= 0) {
      Alert.alert('No Boost Credits', 'You do not have any boost credits available. Upgrade your tier to get monthly credits.');
      return;
    }

    setIsBoosting(true);
    try {
      const res = await storeBilling.activateBoost(30);
      if (res.success) {
        Alert.alert('Profile Boosted!', 'Your profile is boosted with a 3x discovery multiplier for the next 30 minutes.');
        await loadBillingData();
      }
    } catch {
      Alert.alert('Boost Error', 'Could not activate boost at this time.');
    } finally {
      setIsBoosting(false);
    }
  };

  const handleManageOrCancelSubscription = async () => {
    if (!subscription) return;

    if (subscription.provider === 'APPLE_APP_STORE') {
      Alert.alert(
        'Manage Apple Subscription',
        'Your subscription is billed through Apple. You can manage or cancel your renewal directly in your Apple ID settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Apple Subscriptions',
            onPress: () => Linking.openURL('https://apps.apple.com/account/subscriptions'),
          },
        ]
      );
      return;
    }

    if (subscription.provider === 'GOOGLE_PLAY') {
      const androidPackage = Constants.expoConfig?.android?.package;
      const playUrl = androidPackage
        ? `https://play.google.com/store/account/subscriptions?package=${encodeURIComponent(androidPackage)}`
        : 'https://play.google.com/store/account/subscriptions';

      Alert.alert(
        'Manage Google Play Subscription',
        'Your subscription is billed through Google Play. You can manage or cancel your renewal directly in the Play Store.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Google Play Subscriptions',
            onPress: () => Linking.openURL(playUrl),
          },
        ]
      );
      return;
    }

    Alert.alert(
      'Cancel Subscription Renewal',
      'Are you sure you want to cancel auto-renewal? Your premium entitlements will remain active until the end of your current period.',
      [
        { text: 'Keep Subscription', style: 'cancel' },
        {
          text: 'Confirm Cancellation',
          style: 'destructive',
          onPress: async () => {
            setIsCancelling(true);
            try {
              await storeBilling.cancelSubscriptionRenewal();
              Alert.alert(
                'Renewal Cancelled',
                'Your auto-renewal has been cancelled. You retain full access until ' +
                  new Date(subscription.current_period_end).toLocaleDateString() +
                  '.'
              );
              await loadBillingData();
            } catch {
              Alert.alert('Error', 'Could not cancel subscription renewal. Please try again.');
            } finally {
              setIsCancelling(false);
            }
          },
        },
      ]
    );
  };

  const activeTier = entitlements?.tier || 'MEMBER';
  const rawEnts = entitlements?.entitlements;
  const entitlementList: string[] = Array.isArray(rawEnts)
    ? rawEnts.map((e: any) => (typeof e === 'string' ? e : e?.entitlement_code || ''))
    : [];
  const hasUnlimitedSwipes = entitlementList.includes('UNLIMITED_SWIPES');
  const hasRewind = entitlementList.includes('REWIND');
  const hasSeeWhoLiked = entitlementList.includes('SEE_WHO_LIKED_YOU');
  const hasTravelMode = entitlementList.includes('TRAVEL_MODE');

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
        <Text style={[styles.title, { color: colors.text }]}>Aura VIP</Text>
        <Text style={[styles.subtitle, { color: colors.gold }]}>Premium Membership & Entitlements</Text>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.gold} size="large" />
          <Text style={styles.loadingText}>Loading membership...</Text>
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
          {/* Current Status Card */}
          <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.statusHeader}>
              <View>
                <Text style={styles.statusLabel}>CURRENT STATUS</Text>
                <Text style={[styles.tierName, { color: colors.text }]}>
                  {activeTier === 'BLACK' ? 'Aura Black VIP' : activeTier === 'PLUS' ? 'Aura Plus' : 'Aura Member'}
                </Text>
              </View>
              <View style={[styles.tierBadge, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]}>
                <Text style={[styles.tierBadgeText, { color: colors.gold }]}>{activeTier}</Text>
              </View>
            </View>

            {subscription && (
              <View style={styles.subDetailContainer}>
                <Text style={styles.subDetail}>
                  {subscription.cancel_at_period_end ? 'Expires' : 'Renews'}:{' '}
                  {new Date(subscription.current_period_end).toLocaleDateString()} via {subscription.provider}
                </Text>

                {subscription.status === 'ACTIVE' && (
                  <TouchableOpacity
                    style={[
                      styles.cancelBtn,
                      subscription.cancel_at_period_end ? styles.cancelBtnDisabled : null,
                    ]}
                    onPress={handleManageOrCancelSubscription}
                    disabled={isCancelling || subscription.cancel_at_period_end}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.cancelBtnText}>
                      {subscription.cancel_at_period_end
                        ? 'Cancellation Scheduled'
                        : subscription.provider === 'STRIPE'
                        ? 'Cancel Subscription Renewal'
                        : 'Manage / Cancel in Store'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Boost Credits Row */}
            <View style={[styles.boostRow, { borderTopColor: colors.borderSubtle }]}>
              <View>
                <Text style={styles.boostLabel}>Profile Boost Credits</Text>
                <Text style={[styles.boostCount, { color: colors.gold }]}>
                  {entitlements?.boost_credits_remaining ?? 0} Credits Available
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.boostBtn,
                  { backgroundColor: colors.gold },
                  (!entitlements || entitlements.boost_credits_remaining <= 0) ? [styles.boostBtnDisabled, { backgroundColor: colors.cardElevated }] : null,
                ]}
                onPress={handleActivateBoost}
                disabled={isBoosting || !entitlements || entitlements.boost_credits_remaining <= 0}
                activeOpacity={0.8}
              >
                <Text style={[styles.boostBtnText, { color: colors.textInverse }]}>Boost 30m</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Active Entitlements Matrix */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Included Benefits</Text>
            <View style={[styles.matrixCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.matrixRow, { borderBottomColor: colors.borderSubtle }]}>
                <Text style={[styles.matrixLabel, { color: colors.text }]}>Unlimited Daily Swipes</Text>
                <Text style={hasUnlimitedSwipes ? styles.activeCheck : styles.inactiveDash}>
                  {hasUnlimitedSwipes ? '✓ Included' : '— Locked'}
                </Text>
              </View>
              <View style={[styles.matrixRow, { borderBottomColor: colors.borderSubtle }]}>
                <Text style={[styles.matrixLabel, { color: colors.text }]}>Rewind Last Pass</Text>
                <Text style={hasRewind ? styles.activeCheck : styles.inactiveDash}>
                  {hasRewind ? '✓ Included' : '— Locked'}
                </Text>
              </View>
              <View style={[styles.matrixRow, { borderBottomColor: colors.borderSubtle }]}>
                <Text style={[styles.matrixLabel, { color: colors.text }]}>See Who Liked You</Text>
                <Text style={hasSeeWhoLiked ? styles.activeCheck : styles.inactiveDash}>
                  {hasSeeWhoLiked ? '✓ Included' : '— Locked'}
                </Text>
              </View>
              <View style={[styles.matrixRow, { borderBottomColor: colors.borderSubtle }]}>
                <Text style={[styles.matrixLabel, { color: colors.text }]}>Travel Mode (Global Discovery)</Text>
                <Text style={hasTravelMode ? styles.activeCheck : styles.inactiveDash}>
                  {hasTravelMode ? '✓ Included' : '— Locked'}
                </Text>
              </View>
            </View>
          </View>

          {/* Available Plans */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Membership Tiers</Text>

            {!Array.isArray(plans) || plans.length === 0 ? (
              <View style={styles.emptyPlansCard}>
                <Text style={styles.emptyPlansText}>
                  Membership tiers are currently updating or unavailable.
                </Text>
                <TouchableOpacity style={styles.retryBtn} onPress={loadBillingData} activeOpacity={0.8}>
                  <Text style={styles.retryBtnText}>Refresh Plans</Text>
                </TouchableOpacity>
              </View>
            ) : (
              plans.map((p) => {
                const isCurrent = activeTier === p.tier;
                return (
                  <View key={p.id} style={[styles.planCard, { backgroundColor: colors.card, borderColor: colors.border }, isCurrent ? [styles.planCardActive, { borderColor: colors.gold }] : null]}>
                    <View style={styles.planHeader}>
                      <View style={styles.planInfo}>
                        <Text style={[styles.planName, { color: colors.text }]}>{p.name}</Text>
                        <Text style={styles.planDesc}>{p.description}</Text>
                      </View>
                      <View style={styles.planPriceContainer}>
                        <Text style={[styles.planPrice, { color: colors.gold }]}>
                          {p.currency} {(p.price_cents / 100).toFixed(2)}
                        </Text>
                        <Text style={styles.planPeriod}>/{p.billing_period.toLowerCase()}</Text>
                      </View>
                    </View>

                    <TouchableOpacity
                      style={[
                        styles.upgradeBtn,
                        { backgroundColor: colors.gold },
                        isCurrent ? [styles.upgradeBtnCurrent, { backgroundColor: colors.cardElevated, borderColor: colors.border }] : null,
                      ]}
                      onPress={() => handlePurchasePlan(p)}
                      disabled={isCurrent || isUpgrading}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.upgradeBtnText, { color: colors.textInverse }, isCurrent ? [styles.upgradeBtnTextCurrent, { color: colors.textMuted }] : null]}>
                        {isCurrent ? 'Current Tier' : `Select ${p.name}`}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </View>

          {/* Storefront Disclosure */}
          <View style={[styles.disclosureBox, { borderColor: colors.borderSubtle }]}>
            <Text style={styles.disclosureText}>
              ℹ️ Transactions are validated by the authoritative Go backend verification service.
              Live in-app purchases are billed via Google Play / Apple App Store.
            </Text>
          </View>
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
    letterSpacing: 0.8,
    marginTop: 2,
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
  statusCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.gold,
    marginBottom: spacing.xl,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  statusLabel: {
    ...typography.caption,
    color: colors.gold,
    letterSpacing: 1,
    fontSize: 10,
    fontWeight: '700',
  },
  tierName: {
    ...typography.h1,
    color: colors.text,
    fontSize: 22,
    marginTop: 2,
  },
  tierBadge: {
    backgroundColor: colors.goldMuted,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
  },
  tierBadgeText: {
    ...typography.caption,
    color: colors.gold,
    fontWeight: '700',
    fontSize: 11,
  },
  subDetailContainer: {
    marginTop: spacing.xs,
  },
  subDetail: {
    ...typography.caption,
    color: colors.textSubtle,
    marginBottom: spacing.xs,
  },
  cancelBtn: {
    marginTop: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.oxblood,
    alignSelf: 'flex-start',
  },
  cancelBtnDisabled: {
    opacity: 0.6,
    borderColor: colors.border,
  },
  cancelBtnText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  boostRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  boostLabel: {
    ...typography.bodySmall,
    color: colors.textMuted,
    fontSize: 12,
  },
  boostCount: {
    ...typography.bodyLarge,
    color: colors.gold,
    fontWeight: '700',
  },
  boostBtn: {
    backgroundColor: colors.gold,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
  },
  boostBtnDisabled: {
    backgroundColor: colors.cardElevated,
    opacity: 0.5,
  },
  boostBtnText: {
    ...typography.button,
    fontSize: 12,
    color: colors.textInverse,
    fontWeight: '700',
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    fontSize: 16,
    marginBottom: spacing.md,
  },
  matrixCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  matrixRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  matrixLabel: {
    ...typography.body,
    color: colors.text,
    fontSize: 13,
  },
  activeCheck: {
    ...typography.caption,
    color: colors.emerald,
    fontWeight: '700',
    fontSize: 12,
  },
  inactiveDash: {
    ...typography.caption,
    color: colors.textSubtle,
    fontSize: 12,
  },
  planCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  planCardActive: {
    borderColor: colors.gold,
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  planInfo: {
    flex: 1,
    paddingRight: spacing.md,
  },
  planName: {
    ...typography.h2,
    color: colors.text,
    fontSize: 18,
  },
  planDesc: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
  },
  planPriceContainer: {
    alignItems: 'flex-end',
  },
  planPrice: {
    ...typography.h2,
    color: colors.gold,
    fontSize: 18,
  },
  planPeriod: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
  },
  upgradeBtn: {
    backgroundColor: colors.gold,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
  },
  upgradeBtnCurrent: {
    backgroundColor: colors.cardElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  upgradeBtnText: {
    ...typography.button,
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 13,
  },
  upgradeBtnTextCurrent: {
    color: colors.textMuted,
  },
  disclosureBox: {
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  disclosureText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textSubtle,
    lineHeight: 14,
  },
  emptyPlansCard: {
    padding: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    marginVertical: spacing.sm,
  },
  emptyPlansText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryBtn: {
    paddingVertical: 6,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.gold,
    borderRadius: borderRadius.full,
  },
  retryBtnText: {
    ...typography.button,
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: '700',
  },
});
