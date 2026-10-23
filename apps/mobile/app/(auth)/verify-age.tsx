import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { colors, typography, spacing, borderRadius } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';
import { authService, AgeAssuranceStatus, PassportTrialStatus } from '../../src/services/auth/authService';

export default function VerifyAgeScreen() {
  const router = useRouter();
  const { refreshProfile } = useAuth();

  const [step, setStep] = useState<
    'INFO' | 'LAUNCHING' | 'SUBMITTING' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'FAILED'
  >('INFO');
  const [loading, setLoading] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [sessionUrl, setSessionUrl] = useState<string | null>(null);
  const [trialStatus, setTrialStatus] = useState<PassportTrialStatus | null>(null);

  // Authoritatively recover verification status on screen mount or navigation return
  const checkCurrentStatus = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const [statusRes, trialRes] = await Promise.all([
        authService.getAgeAssuranceStatus(),
        authService.getPassportTrialStatus().catch(() => null),
      ]);
      if (trialRes) {
        setTrialStatus(trialRes);
      }
      if (statusRes && statusRes.status === 'VERIFIED') {
        await refreshProfile();
        setStep('VERIFIED');
        return 'VERIFIED';
      } else if (statusRes && (statusRes.status === 'PENDING' || statusRes.status === 'MANUAL_REVIEW')) {
        setStep('PENDING');
        return statusRes.status;
      } else if (statusRes && statusRes.status === 'REJECTED') {
        setStep('REJECTED');
        return 'REJECTED';
      } else {
        setStep('INFO');
        return 'UNVERIFIED';
      }
    } catch {
      if (!silent) {
        setStep('INFO');
      }
      return 'ERROR';
    } finally {
      if (!silent) setLoading(false);
    }
  }, [refreshProfile]);

  useEffect(() => {
    let isMounted = true;
    checkCurrentStatus();
    return () => {
      isMounted = false;
    };
  }, [checkCurrentStatus]);

  /**
   * Polls backend authoritative status endpoint with backoff upon returning from hosted flow
   */
  const pollAuthoritativeStatus = async (maxRetries = 3, intervalMs = 1500): Promise<string> => {
    let outcome = 'PENDING';
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await authService.getAgeAssuranceStatus();
        if (res?.status === 'VERIFIED') {
          return 'VERIFIED';
        } else if (res?.status === 'REJECTED') {
          return 'REJECTED';
        } else if (res?.status === 'MANUAL_REVIEW') {
          return 'MANUAL_REVIEW';
        }
      } catch {
        // network or server transient issue
      }
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
    return outcome;
  };

  /**
   * Initiates real Persona passport/ID verification session and opens hosted flow in secure browser
   */
  const handleStartVerification = async () => {
    try {
      if (trialStatus?.requires_upgrade) {
        Alert.alert(
          'Passport Free Trial Expired',
          'Your 7-day passport verification free trial has expired. Aura Plus ($25/mo) or Extra Premium is required to verify your passport.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Upgrade Membership',
              onPress: () => router.push('/membership'),
            },
          ]
        );
        return;
      }

      setLoading(true);
      setErrorMessage('');
      setStep('LAUNCHING');

      // 1. Request authoritative verification session from backend
      const session = await authService.startAgeAssuranceSession();
      if (!session || !session.vendor_url) {
        throw new Error('Verification session could not be created. Please try again.');
      }

      setSessionUrl(session.vendor_url);

      // 2. Launch hosted verification in system web browser / Custom Tabs
      const redirectUrl = Linking.createURL('verify-age');
      const browserRes = await WebBrowser.openAuthSessionAsync(session.vendor_url, redirectUrl);

      // Check if user dismissed or cancelled the browser session
      if (browserRes.type === 'cancel' || browserRes.type === 'dismiss') {
        const fallback = await authService.getAgeAssuranceStatus().catch(() => null);
        if (fallback?.status === 'VERIFIED') {
          await refreshProfile();
          setStep('VERIFIED');
          return;
        }
        setErrorMessage('Verification was cancelled or closed. Please have your passport or government ID ready and try again.');
        setStep('FAILED');
        return;
      }

      // 3. User returned from browser — check authoritative backend status with backoff
      setStep('SUBMITTING');
      setCheckingStatus(true);
      const outcome = await pollAuthoritativeStatus(3, 1500);
      setCheckingStatus(false);

      if (outcome === 'VERIFIED') {
        await refreshProfile();
        setStep('VERIFIED');
      } else if (outcome === 'REJECTED') {
        setStep('REJECTED');
      } else {
        // Pending or manual review
        setStep('PENDING');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not launch passport verification.';
      if (msg.includes('PASSPORT_TRIAL_EXPIRED') || msg.toLowerCase().includes('trial has expired')) {
        Alert.alert(
          'Passport Free Trial Expired',
          'Your 7-day passport verification free trial has expired. Aura Plus ($25/mo) or Extra Premium is required to verify your passport.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Upgrade Membership',
              onPress: () => router.push('/membership'),
            },
          ]
        );
        setErrorMessage('7-day free trial has expired. Aura Plus membership required.');
        setStep('FAILED');
        return;
      }
      if (__DEV__) {
        console.error('[AgeVerification] Launch failed:', err);
      }
      setErrorMessage(msg);
      setStep('FAILED');
    } finally {
      setLoading(false);
      setCheckingStatus(false);
    }
  };

  /**
   * Re-queries authoritative status from backend
   */
  const handleCheckStatus = async () => {
    try {
      setCheckingStatus(true);
      const statusRes = await authService.getAgeAssuranceStatus();
      if (statusRes && statusRes.status === 'VERIFIED') {
        await refreshProfile();
        setStep('VERIFIED');
      } else if (statusRes && statusRes.status === 'REJECTED') {
        setStep('REJECTED');
      } else if (statusRes && statusRes.status === 'MANUAL_REVIEW') {
        Alert.alert(
          'Under Manual Review',
          'Your verification document has been flagged for manual safety review. This usually completes within 2 hours.'
        );
      } else {
        Alert.alert(
          'Verification In Progress',
          'Your passport verification is currently processing with Persona. Please check back shortly.'
        );
      }
    } catch {
      Alert.alert('Status Check Failed', 'Could not reach verification service. Please check your internet connection.');
    } finally {
      setCheckingStatus(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>🛡️</Text>
        </View>
        <Text style={styles.title}>18+ Age Assurance</Text>
        <Text style={styles.subtitle}>PASSPORT & GOVERNMENT ID VERIFICATION</Text>
      </View>

      {step === 'INFO' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Why Verification is Required</Text>
          <Text style={styles.cardBody}>
            Aura is a dedicated space exclusively for adult LGBTQ+ connections. To uphold legal compliance and
            protect member safety, every account must complete an automated 18+ age verification check before
            discovery matching and messaging are unlocked.
          </Text>

          {/* Passport 7-Day Free Trial Status */}
          <View
            style={[
              styles.trialBanner,
              trialStatus?.requires_upgrade ? styles.trialBannerExpired : null,
            ]}
          >
            <Text style={[styles.trialBannerTitle, trialStatus?.requires_upgrade ? { color: colors.amber } : null]}>
              {trialStatus?.requires_upgrade
                ? '⚠️ 7-Day Free Trial Expired'
                : trialStatus?.has_started
                ? `✈️ 7-Day Passport Trial: ${trialStatus.days_remaining} ${trialStatus.days_remaining === 1 ? 'day' : 'days'} left`
                : '✈️ 7-Day Free Trial Included'}
            </Text>
            <Text style={styles.trialBannerBody}>
              {trialStatus?.requires_upgrade
                ? 'Your free trial for passport verification has ended. Aura Plus ($25/mo) or Aura Extra Premium is required to continue.'
                : 'Verify your passport with Persona. Includes a 1-time 7-day free trial before requiring an active subscription.'}
            </Text>
            {trialStatus?.requires_upgrade && (
              <TouchableOpacity
                testID="upgrade-membership-button"
                style={styles.upgradeTrialButton}
                onPress={() => router.push('/membership')}
                activeOpacity={0.8}
              >
                <Text style={styles.upgradeTrialButtonText}>Upgrade to Aura Plus ($25/mo)</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.featureList}>
            <View style={styles.featureItem}>
              <Text style={styles.featureCheck}>✓</Text>
              <Text style={styles.featureText}>
                <Text style={styles.featureBold}>Passports & Official IDs: </Text>
                Verify instantly using your valid international passport or government-issued national ID.
              </Text>
            </View>
            <View style={styles.featureItem}>
              <Text style={styles.featureCheck}>✓</Text>
              <Text style={styles.featureText}>
                <Text style={styles.featureBold}>Zero Data Retention: </Text>
                Zero document storage: Aura never receives, processes, or stores your passport photo or ID images on our servers.
              </Text>
            </View>
            <View style={styles.featureItem}>
              <Text style={styles.featureCheck}>✓</Text>
              <Text style={styles.featureText}>
                <Text style={styles.featureBold}>Certified Security: </Text>
                Powered by Persona's end-to-end encrypted identity infrastructure with automated 18+ verification.
              </Text>
            </View>
          </View>

          <TouchableOpacity
            testID="start-verification-button"
            style={styles.primaryButton}
            onPress={handleStartVerification}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.primaryButtonText}>Verify with Passport / ID</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            testID="return-to-app-button"
            style={styles.cancelButton}
            onPress={() => router.replace('/(tabs)')}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelButtonText}>Return to App</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'LAUNCHING' && (
        <View style={styles.card}>
          <ActivityIndicator color={colors.gold} size="large" style={{ marginBottom: spacing.lg }} />
          <Text style={styles.statusTitle}>Opening Secure Verification</Text>
          <Text style={styles.statusBody}>
            Connecting to Persona's certified verification portal. Please have your passport or government ID ready...
          </Text>
        </View>
      )}

      {step === 'SUBMITTING' && (
        <View style={styles.card}>
          <ActivityIndicator color={colors.gold} size="large" style={{ marginBottom: spacing.lg }} />
          <Text style={styles.statusTitle}>Checking Verification Status</Text>
          <Text style={styles.statusBody}>
            Confirming your 18+ verification outcome with the server...
          </Text>
        </View>
      )}

      {step === 'VERIFIED' && (
        <View style={styles.card}>
          <Text style={[styles.icon, { textAlign: 'center', marginBottom: spacing.md }]}>✅</Text>
          <Text style={styles.statusTitle}>Age Assurance Complete</Text>
          <Text style={styles.statusBody}>
            Your adult 18+ membership is verified. Discovery matching and messaging are now fully unlocked.
          </Text>

          {/* Passport 7-Day Free Trial Status */}
          <View
            style={[
              styles.trialBanner,
              trialStatus?.requires_upgrade ? styles.trialBannerExpired : null,
            ]}
          >
            <Text style={[styles.trialBannerTitle, trialStatus?.requires_upgrade ? { color: colors.amber } : null]}>
              {trialStatus?.requires_upgrade
                ? '⚠️ 7-Day Free Trial Expired'
                : trialStatus?.has_started
                ? `✈️ 7-Day Passport Trial: ${trialStatus.days_remaining} ${trialStatus.days_remaining === 1 ? 'day' : 'days'} left`
                : '✈️ 7-Day Free Trial Included'}
            </Text>
            <Text style={styles.trialBannerBody}>
              {trialStatus?.requires_upgrade
                ? 'Your free trial for passport verification has ended. Aura Plus ($25/mo) or Aura Extra Premium is required to continue.'
                : trialStatus?.has_started
                ? 'Your 7-day passport verification trial is active. You have full access to passport verification.'
                : 'Verify your passport with Persona. Includes a 1-time 7-day free trial before requiring an active subscription.'}
            </Text>
            {trialStatus?.requires_upgrade ? (
              <TouchableOpacity
                testID="upgrade-membership-button"
                style={styles.upgradeTrialButton}
                onPress={() => router.push('/membership')}
                activeOpacity={0.8}
              >
                <Text style={styles.upgradeTrialButtonText}>Upgrade to Aura Plus ($25/mo)</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                testID="start-verification-button"
                style={[styles.primaryButton, { marginTop: spacing.sm, marginBottom: 0 }]}
                onPress={handleStartVerification}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {trialStatus?.has_started ? 'Continue Passport Verification' : 'Verify with Passport / ID'}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            testID="enter-aura-button"
            style={styles.primaryButton}
            onPress={() => router.replace('/(tabs)')}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Enter Aura</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'PENDING' && (
        <View style={styles.card}>
          <Text style={[styles.icon, { textAlign: 'center', marginBottom: spacing.md }]}>⏳</Text>
          <Text style={styles.statusTitle}>Verification Pending</Text>
          <Text style={styles.statusBody}>
            Your passport verification has been submitted to Persona and is being processed. It usually completes
            in less than a minute. Tap "Check Status" below once done.
          </Text>

          <TouchableOpacity
            testID="check-status-button"
            style={styles.primaryButton}
            onPress={handleCheckStatus}
            disabled={checkingStatus}
            activeOpacity={0.8}
          >
            {checkingStatus ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.primaryButtonText}>Check Status</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            testID="retry-verification-button"
            style={styles.secondaryButton}
            onPress={handleStartVerification}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text style={styles.secondaryButtonText}>Re-open Verification Flow</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="return-to-app-button"
            style={styles.cancelButton}
            onPress={() => router.replace('/(tabs)')}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelButtonText}>Return to App</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'REJECTED' && (
        <View style={styles.card}>
          <Text style={[styles.icon, { textAlign: 'center', marginBottom: spacing.md }]}>⚠️</Text>
          <Text style={[styles.statusTitle, { color: colors.amber }]}>Verification Unsuccessful</Text>
          <Text style={styles.statusBody}>
            Age assurance could not verify adult 18+ status from the submitted document. Please ensure your passport is
            valid, unexpired, and clearly visible without glare or cropped corners.
          </Text>

          <TouchableOpacity
            testID="retry-verification-button"
            style={styles.primaryButton}
            onPress={handleStartVerification}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Try Again with Passport</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="return-to-app-button"
            style={styles.cancelButton}
            onPress={() => router.replace('/(tabs)')}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelButtonText}>Return to App</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'FAILED' && (
        <View style={styles.card}>
          <Text style={[styles.icon, { textAlign: 'center', marginBottom: spacing.md }]}>❌</Text>
          <Text style={[styles.statusTitle, { color: '#FF4D4D' }]}>Verification Error</Text>
          <Text style={styles.statusBody}>
            {errorMessage || 'Could not complete verification. Please check your network connection and try again.'}
          </Text>

          <TouchableOpacity
            testID="retry-verification-button"
            style={styles.primaryButton}
            onPress={handleStartVerification}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Try Again</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="return-to-app-button"
            style={styles.cancelButton}
            onPress={() => router.replace('/(tabs)')}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelButtonText}>Return to App</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xl,
    paddingTop: spacing.xxxl,
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.gold,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  icon: {
    fontSize: 32,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.gold,
    letterSpacing: 1.5,
    marginTop: 4,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  cardBody: {
    ...typography.body,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  featureList: {
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  featureCheck: {
    color: colors.gold,
    fontWeight: '700',
    marginRight: spacing.sm,
    lineHeight: 18,
  },
  featureBold: {
    fontWeight: '700',
    color: colors.text,
  },
  featureText: {
    flex: 1,
    ...typography.bodySmall,
    color: colors.textMuted,
    lineHeight: 18,
  },
  primaryButton: {
    backgroundColor: colors.gold,
    height: 50,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  primaryButtonText: {
    ...typography.button,
    color: colors.textInverse,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    height: 44,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  secondaryButtonText: {
    ...typography.button,
    color: colors.textMuted,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  cancelButtonText: {
    ...typography.bodySmall,
    color: colors.textSubtle,
  },
  statusTitle: {
    ...typography.h2,
    color: colors.gold,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  statusBody: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  trialBanner: {
    backgroundColor: 'rgba(212, 175, 55, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  trialBannerExpired: {
    backgroundColor: 'rgba(255, 170, 0, 0.08)',
    borderColor: 'rgba(255, 170, 0, 0.4)',
  },
  trialBannerTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.gold,
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  trialBannerBody: {
    ...typography.bodySmall,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: spacing.xs,
  },
  upgradeTrialButton: {
    backgroundColor: colors.gold,
    height: 38,
    borderRadius: borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  upgradeTrialButtonText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textInverse,
  },
});
