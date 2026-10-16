import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { colors, typography, spacing, borderRadius } from '../../src/theme';
import { authService } from '../../src/services/auth/authService';
import { ApiError } from '../../src/services/api/client';

export default function ForgotPasswordScreen() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');

  const handleRequestReset = async () => {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) {
      Alert.alert('Valid Email Required', 'Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      await authService.requestPasswordReset(trimmed);
      setSubmittedEmail(trimmed);
      setSubmitted(true);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'RATE_LIMIT_EXCEEDED') {
        Alert.alert(
          'Rate Limit Exceeded',
          'Please wait a few moments before requesting another password recovery link.'
        );
      } else {
        // Defend against user enumeration by always treating response cleanly
        setSubmittedEmail(trimmed);
        setSubmitted(true);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Brand Header */}
        <View style={styles.header}>
          <View style={styles.monogramBadge}>
            <Text style={styles.monogramText}>A</Text>
          </View>
          <Text style={styles.brandTitle}>AURA</Text>
          <Text style={styles.brandSubtitle}>Account Recovery</Text>
        </View>

        {/* Form or Submitted State */}
        <View style={styles.formCard}>
          {submitted ? (
            <View style={styles.successContainer}>
              <View style={styles.successIconBadge}>
                <Text style={styles.successIconText}>✉️</Text>
              </View>
              <Text style={styles.formTitle}>Check Your Email</Text>
              <Text style={styles.successDescription}>
                If an Aura account exists for{' '}
                <Text style={styles.emailHighlight}>{submittedEmail}</Text>, you will receive
                secure password reset instructions shortly.
              </Text>
              <Text style={styles.expiryNote}>
                Reset links are single-use and expire within 1 hour.
              </Text>

              <TouchableOpacity
                style={styles.submitBtn}
                onPress={() => router.push('/(auth)/reset-password' as any)}
                activeOpacity={0.8}
                testID="enter-token-button"
              >
                <Text style={styles.submitBtnText}>I Have a Reset Token</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => router.replace('/(auth)/login')}
                activeOpacity={0.7}
              >
                <Text style={styles.secondaryBtnText}>Return to Sign In</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.formTitle}>Forgot Password</Text>
              <Text style={styles.formDescription}>
                Enter your registered email address and we will dispatch a secure recovery link to
                reset your password.
              </Text>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email Address</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="name@example.com"
                  placeholderTextColor={colors.textSubtle}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="forgot-password-email-input"
                />
              </View>

              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleRequestReset}
                disabled={loading}
                activeOpacity={0.8}
                testID="send-recovery-link-button"
              >
                {loading ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <Text style={styles.submitBtnText}>Send Recovery Link</Text>
                )}
              </TouchableOpacity>

              <View style={styles.footerRow}>
                <Text style={styles.footerText}>Remembered your password?</Text>
                <TouchableOpacity onPress={() => router.replace('/(auth)/login')} activeOpacity={0.7}>
                  <Text style={styles.loginLink}> Sign In</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {/* Security Assurance Footer */}
        <View style={styles.securityBox}>
          <Text style={styles.securityText}>
            🔒 Anti-Enumeration Defense & TLS Encrypted Transport
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  monogramBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1.5,
    borderColor: colors.gold,
    backgroundColor: colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  monogramText: {
    ...typography.h2,
    color: colors.gold,
    fontWeight: '700',
  },
  brandTitle: {
    ...typography.h2,
    color: colors.text,
    letterSpacing: 4,
    marginBottom: spacing.xs,
  },
  brandSubtitle: {
    ...typography.caption,
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  formCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  formDescription: {
    ...typography.bodySmall,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  inputGroup: {
    marginBottom: spacing.lg,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  input: {
    height: 48,
    backgroundColor: colors.backgroundElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    color: colors.text,
    ...typography.body,
  },
  submitBtn: {
    backgroundColor: colors.gold,
    height: 50,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  submitBtnText: {
    ...typography.button,
    color: colors.textInverse,
  },
  secondaryBtn: {
    height: 48,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  secondaryBtnText: {
    ...typography.button,
    color: colors.textMuted,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  footerText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  loginLink: {
    ...typography.bodySmall,
    color: colors.gold,
    fontWeight: '700',
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  successIconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.gold,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  successIconText: {
    fontSize: 28,
  },
  successDescription: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginVertical: spacing.md,
  },
  emailHighlight: {
    color: colors.gold,
    fontWeight: '600',
  },
  expiryNote: {
    ...typography.caption,
    color: colors.textSubtle,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  securityBox: {
    marginTop: spacing.xxl,
    alignItems: 'center',
  },
  securityText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textSubtle,
    letterSpacing: 0.5,
  },
});
