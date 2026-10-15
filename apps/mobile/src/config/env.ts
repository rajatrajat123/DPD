import { Platform } from 'react-native';
import Constants from 'expo-constants';

const getHostFromConstants = (): string | null => {
  const hostCandidate =
    Constants.expoConfig?.hostUri ||
    (Constants as any).expoGoConfig?.debuggerHost ||
    (Constants as any).manifest?.debuggerHost ||
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost;

  if (typeof hostCandidate === 'string' && hostCandidate.length > 0) {
    const host = hostCandidate.split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return host;
    }
  }

  if (Constants.linkingUri) {
    try {
      const match = Constants.linkingUri.match(/^[a-zA-Z]+:\/\/([^:/]+)/);
      if (match && match[1] && match[1] !== 'localhost' && match[1] !== '127.0.0.1') {
        return match[1];
      }
    } catch {
      // Ignore URL parse error
    }
  }

  return null;
};

const getDefaultApiUrl = (): string => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  const detectedHost = getHostFromConstants();
  if (detectedHost) {
    return `http://${detectedHost}:8080`;
  }

  if (Platform.OS === 'web') {
    return 'http://localhost:8080';
  }

  // Physical Android / iOS devices on local network fall back to verified development PC LAN IP
  return 'http://192.168.29.15:8080';
};

const getWebSocketUrl = (httpUrl: string): string => {
  if (httpUrl.startsWith('https://')) {
    return httpUrl.replace('https://', 'wss://') + '/api/v1/ws';
  }
  return httpUrl.replace('http://', 'ws://') + '/api/v1/ws';
};

export const config = {
  appName: 'Aura',
  appVersion: '1.0.0',
  environment: (process.env.EXPO_PUBLIC_APP_ENV || 'development') as 'development' | 'staging' | 'production',
  get apiUrl(): string {
    return getDefaultApiUrl();
  },
  get wsUrl() {
    return getWebSocketUrl(this.apiUrl);
  },
  apiTimeoutMs: 15000,
  tokenRefreshLeadSeconds: 60,
  maxImageSizeBytes: 15 * 1024 * 1024, // 15 MiB
  maxVideoSizeBytes: 100 * 1024 * 1024, // 100 MiB
  maxVideoDurationSecs: 60,
  get androidPackage(): string {
    return Constants.expoConfig?.android?.package || 'com.aura.dating';
  },
  get iosBundleIdentifier(): string {
    return Constants.expoConfig?.ios?.bundleIdentifier || 'com.aura.dating';
  },
};
