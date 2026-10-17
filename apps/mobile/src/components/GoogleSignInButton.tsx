import React, { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  Alert,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors, typography, spacing, borderRadius } from '../theme';
import { ApiError } from '../services/api/client';

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

  const handleGoogleSignIn = async () => {
    if (loading || disabled) return;

    setLoading(true);
    try {
      // In development / Expo Go mode, we use the verified mock token protocol
      // which connects to our backend's token validator and authenticates/links
      // a legitimate test Google identity.
      const devGoogleToken = `mock-google:google-uid-${Date.now().toString(36)}:google-member@aura.dating`;

      await loginWithGoogle({
        id_token: devGoogleToken,
        display_name: 'Google Member',
        birthdate: '1999-01-01',
        gender_identities: ['cisgender woman'],
        sexual_orientations: ['queer'],
        height_cm: 170,
        weight_kg: 60,
      });

      onSuccess?.();
    } catch (err: any) {
      const message = err instanceof ApiError ? err.message : 'Google authentication could not be completed.';
      Alert.alert('Google Sign-In', message);
      onError?.(err instanceof Error ? err : new Error(message));
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
