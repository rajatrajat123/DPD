import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService, LoginPayload, RegisterPayload } from '../services/auth/authService';
import { secureStorage } from '../services/storage/secureStore';
import { privacyManager } from '../services/security/privacyManager';
import { chatWebSocket } from '../services/chat/chatService';
import { User, Profile } from '../types';

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAgeVerified: boolean;
  biometricLocked: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  unlockBiometric: () => Promise<boolean>;
  setBiometricLock: (enabled: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [biometricLocked, setBiometricLocked] = useState<boolean>(false);

  const refreshProfile = useCallback(async () => {
    try {
      const res = await authService.getMyProfile();
      setUser(res.user);
      setProfile(res.profile);
    } catch {
      // Session may be invalid
    }
  }, []);

  const initAuth = useCallback(async () => {
    try {
      const token = await secureStorage.getAccessToken();
      if (token) {
        // Check biometric lock setting
        const hasBiometric = await privacyManager.isBiometricLockEnabled();
        if (hasBiometric) {
          setBiometricLocked(true);
        }

        await refreshProfile();
        chatWebSocket.connect();
      }
    } catch {
      await secureStorage.clearTokens();
    } finally {
      setIsLoading(false);
    }
  }, [refreshProfile]);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // AppState subscription: If biometric lock is enabled, lock when returning from background
  useEffect(() => {
    const unsubscribe = privacyManager.subscribeToAppState(async (isBackground) => {
      if (!isBackground) {
        const isBioEnabled = await privacyManager.isBiometricLockEnabled();
        const hasToken = await secureStorage.getAccessToken();
        if (isBioEnabled && hasToken) {
          setBiometricLocked(true);
        }
      }
    });
    return unsubscribe;
  }, []);

  const login = async (payload: LoginPayload) => {
    setIsLoading(true);
    try {
      const res = await authService.login(payload);
      setUser(res.user);
      if (res.profile) setProfile(res.profile);
      chatWebSocket.connect();
      await refreshProfile();
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (payload: RegisterPayload) => {
    setIsLoading(true);
    try {
      const res = await authService.register(payload);
      setUser(res.user);
      if (res.profile) setProfile(res.profile);
      chatWebSocket.connect();
      await refreshProfile();
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await authService.logout();
      setUser(null);
      setProfile(null);
      setBiometricLocked(false);
    } finally {
      setIsLoading(false);
    }
  };

  const unlockBiometric = async (): Promise<boolean> => {
    const success = await privacyManager.authenticateBiometric('Unlock Aura');
    if (success) {
      setBiometricLocked(false);
    }
    return success;
  };

  const setBiometricLock = async (enabled: boolean) => {
    await secureStorage.setBiometricEnabled(enabled);
  };

  const isAgeVerified = Boolean(user?.is_age_verified || profile?.is_age_verified);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        isAuthenticated: Boolean(user),
        isLoading,
        isAgeVerified,
        biometricLocked,
        login,
        register,
        logout,
        refreshProfile,
        unlockBiometric,
        setBiometricLock,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
