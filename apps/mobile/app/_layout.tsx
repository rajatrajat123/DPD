import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { PrivacyVeil } from '../src/components/PrivacyVeil';
import { colors } from '../src/theme';

// Global safeguard for React Native Hermes engine: Error.prototype.name has only a getter without a setter.
// Direct assignments like `this.name = '...'` (e.g. whatwg-fetch DOMException polyfill) throw:
// "TypeError: Cannot assign to property 'name' which has only a getter".
// Providing a setter on Error.prototype allows direct assignment to safely define an own property.
(() => {
  try {
    const errorNameDesc = Object.getOwnPropertyDescriptor(Error.prototype, 'name');
    if (errorNameDesc && errorNameDesc.get && !errorNameDesc.set) {
      Object.defineProperty(Error.prototype, 'name', {
        get: errorNameDesc.get,
        set(value) {
          Object.defineProperty(this, 'name', {
            value,
            writable: true,
            enumerable: false,
            configurable: true,
          });
        },
        configurable: true,
      });
    }
  } catch {
    // Environment does not permit mutating Error.prototype
  }
})();

function NavigationGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, isAgeVerified } = useAuth();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const onVerifyAgeScreen = pathname === '/(auth)/verify-age' || segments[1] === 'verify-age';
    const onResetPasswordScreen = pathname === '/(auth)/reset-password' || pathname === '/reset-password' || segments[1] === 'reset-password';

    if (!isAuthenticated && !inAuthGroup) {
      // Redirect to login preserving destination
      const redirectParam = pathname && pathname !== '/' ? `?redirect=${encodeURIComponent(pathname)}` : '';
      router.replace(`/(auth)/login${redirectParam}` as any);
    } else if (isAuthenticated && inAuthGroup && !onVerifyAgeScreen && !onResetPasswordScreen) {
      // Already authenticated, redirect out of login/register:
      // If user is unverified, guide to age assurance onboarding first; otherwise go to tabs
      if (!isAgeVerified) {
        router.replace('/(auth)/verify-age');
      } else {
        router.replace('/(tabs)');
      }
    }
  }, [isAuthenticated, isLoading, isAgeVerified, segments, pathname, router]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <NavigationGuard>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)/register" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)/forgot-password" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)/reset-password" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)/verify-age" options={{ headerShown: false, presentation: 'modal' }} />
            <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="search" options={{ headerShown: false }} />
            <Stack.Screen name="profile/[id]" options={{ headerShown: false }} />
          </Stack>
        </NavigationGuard>
        {/* Global privacy veil shielding sensitive content in app switcher and biometric lock */}
        <PrivacyVeil />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
