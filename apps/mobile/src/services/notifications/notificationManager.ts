import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { api } from '../api/client';
import { NotificationPreferences } from '../../types';

/**
 * Detect whether the app is executing inside the standard Expo Go client app.
 * In Expo Go SDK 53+, remote push notification native services were removed,
 * and importing `expo-notifications` at top level throws an uncaught error on Android.
 */
export const isExpoGo =
  Boolean(Constants?.appOwnership === 'expo' ||
  Constants?.executionEnvironment === ExecutionEnvironment.StoreClient);

/**
 * Dynamically and safely access expo-notifications only in native standalone / dev builds.
 * In Expo Go or Web, returns null to avoid triggering Expo Go's top-level push usage throw.
 */
function getExpoNotifications(): any {
  if (isExpoGo || Platform.OS === 'web') {
    return null;
  }
  try {
    return require('expo-notifications');
  } catch {
    return null;
  }
}

// Configure foreground notification behavior safely when supported
try {
  const Notifications = getExpoNotifications();
  if (Notifications && typeof Notifications.setNotificationHandler === 'function') {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  }
} catch {
  // Gracefully ignored in environments where native notification handlers are unavailable
}

export const notificationManager = {
  /**
   * Whether native remote push notifications are supported in the current environment.
   * Returns false in Expo Go (which lacks native APNs/FCM push credentials) and Web.
   */
  isRemotePushSupported(): boolean {
    return Platform.OS !== 'web' && !isExpoGo;
  },

  /**
   * Request push notification permissions from user.
   * In Expo Go, skips requesting unsupported native push permissions.
   */
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'web' || isExpoGo) return false;

    const Notifications = getExpoNotifications();
    if (!Notifications) return false;

    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
          },
        });
        finalStatus = status;
      }

      return finalStatus === 'granted';
    } catch {
      return false;
    }
  },

  /**
   * Registers native APNs or FCM push token with Go backend.
   * In Expo Go, cleanly informs the caller that a native development build is required,
   * without calling deprecated/unsupported native APIs or throwing.
   */
  async registerPushToken(): Promise<{ registered: boolean; token?: string; reason?: string }> {
    if (Platform.OS === 'web') {
      return { registered: false, reason: 'Push notifications are not supported on web.' };
    }

    if (isExpoGo) {
      return {
        registered: false,
        reason:
          'Remote push notifications require a native development build (expo-dev-client). Expo Go does not support remote APNs/FCM tokens.',
      };
    }

    const Notifications = getExpoNotifications();
    if (!Notifications) {
      return {
        registered: false,
        reason: 'Notification service is not available in this build.',
      };
    }

    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      return { registered: false, reason: 'Notification permissions were denied.' };
    }

    try {
      // Get native device push token (APNs on iOS, FCM on Android)
      const tokenData = await Notifications.getDevicePushTokenAsync();
      const provider = Platform.OS === 'ios' ? 'APNS' : 'FCM';

      await api.post('/api/v1/notifications/push-token', {
        token: tokenData.data,
        provider,
      });

      return { registered: true, token: tokenData.data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown registration error';
      return { registered: false, reason: msg };
    }
  },

  /**
   * Fetch member notification preferences from backend
   */
  async getPreferences(): Promise<NotificationPreferences> {
    return api.get<NotificationPreferences>('/api/v1/notifications/preferences');
  },

  /**
   * Update member notification preferences on backend
   */
  async updatePreferences(prefs: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    return api.put<NotificationPreferences>('/api/v1/notifications/preferences', prefs);
  },

  /**
   * Filters notification payload for privacy if hide_sensitive_preview is active
   */
  sanitizeNotificationForPrivacy(title: string, body: string, hideSensitive: boolean): { title: string; body: string } {
    if (!hideSensitive) {
      return { title, body };
    }
    return {
      title: 'Aura',
      body: 'You have a new private notification',
    };
  },
};
