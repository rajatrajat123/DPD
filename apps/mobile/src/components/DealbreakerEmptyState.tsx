import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../theme';

interface DealbreakerEmptyStateProps {
  onAdjustFilters: () => void;
  onRefresh: () => void;
  reason?: string;
  errorMessage?: string | null;
}

export const DealbreakerEmptyState: React.FC<DealbreakerEmptyStateProps> = ({
  onAdjustFilters,
  onRefresh,
  reason,
  errorMessage,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Text style={styles.icon}>✨</Text>
      </View>

      <Text style={styles.title}>All Caught Up</Text>
      <Text style={styles.subtitle}>Strict Dealbreaker Integrity Active</Text>

      <Text style={styles.description}>
        There are no new profiles matching your exact criteria right now. Because Aura enforces strict dealbreaker
        integrity, we will never compromise your preferences (such as Non-smokers only) merely to fill the deck.
      </Text>

      {(reason || errorMessage) ? (
        <View style={styles.diagnosticPill} testID="discovery-diagnostic-pill">
          <Text style={styles.diagnosticLabel}>Status Diagnostic:</Text>
          <Text style={styles.diagnosticValue}>
            {errorMessage || reason}
          </Text>
        </View>
      ) : null}

      <View style={styles.buttonsContainer}>
        <TouchableOpacity style={styles.primaryButton} onPress={onAdjustFilters} activeOpacity={0.8}>
          <Text style={styles.primaryButtonText}>Adjust Discovery Preferences</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={onRefresh} activeOpacity={0.8}>
          <Text style={styles.secondaryButtonText}>Refresh Feed</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
    backgroundColor: colors.background,
  },
  iconCircle: {
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
  icon: {
    fontSize: 32,
  },
  title: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.caption,
    color: colors.gold,
    letterSpacing: 1.5,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  description: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xxl,
    maxWidth: 320,
  },
  buttonsContainer: {
    width: '100%',
    maxWidth: 280,
    gap: spacing.sm,
  },
  primaryButton: {
    backgroundColor: colors.gold,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
    alignItems: 'center',
  },
  primaryButtonText: {
    ...typography.button,
    color: colors.textInverse,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
    alignItems: 'center',
  },
  secondaryButtonText: {
    ...typography.button,
    color: colors.textMuted,
  },
  diagnosticPill: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.cardElevated,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    maxWidth: 320,
  },
  diagnosticLabel: {
    ...typography.caption,
    color: colors.textSubtle,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  diagnosticValue: {
    ...typography.caption,
    color: colors.gold,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
  },
});
