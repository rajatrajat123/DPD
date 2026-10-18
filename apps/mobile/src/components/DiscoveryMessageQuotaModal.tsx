import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { colors, typography, spacing, borderRadius, useTheme } from '../theme';
import { admobService, isGoogleMobileAdsAvailable } from '../services/ads/admobService';
import { discoveryService } from '../services/discovery/discoveryService';
import { DiscoveryMessagingQuota } from '../types';

interface DiscoveryMessageQuotaModalProps {
  visible: boolean;
  userId: string;
  quota: DiscoveryMessagingQuota | null;
  onClose: () => void;
  onQuotaUpdated: (quota: DiscoveryMessagingQuota) => void;
  onUpgradePress: () => void;
}

export const DiscoveryMessageQuotaModal: React.FC<DiscoveryMessageQuotaModalProps> = ({
  visible,
  userId,
  quota,
  onClose,
  onQuotaUpdated,
  onUpgradePress,
}) => {
  const { colors } = useTheme();
  const [isWatchingAd, setIsWatchingAd] = useState(false);
  const [adMessage, setAdMessage] = useState<string | null>(null);

  // Compute initial remaining seconds
  const computeInitialSeconds = (): number => {
    if (!quota) return 0;
    if (quota.cooldown_expires_at) {
      const diff = Math.floor((new Date(quota.cooldown_expires_at).getTime() - Date.now()) / 1000);
      return diff > 0 ? diff : 0;
    }
    return quota.cooldown_seconds_remaining > 0 ? quota.cooldown_seconds_remaining : 0;
  };

  const [secondsRemaining, setSecondsRemaining] = useState<number>(computeInitialSeconds());

  useEffect(() => {
    setSecondsRemaining(computeInitialSeconds());
  }, [quota?.cooldown_expires_at, quota?.cooldown_seconds_remaining, visible]);

  // Live ~1-second countdown interval
  useEffect(() => {
    if (!visible || secondsRemaining <= 0) return;

    const interval = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          // Cooldown reached 00:00 -> refresh quota from server
          discoveryService.getMessagingQuota().then((refreshed) => {
            onQuotaUpdated(refreshed);
          }).catch(() => {});
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [visible, secondsRemaining]);

  const formatCountdown = (totalSec: number): string => {
    if (totalSec <= 0) return '00:00';
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleWatchAd = async () => {
    if (!quota?.can_unlock_with_ad) return;

    setIsWatchingAd(true);
    setAdMessage(null);

    try {
      let txId: string | undefined;

      if (isGoogleMobileAdsAvailable()) {
        const result = await admobService.showRewardedAd(userId);
        if (!result.rewarded) {
          setAdMessage(result.error || 'Video was closed before earning the reward.');
          setIsWatchingAd(false);
          return;
        }
        txId = result.transactionId;
      } else {
        // Development / Expo Go fallback with unique transaction ID
        txId = `ad-unlock-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      }

      // Unlock bonus slots on backend
      const updated = await discoveryService.unlockMessagingQuotaWithAd(txId);
      onQuotaUpdated(updated);
      setAdMessage(
        updated.is_in_trial
          ? 'Success! Next 4 Discovery profile initiations unlocked.'
          : 'Success! 2 bonus Discovery messages unlocked.'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to unlock bonus with ad.';
      setAdMessage(msg);
    } finally {
      setIsWatchingAd(false);
    }
  };

  const isInTrial = Boolean(quota?.is_in_trial);
  const trialDistinct = quota?.trial_distinct_messaged ?? quota?.distinct_profiles_messaged ?? 4;
  const trialAllowed = quota?.trial_initiations_allowed ?? 4;
  const trialDaysRemaining = quota?.trial_days_remaining ?? 30;

  const isAdUnlocked = Boolean(quota?.ad_unlocked);
  const bonusSlots = quota?.bonus_slots_remaining ?? 0;
  const isTrialCooldown = isInTrial && (Boolean(quota?.cooldown_active) || trialDistinct >= 12);
  const canUnlockAd = Boolean(quota?.can_unlock_with_ad) && !isTrialCooldown;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]} testID="discovery-message-quota-modal">
          {/* Header Badge */}
          <View style={[styles.badgeWrap, { backgroundColor: 'rgba(212,175,55,0.15)', borderColor: colors.gold }]}>
            <Text style={[styles.badgeText, { color: colors.gold }]}>
              {isTrialCooldown
                ? '2-HOUR COOLDOWN • USAGE LIMIT'
                : isInTrial
                ? '30-DAY TRIAL • DISCOVERY MESSAGING'
                : 'DISCOVERY MESSAGE QUOTA'}
            </Text>
          </View>

          <Text style={[styles.title, { color: colors.text }]}>
            {isTrialCooldown
              ? 'Usage Limit Reached'
              : isInTrial
              ? 'Discovery Limit Reached'
              : 'Free Quota Locked'}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSubtle }]}>
            {isTrialCooldown
              ? "You've reached your usage limit. Please try again in 2 hours."
              : isInTrial
              ? 'During your 30-day trial, all conversation chats and replies are 100% unlimited. Discovery profile initiations are limited to 4 distinct profiles per batch. Watch a short video to unlock the next 4 profiles.'
              : 'Free members can initiate intro messages with 2 distinct Discovery profiles per cycle. Regular chat replies in existing matches remain completely free.'}
          </Text>

          {/* Initiation Counter or Countdown Display */}
          {isTrialCooldown ? (
            <View style={[styles.timerContainer, { backgroundColor: colors.cardElevated, borderColor: colors.borderSubtle }]} testID="quota-countdown-timer">
              <Text style={[styles.timerLabel, { color: colors.textSubtle }]}>NEXT TRIAL CYCLE IN</Text>
              <Text style={[styles.timerValue, { color: colors.gold }]}>
                {formatCountdown(secondsRemaining)}
              </Text>
              <Text style={[styles.timerHint, { color: colors.textSubtle }]}>
                Resets back to 4 free distinct profile messages · Chat replies remain unlimited
              </Text>
            </View>
          ) : isInTrial ? (
            <View style={[styles.timerContainer, { backgroundColor: colors.cardElevated, borderColor: colors.borderSubtle }]} testID="trial-initiation-counter">
              <Text style={[styles.timerLabel, { color: colors.textSubtle }]}>DISCOVERY INITIATIONS</Text>
              <Text style={[styles.timerValue, { color: colors.gold }]}>
                {trialDistinct} / {trialAllowed} Profiles
              </Text>
              <Text style={[styles.timerHint, { color: colors.textSubtle }]}>
                {trialDaysRemaining} day{trialDaysRemaining === 1 ? '' : 's'} remaining in trial · Chat replies unlimited
              </Text>
            </View>
          ) : (
            <View style={[styles.timerContainer, { backgroundColor: colors.cardElevated, borderColor: colors.borderSubtle }]} testID="quota-countdown-timer">
              <Text style={[styles.timerLabel, { color: colors.textSubtle }]}>NEXT FREE CYCLE IN</Text>
              <Text style={[styles.timerValue, { color: colors.gold }]}>
                {formatCountdown(secondsRemaining)}
              </Text>
              <Text style={[styles.timerHint, { color: colors.textSubtle }]}>
                Resets back to 2 free distinct profile messages
              </Text>
            </View>
          )}

          {/* Bonus State Indicator */}
          {isAdUnlocked && !isTrialCooldown && (
            <View style={[styles.bonusNotice, { backgroundColor: 'rgba(212,175,55,0.1)', borderColor: colors.gold }]} testID="bonus-messages-badge">
              <Text style={[styles.bonusNoticeText, { color: colors.gold }]}>
                {isInTrial
                  ? `✦ Next 4 profile initiations unlocked (${quota?.trial_initiations_remaining ?? 0} remaining)`
                  : bonusSlots > 0
                  ? `✦ ${bonusSlots} of 2 bonus messages remaining`
                  : '✦ All ad bonus messages used for this cooldown'}
              </Text>
            </View>
          )}

          {adMessage && (
            <Text
              style={[
                styles.feedbackText,
                adMessage.includes('Success') ? { color: colors.gold } : { color: '#FF6B6B' },
              ]}
            >
              {adMessage}
            </Text>
          )}

          {/* Option 1: Watch Rewarded Video Ad */}
          {canUnlockAd ? (
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.gold }, isWatchingAd && styles.buttonDisabled]}
              onPress={handleWatchAd}
              disabled={isWatchingAd}
              activeOpacity={0.8}
              testID="unlock-ad-button"
            >
              {isWatchingAd ? (
                <ActivityIndicator color="#090A0E" size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {isInTrial ? 'Watch Video to Unlock Next 4 Profiles' : 'Watch Video to Unlock 2 Messages'}
                </Text>
              )}
            </TouchableOpacity>
          ) : (
            <View style={[styles.disabledAdButton, { backgroundColor: colors.cardElevated, borderColor: colors.borderSubtle }]}>
              <Text style={[styles.disabledAdButtonText, { color: colors.textSubtle }]}>
                {isTrialCooldown
                  ? 'Ad Unlocks Unavailable During Cooldown'
                  : isAdUnlocked
                  ? 'Ad Reward Claimed for Current Batch'
                  : 'Ad Unlock Unavailable'}
              </Text>
            </View>
          )}

          {/* Option 2: Upgrade to Plus */}
          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: colors.gold }]}
            onPress={() => {
              onClose();
              onUpgradePress();
            }}
            activeOpacity={0.8}
            testID="upgrade-unlimited-messages-btn"
          >
            <Text style={[styles.secondaryButtonText, { color: colors.gold }]}>Upgrade for Unlimited Messaging</Text>
          </TouchableOpacity>

          {/* Option 3: Dismiss */}
          <TouchableOpacity
            style={styles.textButton}
            onPress={onClose}
            activeOpacity={0.7}
            testID="quota-modal-close-btn"
          >
            <Text style={[styles.textButtonLabel, { color: colors.textSubtle }]}>Continue Browsing (Free Passes)</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#14171E',
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.25)',
    alignItems: 'center',
  },
  badgeWrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  timerContainer: {
    width: '100%',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  timerLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  timerValue: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
    marginBottom: 4,
  },
  timerHint: {
    fontSize: 11,
    textAlign: 'center',
  },
  bonusNotice: {
    width: '100%',
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  bonusNoticeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  feedbackText: {
    fontSize: 12,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  primaryButton: {
    width: '100%',
    height: 48,
    borderRadius: borderRadius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  primaryButtonText: {
    color: '#090A0E',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  disabledAdButton: {
    width: '100%',
    height: 44,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  disabledAdButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  secondaryButton: {
    width: '100%',
    height: 46,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  textButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginTop: 2,
  },
  textButtonLabel: {
    fontSize: 12,
    textAlign: 'center',
  },
});
