import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Platform,
} from 'react-native';
import { colors, typography, spacing, borderRadius } from '../theme';
import { AD_UNIT_IDS, admobService } from '../services/ads/admobService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - spacing.lg * 2;
const CARD_HEIGHT = CARD_WIDTH * 1.45;

interface SponsoredCardProps {
  onDismiss: () => void;
  testID?: string;
}

/**
 * SponsoredCard displays a genuine native AdMob sponsored unit inside the discovery feed.
 * Compliance guarantee:
 * - Visibly labeled as "SPONSORED ADVERTISEMENT"
 * - Never disguised as a dating profile (no fake user attributes, pronouns, or bio)
 * - Safe non-personalized ad request config
 * - Easy skip/continue action for uninterrupted browsing
 */
export const SponsoredCard: React.FC<SponsoredCardProps> = ({
  onDismiss,
  testID = 'sponsored-discovery-card',
}) => {
  const [adFailed, setAdFailed] = useState(false);

  // Attempt to load genuine native BannerAd / Medium Rectangle from react-native-google-mobile-ads
  let NativeBanner: React.ComponentType<{
    unitId: string;
    size: string;
    requestOptions: Record<string, unknown>;
    onAdFailedToLoad?: (err: unknown) => void;
  }> | null = null;
  let BannerAdSize: Record<string, string> | null = null;

  try {
    const mobileAds = require('react-native-google-mobile-ads');
    if (mobileAds && mobileAds.BannerAd && mobileAds.BannerAdSize) {
      NativeBanner = mobileAds.BannerAd;
      BannerAdSize = mobileAds.BannerAdSize;
    }
  } catch {
    // In headless test or Expo Go environments, fallback UI renders safely
  }

  const adUnitId = AD_UNIT_IDS.BANNER || 'ca-app-pub-3940256099942544/6300978111';
  const requestConfig = admobService.getSafeAdRequestConfig();

  return (
    <View style={styles.card} testID={testID}>
      {/* Explicit Advertisement Header Banner */}
      <View style={styles.header}>
        <View style={styles.badgeContainer}>
          <Text style={styles.sponsoredBadge}>SPONSORED ADVERTISEMENT</Text>
        </View>
        <Text style={styles.disclaimerText}>
          Aura Partner Selection • Not a dating profile
        </Text>
      </View>

      {/* Main Ad Content Container */}
      <View style={styles.adBody}>
        {NativeBanner && BannerAdSize && !adFailed ? (
          <View style={styles.adWrapper}>
            <NativeBanner
              unitId={adUnitId}
              size={BannerAdSize.MEDIUM_RECTANGLE || BannerAdSize.BANNER || 'BANNER'}
              requestOptions={requestConfig as unknown as Record<string, unknown>}
              onAdFailedToLoad={() => setAdFailed(true)}
            />
          </View>
        ) : (
          <View style={styles.fallbackBox}>
            <View style={styles.fallbackIcon}>
              <Text style={styles.fallbackIconText}>✨</Text>
            </View>
            <Text style={styles.fallbackTitle}>Aura Curated Brands</Text>
            <Text style={styles.fallbackDescription}>
              Discover community-aligned experiences, nightlife, and lifestyle offerings tailored for Aura members.
            </Text>
          </View>
        )}
      </View>

      {/* Footer with Clear Skip / Continue Control */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.skipButton}
          onPress={onDismiss}
          activeOpacity={0.8}
          testID="skip-sponsored-card-button"
        >
          <Text style={styles.skipButtonText}>Skip & Continue Browsing →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: '#141414',
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(212, 175, 55, 0.4)',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  header: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212, 175, 55, 0.2)',
  },
  badgeContainer: {
    backgroundColor: 'rgba(212, 175, 55, 0.15)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.4)',
    marginBottom: 6,
  },
  sponsoredBadge: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '800',
    color: colors.gold,
    letterSpacing: 2,
  },
  disclaimerText: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
  },
  adBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  adWrapper: {
    minHeight: 250,
    minWidth: 280,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  fallbackIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  fallbackIconText: {
    fontSize: 22,
  },
  fallbackTitle: {
    ...typography.h3,
    color: colors.text,
    fontSize: 16,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  fallbackDescription: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    fontSize: 12,
  },
  footer: {
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  skipButton: {
    backgroundColor: 'rgba(212, 175, 55, 0.12)',
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  skipButtonText: {
    ...typography.button,
    color: colors.gold,
    fontWeight: '700',
    fontSize: 13,
  },
});
