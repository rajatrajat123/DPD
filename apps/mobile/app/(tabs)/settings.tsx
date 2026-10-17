import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, typography, spacing, borderRadius, useTheme } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';
import { privacyManager, BiometricStatus } from '../../src/services/security/privacyManager';
import { notificationManager } from '../../src/services/notifications/notificationManager';
import { config } from '../../src/config/env';

export default function SettingsScreen() {
  const router = useRouter();
  const { logout, setBiometricLock } = useAuth();
  const { colors } = useTheme();

  const [biometricStatus, setBiometricStatus] = useState<BiometricStatus>({
    isAvailable: false,
    isEnrolled: false,
    biometricType: 'NONE',
  });
  const [isBiometricActive, setIsBiometricActive] = useState(false);
  const [screenCaptureProtection, setScreenCaptureProtection] = useState(true);

  // Notification preferences
  const [pushEnabled, setPushEnabled] = useState(true);
  const [matchesPush, setMatchesPush] = useState(true);
  const [messagesPush, setMessagesPush] = useState(true);
  const [hideSensitivePreview, setHideSensitivePreview] = useState(true);

  useEffect(() => {
    async function loadSettings() {
      const bioStatus = await privacyManager.getBiometricStatus();
      setBiometricStatus(bioStatus);

      const isBioOn = await privacyManager.isBiometricLockEnabled();
      setIsBiometricActive(isBioOn);

      try {
        const prefs = await notificationManager.getPreferences();
        setPushEnabled(prefs.push_enabled);
        setMatchesPush(prefs.matches_push);
        setMessagesPush(prefs.messages_push);
        setHideSensitivePreview(prefs.hide_sensitive_preview);
      } catch {
        // Fallback defaults
      }
    }
    loadSettings();
  }, []);

  const handleToggleBiometric = async (value: boolean) => {
    if (value) {
      if (!biometricStatus.isAvailable || !biometricStatus.isEnrolled) {
        Alert.alert(
          'Biometrics Unavailable',
          'Biometric hardware is not enrolled on this device. Please set up Face ID or Fingerprint in device settings.'
        );
        return;
      }

      const success = await privacyManager.authenticateBiometric('Verify biometric to enable App Lock');
      if (success) {
        await setBiometricLock(true);
        setIsBiometricActive(true);
        Alert.alert('Biometric Lock Active', 'Aura will require biometric authentication whenever reopened.');
      }
    } else {
      const success = await privacyManager.authenticateBiometric('Verify biometric to disable App Lock');
      if (success) {
        await setBiometricLock(false);
        setIsBiometricActive(false);
      }
    }
  };

  const handleToggleScreenCapture = async (value: boolean) => {
    setScreenCaptureProtection(value);
    if (value) {
      await privacyManager.enableScreenCaptureProtection();
    } else {
      await privacyManager.disableScreenCaptureProtection();
    }
  };

  const handleTogglePush = async (value: boolean) => {
    setPushEnabled(value);
    if (value) {
      const reg = await notificationManager.registerPushToken();
      if (!reg.registered && !notificationManager.isRemotePushSupported()) {
        Alert.alert(
          'Expo Go Environment Note',
          'Remote push notifications require a native development build (expo-dev-client) and are unsupported in Expo Go. Your preference has been saved to your account.',
          [{ text: 'Understood' }]
        );
      }
    }
    try {
      await notificationManager.updatePreferences({ push_enabled: value });
    } catch {
      // Handled
    }
  };

  const handleToggleHidePreview = async (value: boolean) => {
    setHideSensitivePreview(value);
    try {
      await notificationManager.updatePreferences({ hide_sensitive_preview: value });
    } catch {
      // Handled
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Sign Out of Aura',
      'Are you sure you want to sign out? Your credentials will be wiped from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/(auth)/login');
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
        <Text style={[styles.title, { color: colors.text }]}>Privacy & Security</Text>
        <Text style={[styles.subtitle, { color: colors.gold }]}>Confidentiality by Design</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Device Privacy Controls */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>App Protection</Text>

          {/* Biometric Lock */}
          <View style={[styles.settingRow, { borderBottomColor: colors.borderSubtle }]}>
            <View style={styles.settingInfo}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                Biometric App Lock ({biometricStatus.biometricType === 'FACE_ID' ? 'Face ID' : 'Fingerprint'})
              </Text>
              <Text style={[styles.settingDesc, { color: colors.textMuted }]}>
                Require biometric unlock whenever returning to the Aura app.
              </Text>
            </View>
            <Switch
              value={isBiometricActive}
              onValueChange={handleToggleBiometric}
              trackColor={{ false: colors.border, true: colors.gold }}
              thumbColor={colors.text}
            />
          </View>

          {/* App Switcher Blur Info */}
          <View style={[styles.settingRow, { borderBottomColor: colors.borderSubtle }]}>
            <View style={styles.settingInfo}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>App Switcher Privacy Veil</Text>
              <Text style={[styles.settingDesc, { color: colors.textMuted }]}>
                Active by default. Automatically veils profile cards and messages when multitasking.
              </Text>
            </View>
            <View style={styles.activePill}>
              <Text style={styles.activePillText}>Shield Active</Text>
            </View>
          </View>

          {/* Screenshot Prevention */}
          <View style={[styles.settingRow, { borderBottomColor: colors.borderSubtle }]}>
            <View style={styles.settingInfo}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Block Screen Captures (Android)</Text>
              <Text style={[styles.settingDesc, { color: colors.textMuted }]}>
                Blocks screenshots and screen recording on private chat and member screens.
              </Text>
            </View>
            <Switch
              value={screenCaptureProtection}
              onValueChange={handleToggleScreenCapture}
              trackColor={{ false: colors.border, true: colors.gold }}
              thumbColor={colors.text}
            />
          </View>
        </View>

        {/* Notifications & Lock Screen Privacy */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Notification Privacy</Text>

          <View style={[styles.settingRow, { borderBottomColor: colors.borderSubtle }]}>
            <View style={styles.settingInfo}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Push Notifications</Text>
              <Text style={[styles.settingDesc, { color: colors.textMuted }]}>
                {!notificationManager.isRemotePushSupported()
                  ? 'Account preference saved. (Remote APNs/FCM delivery requires a native development build, unsupported in Expo Go)'
                  : 'Receive real-time alerts for matches and messages.'}
              </Text>
            </View>
            <Switch
              value={pushEnabled}
              onValueChange={handleTogglePush}
              trackColor={{ false: colors.border, true: colors.gold }}
              thumbColor={colors.text}
            />
          </View>

          <View style={[styles.settingRow, { borderBottomColor: colors.borderSubtle }]}>
            <View style={styles.settingInfo}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Mask Lock Screen Previews</Text>
              <Text style={[styles.settingDesc, { color: colors.textMuted }]}>
                Hide sender names and message snippets on the lock screen to protect discretion.
              </Text>
            </View>
            <Switch
              value={hideSensitivePreview}
              onValueChange={handleToggleHidePreview}
              trackColor={{ false: colors.border, true: colors.gold }}
              thumbColor={colors.text}
            />
          </View>
        </View>

        {/* System & Telemetry */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Backend Connection</Text>
          <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.borderSubtle }]}>
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.textMuted }]}>API Base URL</Text>
              <Text style={[styles.infoValue, { color: colors.gold }]} numberOfLines={1}>
                {config.apiUrl}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.textMuted }]}>App Version</Text>
              <Text style={[styles.infoValue, { color: colors.gold }]}>{config.appVersion}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Environment</Text>
              <Text style={[styles.infoValue, { color: colors.gold }]}>{config.environment.toUpperCase()}</Text>
            </View>
          </View>
        </View>

        {/* Logout */}
        <TouchableOpacity
          style={[styles.logoutBtn, { backgroundColor: colors.card, borderColor: colors.ruby }]}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <Text style={[styles.logoutBtnText, { color: colors.ruby }]}>Sign Out of Aura</Text>
        </TouchableOpacity>
      </ScrollView>
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
    borderBottomColor: colors.border,
  },
  title: {
    ...typography.h2,
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.gold,
    letterSpacing: 1,
    marginTop: 2,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  settingInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  settingTitle: {
    ...typography.bodyLarge,
    color: colors.text,
    fontWeight: '600',
  },
  settingDesc: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  activePill: {
    backgroundColor: colors.emeraldMuted,
    borderWidth: 1,
    borderColor: colors.emerald,
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  activePillText: {
    ...typography.caption,
    fontSize: 9,
    color: colors.emerald,
    fontWeight: '700',
  },
  infoCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  infoLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  infoValue: {
    ...typography.caption,
    color: colors.gold,
    maxWidth: 200,
  },
  logoutBtn: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.ruby,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xxl,
  },
  logoutBtnText: {
    ...typography.button,
    color: colors.ruby,
  },
});
