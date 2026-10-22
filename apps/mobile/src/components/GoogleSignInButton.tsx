import React, { useCallback, useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  Alert,
  Platform,
} from 'react-native';
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { useAuth } from '../context/AuthContext';
import { colors, typography, spacing, borderRadius } from '../theme';
import { ApiError } from '../services/api/client';

/**
 * Google OAuth client IDs for the Aura Google Cloud project.
 *
 * These are injected at build time through EXPO_PUBLIC_* variables (see
 * `.env.example`). The same client IDs must be listed on the backend in
 * GOOGLE_OAUTH_AUDIENCES so that the returned ID token audience is accepted.
 *
 * `googleWebClientId` is the "server" (Web application) client ID. Google's
 * native Sign-In SDK requires it to return an ID token, so it is the value
 * handed to `GoogleSignin.configure({ webClientId })`.
 *
 * `googleAndroidClientId` is NOT passed to the SDK: Android OAuth clients are
 * bound to the Android package name plus the signing SHA-1 fingerprint in the
 * Cloud Console, and the native SDK matches them automatically. It is kept
 * exported as the reference value that must be registered there and listed in
 * the backend's GOOGLE_OAUTH_AUDIENCES.
 */
export const googleWebClientId = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '').trim();
export const googleIosClientId = (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '').trim();
export const googleAndroidClientId = (process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '').trim();

/**
 * Google Sign-In can only run when the client ID that this platform needs is
 * configured. Android cannot produce an ID token without the Web client ID;
 * iOS can use either its own client ID or the Web client ID. Without
 * configuration the button fails with a clear message instead of fabricating a
 * local identity.
 */
export const isGoogleSignInConfigured = (): boolean =>
  Platform.OS === 'ios'
    ? Boolean(googleIosClientId || googleWebClientId)
    : Boolean(googleWebClientId);

/**
 * Signs out the active user from Google Play Services on this device.
 *
 * This clears the cached Google account session for the Aura app without
 * revoking OAuth permissions or removing the Google account from the phone.
 * The next "Continue with Google" attempt will present the account chooser dialog.
 */
export async function signOutGoogle(): Promise<void> {
  try {
    if (Platform.OS !== 'web' && isGoogleSignInConfigured()) {
      GoogleSignin.configure({
        webClientId: googleWebClientId || undefined,
        iosClientId: googleIosClientId || undefined,
        scopes: ['openid', 'email', 'profile'],
      });
      await GoogleSignin.signOut();
    }
  } catch {
    // If not signed in with Google or native module is not initialized, ignore gracefully
  }
}

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

  const handleGoogleSignIn = async () => {
    if (loading || disabled) return;

    if (!configured) {
      notifyError(
        new Error(
          'Google Sign-In is not configured for this build. Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (and EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID for iOS) environment variables.'
        )
      );
      return;
    }

    setLoading(true);
    try {
      // Configured lazily so importing this module never touches native code.
      // Google's own SDK performs the real sign-in and issues the ID token; no
      // identity is ever constructed here.
      GoogleSignin.configure({
        webClientId: googleWebClientId || undefined,
        iosClientId: googleIosClientId || undefined,
        scopes: ['openid', 'email', 'profile'],
      });

      // Android only (always resolves true on iOS); prompts the user to update
      // Google Play Services when required.
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      // Clear any cached local Google session before opening the account picker
      // so the native account chooser is always displayed to allow account selection.
      try {
        await GoogleSignin.signOut();
      } catch {
        // Safe to ignore if not previously signed in
      }

      const response = await GoogleSignin.signIn();

      if (!isSuccessResponse(response)) {
        // The user dismissed the Google account picker; nothing was authenticated.
        return;
      }

      const idToken = response.data.idToken;
      if (!idToken) {
        notifyError(new Error('Google did not return an ID token for this request.'));
        return;
      }

      // Only the Google-issued ID token is sent. The backend verifies its
      // signature, issuer, audience and expiry, then resolves the Google
      // identity and issues real Aura access + refresh sessions. Profile
      // details are never invented here.
      await loginWithGoogle({ id_token: idToken });
      onSuccess?.();
    } catch (err) {
      if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) {
        // Cancellation is a normal outcome, not an authentication failure.
        return;
      }
      notifyError(err);
    } finally {
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
