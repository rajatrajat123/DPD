import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius } from '../theme';
import { privacyManager } from '../services/security/privacyManager';
import { useAuth } from '../context/AuthContext';

export const PrivacyVeil: React.FC = () => {
  const [isBackground, setIsBackground] = useState(false);
  const { biometricLocked, unlockBiometric } = useAuth();

  useEffect(() => {
    const unsubscribe = privacyManager.subscribeToAppState((background) => {
      setIsBackground(background);
    });
    return unsubscribe;
  }, []);

  const shouldShow = isBackground || biometricLocked;

  if (!shouldShow) return null;

  return (
    <View style={styles.overlay}>
      <SafeAreaView style={styles.container}>
        <View style={styles.badgeContainer}>
          <Text style={styles.monogram}>A</Text>
        </View>

        <Text style={styles.title}>AURA</Text>
        <Text style={styles.subtitle}>Private & Discreet LGBTQ+ Dating</Text>

        <View style={styles.shieldBox}>
          <Text style={styles.shieldIcon}>🛡️</Text>
          <Text style={styles.statusText}>
            {biometricLocked ? 'Biometric App Lock Active' : 'Screen Protected for Privacy'}
          </Text>
          <Text style={styles.description}>
            {biometricLocked
              ? 'Authenticate with Face ID or biometric unlock to resume your session.'
              : 'Your dating profile, matches, and chats are concealed in the app switcher.'}
          </Text>
        </View>

        {biometricLocked && (
          <TouchableOpacity style={styles.unlockButton} activeOpacity={0.8} onPress={() => unlockBiometric()}>
            <Text style={styles.unlockButtonText}>Unlock with Biometrics</Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    zIndex: 999999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    maxWidth: 400,
  },
  badgeContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: colors.gold,
    backgroundColor: colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  monogram: {
    ...typography.display,
    color: colors.gold,
    fontSize: 28,
  },
  title: {
    ...typography.h1,
    color: colors.text,
    letterSpacing: 4,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: spacing.xxl,
  },
  shieldBox: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    width: '100%',
    marginBottom: spacing.xl,
  },
  shieldIcon: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  statusText: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  description: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  unlockButton: {
    backgroundColor: colors.gold,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: borderRadius.md,
    width: '100%',
    alignItems: 'center',
  },
  unlockButtonText: {
    ...typography.button,
    color: colors.textInverse,
  },
});
