import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEYS = {
  ACCESS_TOKEN: 'aura_access_token',
  REFRESH_TOKEN: 'aura_refresh_token',
  USER_DATA: 'aura_user_data',
  BIOMETRIC_ENABLED: 'aura_biometric_enabled',
} as const;

// In-memory fallback for test runners or environments where native keychain is unavailable
const memoryFallback = new Map<string, string>();

async function isSecureStoreAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

export const secureStorage = {
  async setItem(key: string, value: string): Promise<void> {
    try {
      const available = await isSecureStoreAvailable();
      if (available) {
        await SecureStore.setItemAsync(key, value, {
          keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
        });
        return;
      }
    } catch (err) {
      // Fall through to memory fallback on test runner
    }
    memoryFallback.set(key, value);
  },

  async getItem(key: string): Promise<string | null> {
    try {
      const available = await isSecureStoreAvailable();
      if (available) {
        return await SecureStore.getItemAsync(key);
      }
    } catch (err) {
      // Fall through to memory fallback
    }
    return memoryFallback.get(key) ?? null;
  },

  async deleteItem(key: string): Promise<void> {
    try {
      const available = await isSecureStoreAvailable();
      if (available) {
        await SecureStore.deleteItemAsync(key);
      }
    } catch (err) {
      // Fall through
    }
    memoryFallback.delete(key);
  },

  // Specialized helpers for authentication credentials
  async saveTokens(accessToken: string, refreshToken: string): Promise<void> {
    await this.setItem(KEYS.ACCESS_TOKEN, accessToken);
    await this.setItem(KEYS.REFRESH_TOKEN, refreshToken);
  },

  async getAccessToken(): Promise<string | null> {
    return await this.getItem(KEYS.ACCESS_TOKEN);
  },

  async getRefreshToken(): Promise<string | null> {
    return await this.getItem(KEYS.REFRESH_TOKEN);
  },

  async clearTokens(): Promise<void> {
    await this.deleteItem(KEYS.ACCESS_TOKEN);
    await this.deleteItem(KEYS.REFRESH_TOKEN);
    await this.deleteItem(KEYS.USER_DATA);
  },

  async setBiometricEnabled(enabled: boolean): Promise<void> {
    await this.setItem(KEYS.BIOMETRIC_ENABLED, enabled ? 'true' : 'false');
  },

  async isBiometricEnabled(): Promise<boolean> {
    const val = await this.getItem(KEYS.BIOMETRIC_ENABLED);
    return val === 'true';
  },

  async saveUserData(data: Record<string, unknown>): Promise<void> {
    await this.setItem(KEYS.USER_DATA, JSON.stringify(data));
  },

  async getUserData<T = Record<string, unknown>>(): Promise<T | null> {
    const val = await this.getItem(KEYS.USER_DATA);
    if (!val) return null;
    try {
      return JSON.parse(val) as T;
    } catch {
      return null;
    }
  },
};
