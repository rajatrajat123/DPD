import React, { useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../theme';
import { AD_UNIT_IDS, admobService, isGoogleMobileAdsAvailable } from '../services/ads/admobService';

interface SponsoredBannerAdProps {
  testID?: string;
}

export const SponsoredBannerAd: React.FC<SponsoredBannerAdProps> = ({ testID = 'sponsored-banner-ad' }) => {
  const [adError, setAdError] = useState(false);

  // Attempt to load native BannerAd only if native Google Mobile Ads module is available (e.g. dev build)
  let NativeBanner: React.ComponentType<{
    unitId: string;
    size: string;
    requestOptions: Record<string, unknown>;
    onAdFailedToLoad?: (err: unknown) => void;
  }> | null = null;
  let BannerAdSize: Record<string, string> | null = null;

  if (isGoogleMobileAdsAvailable()) {
    try {
      const mobileAds = require('react-native-google-mobile-ads');
      if (mobileAds && mobileAds.BannerAd && mobileAds.BannerAdSize) {
        NativeBanner = mobileAds.BannerAd;
        BannerAdSize = mobileAds.BannerAdSize;
      }
    } catch {
      // Native banner unavailable in web/headless/mock environment
    }
  }

  const adUnitId = AD_UNIT_IDS.BANNER || 'ca-app-pub-3940256099942544/6300978111';
  const requestOptions = admobService.getSafeAdRequestConfig();

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.badgeRow}>
        <Text style={styles.sponsoredBadge}>SPONSORED</Text>
      </View>

      {NativeBanner && BannerAdSize && !adError ? (
        <View style={styles.adWrapper}>
          <NativeBanner
            unitId={adUnitId}
            size={BannerAdSize.BANNER || 'BANNER'}
            requestOptions={requestOptions as unknown as Record<string, unknown>}
            onAdFailedToLoad={() => setAdError(true)}
          />
        </View>
      ) : (
        <View style={styles.fallbackCard}>
          <Text style={styles.fallbackTitle}>Aura Curated Selection</Text>
          <Text style={styles.fallbackBody}>
            Exclusive experiences for the discerning community.
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    padding: spacing.sm,
    backgroundColor: 'rgba(212, 175, 55, 0.05)',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
    alignItems: 'center',
    overflow: 'hidden',
  },
  badgeRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: spacing.xs,
  },
  sponsoredBadge: {
    ...typography.caption,
    fontSize: 9,
    color: colors.gold,
    letterSpacing: 1.5,
    fontWeight: '700',
    backgroundColor: 'rgba(212, 175, 55, 0.15)',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.xs,
  },
  adWrapper: {
    minHeight: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackCard: {
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  fallbackTitle: {
    ...typography.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  fallbackBody: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
});
