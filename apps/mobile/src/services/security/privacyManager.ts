import * as ScreenCapture from 'expo-screen-capture';
import * as LocalAuthentication from 'expo-local-authentication';
import { Platform, AppState, AppStateStatus } from 'react-native';
import { secureStorage } from '../storage/secureStore';

export interface BiometricStatus {
  isAvailable: boolean;
  isEnrolled: boolean;
  biometricType: 'FACE_ID' | 'FINGERPRINT' | 'IRIS' | 'NONE';
}

export const privacyManager = {
  /**
   * Prevents screenshots and screen recording on sensitive screens (Android FLAG_SECURE)
   */
  async enableScreenCaptureProtection(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    try {
      await ScreenCapture.preventScreenCaptureAsync('aura_screen_guard');
      return true;
    } catch (err) {
      console.warn('Failed to enable screen capture protection:', err);
      return false;
    }
  },

  /**
   * Disables screenshot prevention
   */
  async disableScreenCaptureProtection(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    try {
      await ScreenCapture.allowScreenCaptureAsync('aura_screen_guard');
      return true;
    } catch (err) {
      console.warn('Failed to disable screen capture protection:', err);
      return false;
    }
  },

  /**
   * Queries device biometric hardware availability
   */
  async getBiometricStatus(): Promise<BiometricStatus> {
    if (Platform.OS === 'web') {
      return { isAvailable: false, isEnrolled: false, biometricType: 'NONE' };
    }
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

      let biometricType: 'FACE_ID' | 'FINGERPRINT' | 'IRIS' | 'NONE' = 'NONE';
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        biometricType = 'FACE_ID';
      } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        biometricType = 'FINGERPRINT';
      } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
        biometricType = 'IRIS';
      }

      return {
        isAvailable: hasHardware,
        isEnrolled,
        biometricType,
      };
    } catch {
      return { isAvailable: false, isEnrolled: false, biometricType: 'NONE' };
    }
  },

  /**
   * Prompts user with native biometric dialog (FaceID / Fingerprint)
   */
  async authenticateBiometric(promptMessage = 'Unlock Aura to protect your privacy'): Promise<boolean> {
    if (Platform.OS === 'web') return true;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage,
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      return result.success;
    } catch (err) {
      console.warn('Biometric authentication failed:', err);
      return false;
    }
  },

  /**
   * Checks whether the user has toggled biometric app lock on in settings
   */
  async isBiometricLockEnabled(): Promise<boolean> {
    return secureStorage.isBiometricEnabled();
  },

  /**
   * Subscribes to AppState changes to trigger privacy veil when app goes to background
   */
  subscribeToAppState(onBackground: (isBackground: boolean) => void): () => void {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      const isHidden = nextAppState === 'inactive' || nextAppState === 'background';
      onBackground(isHidden);
    });

    return () => {
      subscription.remove();
    };
  },
};
