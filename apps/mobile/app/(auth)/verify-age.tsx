import React, { useState } from 'react';
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
import { colors, typography, spacing, borderRadius } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';
import { mediaUploader } from '../../src/services/media/mediaUploader';
import { authService } from '../../src/services/auth/authService';

export default function VerifyAgeScreen() {
  const router = useRouter();
  const { refreshProfile, isAgeVerified } = useAuth();

  const [step, setStep] = useState<'INFO' | 'CAPTURING' | 'SUBMITTING' | 'PENDING' | 'VERIFIED'>('INFO');
  const [loading, setLoading] = useState(false);

  const handleStartCapture = async () => {
    try {
      setLoading(true);
      const photo = await mediaUploader.capturePhoto();
      if (!photo) {
        setLoading(false);
        return;
      }

      setStep('SUBMITTING');
      // Strip EXIF and upload verification selfie with dedicated SELFIE_VERIFICATION purpose
      // This guarantees the selfie is isolated and never appears in public profile galleries
      await mediaUploader.uploadVerificationSelfie(photo.uri);

      // Trigger authoritative age assurance session on backend
      await authService.startAgeAssuranceSession();

      // Check authoritative status from backend
      const statusRes = await authService.getAgeAssuranceStatus();
      if (statusRes && statusRes.status === 'VERIFIED') {
        await refreshProfile();
        setStep('VERIFIED');
      } else if (statusRes && statusRes.status === 'REJECTED') {
        Alert.alert(
          'Verification Unsuccessful',
          'Age assurance could not verify adult status from the submitted photo. Please try again with clear lighting or contact support.'
        );
        setStep('INFO');
      } else {
        // PENDING or MANUAL_REVIEW
        await refreshProfile();
        setStep('PENDING');
      }
    } catch (err) {
      if (__DEV__) {
        console.error('[AgeVerification] Failed:', {
          errorName: err instanceof Error ? err.name : 'UnknownError',
          errorMessage: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
      Alert.alert('Verification Failed', err instanceof Error ? err.message : 'Could not process verification photo.');
      setStep('INFO');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckStatus = async () => {
    try {
      setLoading(true);
      const statusRes = await authService.getAgeAssuranceStatus();
      if (statusRes && statusRes.status === 'VERIFIED') {
        await refreshProfile();
        setStep('VERIFIED');
      } else if (statusRes && statusRes.status === 'REJECTED') {
        Alert.alert(
          'Verification Unsuccessful',
          'Age assurance could not verify adult status. Please submit a new selfie with clear lighting.'
        );
        setStep('INFO');
      } else {
        Alert.alert('Status: Pending', 'Your verification is still under review. Please check back shortly.');
      }
    } catch {
      Alert.alert('Status Check Failed', 'Could not reach verification service. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>🛡️</Text>
        </View>
        <Text style={styles.title}>18+ Age Assurance</Text>
        <Text style={styles.subtitle}>Protecting Community Safety</Text>
      </View>

      {step === 'INFO' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Why Verification is Required</Text>
          <Text style={styles.cardBody}>
            Aura is an exclusive platform dedicated to adult LGBTQ+ connections. To maintain a safe, trusted, and
            legally compliant space, every member must complete an automated age assurance check before discovery
            swiping and chat are unlocked.
          </Text>

          <View style={styles.featureList}>
            <View style={styles.featureItem}>
              <Text style={styles.featureCheck}>✓</Text>
              <Text style={styles.featureText}>Strictly private — verification photos are never shown publicly.</Text>
            </View>
            <View style={styles.featureItem}>
              <Text style={styles.featureCheck}>✓</Text>
              <Text style={styles.featureText}>All GPS and EXIF metadata are stripped client-side before upload.</Text>
            </View>
            <View style={styles.featureItem}>
              <Text style={styles.featureCheck}>✓</Text>
              <Text style={styles.featureText}>Zero third-party biometric data sharing or marketing re-use.</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleStartCapture}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.primaryButtonText}>Capture Verification Selfie</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={() => router.replace('/(tabs)')} activeOpacity={0.7}>
            <Text style={styles.cancelButtonText}>Return to App</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'SUBMITTING' && (
        <View style={styles.card}>
          <ActivityIndicator color={colors.gold} size="large" style={{ marginBottom: spacing.lg }} />
          <Text style={styles.statusTitle}>Analyzing Verification Asset</Text>
          <Text style={styles.statusBody}>
            Stripping EXIF location data, scanning for adult age markers, and validating authenticity...
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

          <TouchableOpacity
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
            Your verification has been submitted. Our automated system and safety team will review your submission.
            Once verified, all dating features will unlock immediately.
          </Text>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleCheckStatus}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.primaryButtonText}>Check Status</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
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
});
