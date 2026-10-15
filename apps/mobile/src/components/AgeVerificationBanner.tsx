import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../theme';

interface AgeVerificationBannerProps {
  onVerifyPress: () => void;
}

export const AgeVerificationBanner: React.FC<AgeVerificationBannerProps> = ({ onVerifyPress }) => {
  return (
    <View style={styles.banner}>
      <View style={styles.content}>
        <Text style={styles.icon}>⚠️</Text>
        <View style={styles.textContainer}>
          <Text style={styles.title}>18+ Age Assurance Required</Text>
          <Text style={styles.description}>
            Dating discovery, matching, and messaging are locked until your age is verified.
          </Text>
        </View>
      </View>
      <TouchableOpacity style={styles.button} activeOpacity={0.8} onPress={onVerifyPress}>
        <Text style={styles.buttonText}>Verify Now</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.amberMuted,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  icon: {
    fontSize: 24,
    marginRight: spacing.md,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    ...typography.h3,
    color: colors.amber,
    fontSize: 15,
    marginBottom: 2,
  },
  description: {
    ...typography.bodySmall,
    color: colors.textMuted,
    lineHeight: 16,
  },
  button: {
    backgroundColor: colors.amber,
    borderRadius: borderRadius.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    alignSelf: 'flex-start',
  },
  buttonText: {
    ...typography.caption,
    color: colors.textInverse,
    fontWeight: '700',
  },
});
