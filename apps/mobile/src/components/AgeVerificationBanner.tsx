import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../theme';

interface AgeVerificationBannerProps {
  onVerifyPress: () => void;
  onCheckStatus?: () => void;
}

export const AgeVerificationBanner: React.FC<AgeVerificationBannerProps> = ({ onVerifyPress, onCheckStatus }) => {
  return (
    <View style={styles.banner} testID="compact-age-verification-banner">
      <View style={styles.leftGroup}>
        <Text style={styles.icon}>⏳</Text>
        <View style={styles.textGroup}>
          <Text style={styles.title} numberOfLines={1}>Verification Pending</Text>
          <Text style={styles.subtitle} numberOfLines={1}>Get verified for your badge</Text>
        </View>
      </View>
      <View style={styles.actionsGroup}>
        <TouchableOpacity style={styles.primaryButton} activeOpacity={0.8} onPress={onVerifyPress}>
          <Text style={styles.primaryButtonText}>Get Verified</Text>
        </TouchableOpacity>
        {onCheckStatus && (
          <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.8} onPress={onCheckStatus}>
            <Text style={styles.secondaryButtonText}>Check Status</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#16130E',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.35)',
    borderRadius: borderRadius.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm + 2,
    marginHorizontal: spacing.md,
    marginTop: 6,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacing.xs,
  },
  icon: {
    fontSize: 15,
    marginRight: 6,
  },
  textGroup: {
    flexShrink: 1,
  },
  title: {
    ...typography.caption,
    color: colors.amber,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 15,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 13,
  },
  actionsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  primaryButton: {
    backgroundColor: colors.amber,
    borderRadius: borderRadius.xs,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  primaryButtonText: {
    ...typography.caption,
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 11,
  },
  secondaryButton: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    borderRadius: borderRadius.xs,
    paddingVertical: 4,
    paddingHorizontal: 7,
  },
  secondaryButtonText: {
    ...typography.caption,
    color: colors.amber,
    fontWeight: '600',
    fontSize: 11,
  },
});


