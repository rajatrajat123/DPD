import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService, LoginPayload, RegisterPayload, GoogleAuthPayload } from '../services/auth/authService';
import { secureStorage } from '../services/storage/secureStore';
import { privacyManager } from '../services/security/privacyManager';
import { chatWebSocket, chatService } from '../services/chat/chatService';
import { User, Profile } from '../types';

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAgeVerified: boolean;
  biometricLocked: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  loginWithGoogle: (payload: GoogleAuthPayload) => Promise<void>;
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
  const [isAgeVerified, setIsAgeVerified] = useState<boolean>(false);

  const refreshProfile = useCallback(async () => {
    try {
      const res = await authService.getMyProfile();
      let verified = Boolean(res.user?.is_age_verified || res.profile?.is_age_verified);

      try {
        const ageStatus = await authService.getAgeAssuranceStatus();
        if (ageStatus?.status === 'VERIFIED') {
          verified = true;
        } else if (ageStatus?.status === 'REJECTED' || ageStatus?.status === 'PENDING') {
          verified = false;
        }
        if (res.profile && ageStatus?.status) {
          res.profile.verification_status = ageStatus.status as any;
        }
      } catch {
        // Retain existing flag if status endpoint is temporarily unreachable
      }

      if (res.user) {
        res.user.is_age_verified = verified;
      }
      if (res.profile) {
        res.profile.is_age_verified = verified;
      }

      setUser(res.user);
      if (res.user?.id) {
        chatService.setCurrentUserId(res.user.id);
      }
      setProfile(res.profile);
      setIsAgeVerified(verified);
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

  const loginWithGoogle = async (payload: GoogleAuthPayload) => {
    setIsLoading(true);
    try {
      const res = await authService.loginWithGoogle(payload);
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
      chatService.setCurrentUserId(null);
      chatService.resetUnreadState();
      setUser(null);
      setProfile(null);
      setIsAgeVerified(false);
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
        loginWithGoogle,
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
