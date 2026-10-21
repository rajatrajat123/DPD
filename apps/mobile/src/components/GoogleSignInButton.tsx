import React, { useCallback, useEffect, useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  Alert,
} from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '../context/AuthContext';
import { colors, typography, spacing, borderRadius } from '../theme';
import { ApiError } from '../services/api/client';

// Required so the browser redirect from the Google consent screen is completed
// and the authentication result is handed back to the app.
WebBrowser.maybeCompleteAuthSession();

/**
 * Google OAuth client IDs for the Aura Google Cloud project.
 *
 * These are injected at build time through EXPO_PUBLIC_* variables (see
 * `.env.example`). The same client IDs must be listed on the backend in
 * GOOGLE_OAUTH_AUDIENCES so that the returned ID token audience is accepted.
 */
export const googleWebClientId = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '').trim();
export const googleIosClientId = (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '').trim();
export const googleAndroidClientId = (process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '').trim();

/**
 * Google Sign-In can only run when at least one OAuth client ID is configured.
 * Without configuration the button fails with a clear message instead of
 * fabricating a local identity.
 */
export const isGoogleSignInConfigured = (): boolean =>
  Boolean(googleWebClientId || googleIosClientId || googleAndroidClientId);

interface GoogleSignInButtonProps {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  isRegister?: boolean;
  disabled?: boolean;
}

export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  onSuccess,
  onError,
  isRegister = false,
  disabled = false,
}) => {
  const { loginWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);
  const configured = isGoogleSignInConfigured();

  // Uses the official Expo Google provider (expo-auth-session) to run Google's
  // real OpenID Connect flow and return a genuine Google-issued ID token.
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: googleWebClientId || undefined,
    iosClientId: googleIosClientId || undefined,
    androidClientId: googleAndroidClientId || undefined,
    scopes: ['openid', 'email', 'profile'],
  });

  const notifyError = useCallback(
    (err: unknown) => {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Google authentication could not be completed.';
      Alert.alert('Google Sign-In', message);
      onError?.(err instanceof Error ? err : new Error(message));
    },
    [onError]
  );

  useEffect(() => {
    if (!response) return;

    if (response.type === 'success') {
      const idToken = response.params?.id_token;
      if (!idToken) {
        notifyError(new Error('Google did not return an ID token for this request.'));
        setLoading(false);
        return;
      }

      const complete = async () => {
        try {
          // Only the verified ID token is sent. The backend resolves the Google
          // identity, creates or finds the Aura account, and issues real Aura
          // access + refresh sessions. Profile details are never invented here.
          await loginWithGoogle({ id_token: idToken });
          onSuccess?.();
        } catch (err) {
          notifyError(err);
        } finally {
          setLoading(false);
        }
      };
      void complete();
      return;
    }

    if (response.type === 'error') {
      notifyError(new Error(response.error?.message || 'Google sign-in failed.'));
    }
    setLoading(false);
  }, [response, loginWithGoogle, notifyError, onSuccess]);

  const handleGoogleSignIn = async () => {
    if (loading || disabled) return;

    if (!configured) {
      notifyError(
        new Error(
          'Google Sign-In is not configured for this build. Set the EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID or EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID environment variables.'
        )
      );
      return;
    }

    if (!request) return;

    setLoading(true);
    try {
      await promptAsync();
    } catch (err) {
      notifyError(err);
      setLoading(false);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.button, disabled && styles.disabled]}
      onPress={handleGoogleSignIn}
      disabled={loading || disabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      testID="google-sign-in-btn"
    >
      {loading ? (
        <ActivityIndicator color={colors.text} size="small" />
      ) : (
        <View style={styles.content}>
          <View style={styles.googleIconContainer}>
            <Text style={styles.googleIcon}>G</Text>
          </View>
          <Text style={styles.buttonText}>
            {isRegister ? 'Sign Up with Google' : 'Continue with Google'}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    height: 50,
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#DADCE0',
    paddingHorizontal: spacing.md,
    marginVertical: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  disabled: {
    opacity: 0.6,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIconContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#4285F4',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  googleIcon: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
    textAlign: 'center',
  },
  buttonText: {
    ...typography.button,
    color: '#3C4043',
    fontWeight: '600',
    fontSize: 15,
    letterSpacing: 0.25,
  },
});
