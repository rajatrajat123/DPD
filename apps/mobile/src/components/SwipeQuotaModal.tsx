import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { colors, typography, spacing, borderRadius } from '../theme';
import { admobService, isGoogleMobileAdsAvailable } from '../services/ads/admobService';

interface SwipeQuotaModalProps {
  visible: boolean;
  userId: string;
  onClose: () => void;
  onRewardGranted: (bonusAmount: number, transactionId?: string) => void;
  onUpgradePress: () => void;
}

export const SwipeQuotaModal: React.FC<SwipeQuotaModalProps> = ({
  visible,
  userId,
  onClose,
  onRewardGranted,
  onUpgradePress,
}) => {
  const [isWatchingAd, setIsWatchingAd] = useState(false);
  const [adMessage, setAdMessage] = useState<string | null>(null);

  const handleWatchAd = async () => {
    if (isWatchingAd) return;
    setIsWatchingAd(true);
    setAdMessage(null);

    try {
      if (!isGoogleMobileAdsAvailable()) {
        setAdMessage('Rewarded video ads are not supported in Expo Go. Please open the app in an Android development build to watch ads.');
        return;
      }
      const result = await admobService.showRewardedAd(userId, 'bonus_likes_reward');
      if (result.rewarded) {
        onRewardGranted(result.rewardAmount >= 5 ? result.rewardAmount : 5, result.transactionId);
        onClose();
      } else {
        setAdMessage(result.error || 'Video was closed before earning the reward.');
      }
    } catch {
      setAdMessage('Unable to load video at this time. Please try again later.');
    } finally {
      setIsWatchingAd(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modalCard} testID="swipe-quota-modal">
          <View style={styles.badgeWrap}>
            <Text style={styles.badgeText}>LIKE QUOTA REACHED</Text>
          </View>

          <Text style={styles.title}>Out of Free Likes</Text>
          <Text style={styles.subtitle}>
            Free members receive 15 likes per 12-hour window. PASS swipes and browsing remain completely free and unlimited.
          </Text>
          <Text style={[styles.subtitle, { fontSize: 11, color: colors.gold, marginTop: -8 }]}>
            Earn +5 bonus likes for photo-verified profiles by watching a short video.
          </Text>

          {adMessage && <Text style={styles.errorText}>{adMessage}</Text>}

          {/* Option 1: Watch Rewarded Video Ad */}
          <TouchableOpacity
            style={[styles.primaryButton, isWatchingAd && styles.buttonDisabled]}
            onPress={handleWatchAd}
            disabled={isWatchingAd}
            activeOpacity={0.8}
            testID="watch-rewarded-ad-button"
          >
            {isWatchingAd ? (
              <ActivityIndicator color={colors.background} size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>Watch Sponsored Video (+5 Likes)</Text>
            )}
          </TouchableOpacity>

          {/* Option 2: Upgrade to Aura Black / Plus */}
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => {
              onClose();
              onUpgradePress();
            }}
            activeOpacity={0.8}
            testID="upgrade-unlimited-button"
          >
            <Text style={styles.secondaryButtonText}>Upgrade for Unlimited Likes</Text>
          </TouchableOpacity>

          {/* Option 3: Continue Passing */}
          <TouchableOpacity style={styles.textButton} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.textButtonLabel}>Continue Browsing (Free Passes)</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#161616',
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    alignItems: 'center',
  },
  badgeWrap: {
    backgroundColor: 'rgba(212, 175, 55, 0.15)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.md,
  },
  badgeText: {
    ...typography.caption,
    color: colors.gold,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  errorText: {
    ...typography.caption,
    color: '#E06666',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: colors.gold,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    ...typography.button,
    color: colors.background,
    fontWeight: '700',
  },
  secondaryButton: {
    width: '100%',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.gold,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  secondaryButtonText: {
    ...typography.button,
    color: colors.gold,
    fontWeight: '600',
  },
  textButton: {
    paddingVertical: spacing.sm,
  },
  textButtonLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
  },
});
