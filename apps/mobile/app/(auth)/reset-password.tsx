import React, { useState, useEffect } from 'react';
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
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { colors, typography, spacing, borderRadius } from '../../src/theme';
import { authService } from '../../src/services/auth/authService';
import { ApiError } from '../../src/services/api/client';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();

  const [token, setToken] = useState(params.token || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (params.token) {
      setToken(params.token);
    }
  }, [params.token]);

  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (!url) return;
      try {
        const parsed = Linking.parse(url);
        if (parsed.queryParams && typeof parsed.queryParams.token === 'string') {
          setToken(parsed.queryParams.token);
        }
      } catch {
        // Ignore deep link parsing error
      }
    };

    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', (event) => handleUrl(event.url));
    return () => sub.remove();
  }, []);

  // Validation rules aligning with Go backend ValidatePasswordPolicy
  const hasMinLength = password.length >= 8 && password.length <= 128;
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const isValidPolicy = hasMinLength && hasDigit && hasSpecial;

  const handleResetPassword = async () => {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      Alert.alert('Reset Token Required', 'Please enter your password reset token or recovery code.');
      return;
    }

    if (!isValidPolicy) {
      Alert.alert(
        'Password Policy Requirements',
        'Your password must be at least 8 characters long, contain at least one digit (0-9), and contain at least one special character.'
      );
      return;
    }

    if (!passwordsMatch) {
      Alert.alert('Passwords Do Not Match', 'Please ensure both password fields are identical.');
      return;
    }

    setLoading(true);
    try {
      await authService.confirmPasswordReset(trimmedToken, password);
      setSuccess(true);
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : 'Could not update password. The link or token may be expired or already used.';
      Alert.alert('Reset Failed', msg);
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
          <Text style={styles.brandSubtitle}>Secure Password Update</Text>
        </View>

        {/* Form Card or Success State */}
        <View style={styles.formCard}>
          {success ? (
            <View style={styles.successContainer}>
              <View style={styles.successIconBadge}>
                <Text style={styles.successIconText}>✓</Text>
              </View>
              <Text style={styles.formTitle}>Password Updated</Text>
              <Text style={styles.successDescription}>
                Your password has been changed securely and all previous sessions have been invalidated.
                Please sign in with your new password.
              </Text>

              <TouchableOpacity
                style={styles.submitBtn}
                onPress={() => router.replace('/(auth)/login')}
                activeOpacity={0.8}
                testID="sign-in-after-reset-button"
              >
                <Text style={styles.submitBtnText}>Sign In to Aura</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.formTitle}>Set New Password</Text>
              <Text style={styles.formDescription}>
                Enter the recovery token received in your email and choose a strong, secure new password.
              </Text>

              {/* Reset Token Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Recovery Token / Code</Text>
                <TextInput
                  style={styles.input}
                  value={token}
                  onChangeText={setToken}
                  placeholder="Paste reset token from email"
                  placeholderTextColor={colors.textSubtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="reset-token-input"
                />
              </View>

              {/* New Password Input */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.inputLabel}>New Password</Text>
                  <TouchableOpacity onPress={() => setShowPassword((prev) => !prev)}>
                    <Text style={styles.toggleText}>{showPassword ? 'Hide' : 'Show'}</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••••••"
                  placeholderTextColor={colors.textSubtle}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  testID="new-password-input"
                />
              </View>

              {/* Confirm Password Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Confirm New Password</Text>
                <TextInput
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="••••••••••••"
                  placeholderTextColor={colors.textSubtle}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  testID="confirm-password-input"
                />
              </View>

              {/* Password Policy Checklist */}
              <View style={styles.checklistContainer}>
                <Text style={styles.checklistTitle}>Password Requirements:</Text>
                <View style={styles.checklistItem}>
                  <Text style={hasMinLength ? styles.checkValid : styles.checkInvalid}>
                    {hasMinLength ? '✓' : '○'}
                  </Text>
                  <Text style={hasMinLength ? styles.checkTextValid : styles.checkText}>
                    At least 8 characters
                  </Text>
                </View>
                <View style={styles.checklistItem}>
                  <Text style={hasDigit ? styles.checkValid : styles.checkInvalid}>
                    {hasDigit ? '✓' : '○'}
                  </Text>
                  <Text style={hasDigit ? styles.checkTextValid : styles.checkText}>
                    At least one numeric digit (0-9)
                  </Text>
                </View>
                <View style={styles.checklistItem}>
                  <Text style={hasSpecial ? styles.checkValid : styles.checkInvalid}>
                    {hasSpecial ? '✓' : '○'}
                  </Text>
                  <Text style={hasSpecial ? styles.checkTextValid : styles.checkText}>
                    At least one special character (!, @, #, $, _)
                  </Text>
                </View>
                {confirmPassword.length > 0 && (
                  <View style={styles.checklistItem}>
                    <Text style={passwordsMatch ? styles.checkValid : styles.checkInvalid}>
                      {passwordsMatch ? '✓' : '○'}
                    </Text>
                    <Text style={passwordsMatch ? styles.checkTextValid : styles.checkText}>
                      Passwords match
                    </Text>
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={[styles.submitBtn, !isValidPolicy && styles.submitBtnDisabled]}
                onPress={handleResetPassword}
                disabled={loading || !isValidPolicy}
                activeOpacity={0.8}
                testID="update-password-button"
              >
                {loading ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <Text style={styles.submitBtnText}>Update Password</Text>
                )}
              </TouchableOpacity>

              <View style={styles.footerRow}>
                <TouchableOpacity onPress={() => router.replace('/(auth)/login')} activeOpacity={0.7}>
                  <Text style={styles.cancelLink}>Cancel and Return to Sign In</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {/* Security Footer */}
        <View style={styles.securityBox}>
          <Text style={styles.securityText}>
            🔒 Cryptographic Argon2id Password Hashing & Instant Session Revocation
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
    marginBottom: spacing.md,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  toggleText: {
    ...typography.caption,
    color: colors.gold,
    fontWeight: '600',
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
  checklistContainer: {
    backgroundColor: colors.backgroundElevated,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  checklistTitle: {
    ...typography.caption,
    color: colors.textSubtle,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2,
  },
  checkValid: {
    color: '#4ade80',
    fontSize: 14,
    fontWeight: '700',
    width: 18,
  },
  checkInvalid: {
    color: colors.textSubtle,
    fontSize: 14,
    width: 18,
  },
  checkText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  checkTextValid: {
    ...typography.caption,
    color: '#4ade80',
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
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    ...typography.button,
    color: colors.textInverse,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  cancelLink: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
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
    borderColor: '#4ade80',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  successIconText: {
    fontSize: 28,
    color: '#4ade80',
    fontWeight: '700',
  },
  successDescription: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginVertical: spacing.md,
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
