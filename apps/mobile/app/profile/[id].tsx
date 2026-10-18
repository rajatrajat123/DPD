import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors, typography, spacing, borderRadius } from '../../src/theme';
import { discoveryService } from '../../src/services/discovery/discoveryService';
import { DiscoveryCandidate, DiscoveryMessagingQuota } from '../../src/types';
import { MatchCelebrationModal } from '../../src/components/MatchCelebrationModal';
import { DiscoveryMessageQuotaModal } from '../../src/components/DiscoveryMessageQuotaModal';
import { QuickMessageComposer } from '../../src/components/QuickMessageComposer';
import { useAuth } from '../../src/context/AuthContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PHOTO_HEIGHT = Math.round(SCREEN_WIDTH * 1.15);

export default function ProfileDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile: myProfile } = useAuth();

  const [candidate, setCandidate] = useState<DiscoveryCandidate | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [isSwiping, setIsSwiping] = useState(false);
  const [matchedCandidate, setMatchedCandidate] = useState<DiscoveryCandidate | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messageQuota, setMessageQuota] = useState<DiscoveryMessagingQuota | null>(null);
  const [showMessageQuotaModal, setShowMessageQuotaModal] = useState(false);
  const [isFavourite, setIsFavourite] = useState(false);

  useEffect(() => {
    discoveryService.getMessagingQuota().then(setMessageQuota).catch(() => {});
    if (id) {
      discoveryService.getFavourites().then((res) => {
        const isFav = (res?.favourites || []).some((f) => f.user_id === id);
        setIsFavourite(isFav);
      }).catch(() => {});
    }
  }, [id]);

  const handleToggleFavourite = async () => {
    if (!id) return;
    const wasFav = isFavourite;
    setIsFavourite(!wasFav);
    try {
      if (wasFav) {
        await discoveryService.removeFavourite(id);
      } else {
        await discoveryService.addFavourite(id);
      }
    } catch {
      setIsFavourite(wasFav);
      Alert.alert('Bookmark Failed', 'Could not update favourites.');
    }
  };

  const fetchProfile = async () => {
    if (!id) {
      setError('Invalid profile ID');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const data = await discoveryService.getPublicProfile(id);
      setCandidate(data);
      setPhotoIndex(0);
      setImageError(false);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : (err?.message || 'Could not load profile.');
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [id]);

  const photos = candidate?.photos && candidate.photos.length > 0
    ? candidate.photos
    : [{ id: 'default', url: '', is_primary: true, order: 0 }];
  const currentPhoto = photos[photoIndex];

  const handleNextPhoto = () => {
    if (photoIndex < photos.length - 1) {
      setPhotoIndex(photoIndex + 1);
      setImageError(false);
    }
  };

  const handlePrevPhoto = () => {
    if (photoIndex > 0) {
      setPhotoIndex(photoIndex - 1);
      setImageError(false);
    }
  };

  const handleAction = async (direction: 'LIKE' | 'PASS') => {
    if (!candidate || isSwiping) return;
    setIsSwiping(true);

    try {
      const res = await discoveryService.swipe(candidate.user_id, direction);
      if (res.is_mutual_match) {
        setMatchedCandidate(candidate);
        setActiveConversationId(res.conversation_id || null);
      } else {
        Alert.alert(
          direction === 'LIKE' ? 'Liked!' : 'Passed',
          direction === 'LIKE' ? `You liked ${candidate.display_name}.` : `You passed on ${candidate.display_name}.`,
          [{ text: 'OK', onPress: () => router.back() }]
        );
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : (err?.message || 'Could not complete action.');
      Alert.alert('Action Failed', msg);
    } finally {
      setIsSwiping(false);
    }
  };

  const handleSendIntro = async (note: string) => {
    if (!candidate) return;
    if (messageQuota && !messageQuota.is_unlimited && messageQuota.is_locked) {
      setShowMessageQuotaModal(true);
      throw new Error('DISCOVERY_MESSAGE_QUOTA_LOCKED');
    }

    try {
      const res = await discoveryService.swipe(candidate.user_id, 'LIKE', note);
      if (res.is_mutual_match) {
        setMatchedCandidate(candidate);
        setActiveConversationId(res.conversation_id || null);
      } else {
        Alert.alert(
          'Intro Note Sent',
          `Your message request was delivered to ${candidate.display_name}. When they like you back, you'll be connected in Chat.`
        );
      }
      discoveryService.getMessagingQuota().then((updated) => {
        setMessageQuota(updated);
        if (updated && !updated.is_unlimited && updated.is_locked) {
          setShowMessageQuotaModal(true);
        }
      }).catch(() => {});
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes('DISCOVERY_MESSAGE_QUOTA_LOCKED') ||
        errMsg.includes('USAGE_LIMIT_REACHED') ||
        errMsg.includes('usage limit') ||
        errMsg.includes('cooldown is active') ||
        errMsg.includes('quota exhausted')
      ) {
        setShowMessageQuotaModal(true);
        discoveryService.getMessagingQuota().then(setMessageQuota).catch(() => {});
      } else if (
        errMsg.includes('AWAITING_REPLY') ||
        errMsg.includes('cannot send another message until recipient replies')
      ) {
        Alert.alert(
          'Waiting for Reply',
          'You can only send one initial message to this profile until they reply.',
          [{ text: 'OK', style: 'default' }]
        );
      } else {
        Alert.alert('Send Failed', 'Could not deliver intro note. Please check your connection and try again.');
      }
      throw err;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
          testID="profile-back-button"
        >
          <Text style={styles.backIcon}>◀</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <TouchableOpacity
          style={[
            styles.favouriteToggleBtn,
            {
              backgroundColor: isFavourite ? 'rgba(212, 175, 55, 0.2)' : colors.card,
              borderColor: isFavourite ? colors.gold : colors.border,
            },
          ]}
          onPress={handleToggleFavourite}
          activeOpacity={0.7}
          testID="profile-favourite-toggle"
          accessibilityRole="button"
          accessibilityLabel={isFavourite ? 'Remove from favourites' : 'Save to favourites'}
        >
          <Text style={[styles.favouriteToggleText, { color: isFavourite ? colors.gold : colors.textMuted }]}>
            {isFavourite ? '🔖 Saved' : '🏷️ Save'}
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.gold} />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      ) : error || !candidate ? (
        <View style={styles.centerContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Profile Unavailable</Text>
          <Text style={styles.errorText}>{error || 'Candidate profile could not be found.'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchProfile} activeOpacity={0.8}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.mainContainer} testID="profile-screen">
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Hero Photo Carousel */}
            <View style={styles.photoContainer}>
              {currentPhoto?.url && !imageError ? (
                <Image
                  source={{ uri: currentPhoto.url }}
                  style={styles.photo}
                  resizeMode="cover"
                  onError={() => setImageError(true)}
                />
              ) : (
                <View style={styles.placeholderPhoto}>
                  <Text style={styles.placeholderMonogram}>
                    {candidate.display_name ? candidate.display_name.charAt(0).toUpperCase() : 'A'}
                  </Text>
                </View>
              )}

              {/* Photo Pagination Bar */}
              {photos.length > 1 && (
                <View style={styles.paginationRow}>
                  {photos.map((_, idx) => (
                    <View
                      key={idx}
                      style={[styles.paginationDot, idx === photoIndex ? styles.paginationDotActive : null]}
                    />
                  ))}
                </View>
              )}

              {/* Verified Badge */}
              {candidate.is_verified && (
                <View style={styles.verifiedBadge}>
                  <Text style={styles.verifiedBadgeText}>✓ 18+ Verified</Text>
                </View>
              )}

              {/* Tap Zones for cycling photos */}
              <TouchableOpacity style={styles.leftTapZone} onPress={handlePrevPhoto} activeOpacity={1} />
              <TouchableOpacity style={styles.rightTapZone} onPress={handleNextPhoto} activeOpacity={1} />
            </View>

            {/* Profile Info Details */}
            <View style={styles.infoSection}>
              {/* Name & Age Row */}
              <View style={styles.nameRow}>
                <Text style={styles.displayName}>{candidate.display_name}, {candidate.age}</Text>
              </View>

              {/* Distance Pill */}
              <View style={styles.distancePill}>
                <Text style={styles.distanceText}>📍 ~{candidate.distance_bucket_km} km away</Text>
              </View>

              {/* Pronouns */}
              {candidate.pronouns && candidate.pronouns.length > 0 && (
                <View style={styles.pronounsRow}>
                  <Text style={styles.pronounsText}>Pronouns: {candidate.pronouns.join(' / ')}</Text>
                </View>
              )}

              {/* Bio */}
              {Boolean(candidate.bio) && (
                <View style={styles.bioContainer}>
                  <Text style={styles.sectionLabel}>About</Text>
                  <Text style={styles.bioText}>{candidate.bio}</Text>
                </View>
              )}

              {/* Identities & Orientations */}
              <View style={styles.tagsContainer}>
                <Text style={styles.sectionLabel}>Identities & Dating</Text>
                <View style={styles.tagWrap}>
                  {candidate.gender_identities?.map((g) => (
                    <View key={g} style={styles.tagPill}>
                      <Text style={styles.tagPillText}>{g}</Text>
                    </View>
                  ))}
                  {candidate.sexual_orientations?.map((s) => (
                    <View key={s} style={[styles.tagPill, styles.orientationPill]}>
                      <Text style={[styles.tagPillText, styles.orientationPillText]}>{s}</Text>
                    </View>
                  ))}
                  {candidate.relationship_intents?.map((intent) => (
                    <View key={intent} style={[styles.tagPill, styles.intentPill]}>
                      <Text style={[styles.tagPillText, styles.intentPillText]}>✨ {intent}</Text>
                    </View>
                  ))}
                  {Boolean(candidate.relationship_structure) && (
                    <View style={[styles.tagPill, styles.structurePill]}>
                      <Text style={styles.structurePillText}>🔗 {candidate.relationship_structure}</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Lifestyle Habits */}
              <View style={styles.tagsContainer}>
                <Text style={styles.sectionLabel}>Lifestyle Habits</Text>
                <View style={styles.tagWrap}>
                  {Boolean(candidate.smoking_preference) && (
                    <View style={styles.tagPill}>
                      <Text style={styles.tagPillText}>🚬 {candidate.smoking_preference}</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Action Footer with Composer */}
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.composerWrapper}>
              <QuickMessageComposer
                recipientId={candidate.user_id || candidate.id}
                recipientName={candidate.display_name}
                placeholder="Write an intro message..."
                quota={messageQuota}
                onQuotaPress={() => setShowMessageQuotaModal(true)}
                onSend={handleSendIntro}
              />
            </View>

            <View style={styles.actionFooter}>
              <TouchableOpacity
                style={styles.passButton}
                onPress={() => handleAction('PASS')}
                disabled={isSwiping}
                activeOpacity={0.8}
                testID="profile-pass-button"
              >
                <Text style={styles.passButtonText}>✕ Pass</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.likeButton}
                onPress={() => handleAction('LIKE')}
                disabled={isSwiping}
                activeOpacity={0.8}
                testID="profile-like-button"
              >
                <Text style={styles.likeButtonText}>♥ Like</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      )}

      {/* Discovery Message Quota Modal */}
      <DiscoveryMessageQuotaModal
        visible={showMessageQuotaModal}
        userId={candidate?.user_id || myProfile?.id || 'aura_user'}
        quota={messageQuota}
        onClose={() => setShowMessageQuotaModal(false)}
        onQuotaUpdated={(updated: DiscoveryMessagingQuota) => {
          setMessageQuota(updated);
        }}
        onUpgradePress={() => router.push('/(tabs)/membership')}
      />

      {/* Match Celebration Modal */}
      {matchedCandidate && (
        <MatchCelebrationModal
          visible={Boolean(matchedCandidate)}
          onClose={() => {
            setMatchedCandidate(null);
            router.back();
          }}
          onSendMessage={() => {
            const cid = activeConversationId;
            const cname = matchedCandidate.display_name;
            const uid = matchedCandidate.user_id;
            setMatchedCandidate(null);
            if (cid) {
              router.push({
                pathname: '/chat/[id]',
                params: {
                  id: cid,
                  name: cname,
                  recipientId: uid,
                  avatar: matchedCandidate.photos?.[0]?.url || '',
                },
              });
            } else {
              router.push('/(tabs)/chat');
            }
          }}
          targetName={matchedCandidate.display_name}
          targetPhoto={matchedCandidate.photos?.[0]?.url}
          myPhoto={myProfile?.photos?.[0]?.url}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.backgroundElevated,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    backgroundColor: colors.card,
  },
  backIcon: {
    fontSize: 16,
    color: colors.gold,
  },
  headerTitle: {
    ...typography.h2,
    fontSize: 18,
    color: colors.text,
    fontWeight: '700',
  },
  headerRightSpacer: {
    width: 40,
  },
  favouriteToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  favouriteToggleText: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  errorIcon: {
    fontSize: 40,
    marginBottom: spacing.md,
  },
  errorTitle: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  errorText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  retryButton: {
    backgroundColor: colors.gold,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.full,
  },
  retryButtonText: {
    ...typography.button,
    color: colors.textInverse,
    fontWeight: '700',
  },
  mainContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  photoContainer: {
    width: SCREEN_WIDTH,
    height: PHOTO_HEIGHT,
    backgroundColor: colors.card,
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  placeholderPhoto: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.cardElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderMonogram: {
    fontSize: 72,
    fontWeight: '800',
    color: colors.gold,
  },
  paginationRow: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 6,
    zIndex: 10,
  },
  paginationDot: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  paginationDotActive: {
    backgroundColor: colors.gold,
  },
  verifiedBadge: {
    position: 'absolute',
    top: 26,
    right: 16,
    backgroundColor: colors.emeraldMuted,
    borderWidth: 1,
    borderColor: colors.emerald,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    zIndex: 10,
  },
  verifiedBadgeText: {
    ...typography.caption,
    color: colors.emerald,
    fontSize: 11,
    fontWeight: '700',
  },
  leftTapZone: {
    position: 'absolute',
    left: 0,
    top: 40,
    bottom: 0,
    width: '40%',
  },
  rightTapZone: {
    position: 'absolute',
    right: 0,
    top: 40,
    bottom: 0,
    width: '40%',
  },
  infoSection: {
    padding: spacing.lg,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  displayName: {
    ...typography.h1,
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
  },
  distancePill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.cardElevated,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.md,
  },
  distanceText: {
    ...typography.caption,
    color: colors.gold,
    fontSize: 12,
    fontWeight: '600',
  },
  pronounsRow: {
    marginBottom: spacing.md,
  },
  pronounsText: {
    ...typography.body,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  bioContainer: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    ...typography.caption,
    color: colors.gold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  bioText: {
    ...typography.body,
    color: colors.text,
    lineHeight: 22,
  },
  tagsContainer: {
    marginBottom: spacing.lg,
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  tagPill: {
    backgroundColor: colors.cardElevated,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  tagPillText: {
    ...typography.caption,
    color: colors.text,
    fontSize: 12,
  },
  orientationPill: {
    borderColor: colors.goldMuted,
  },
  orientationPillText: {
    color: colors.gold,
  },
  intentPill: {
    borderColor: 'rgba(212, 175, 55, 0.4)',
    backgroundColor: colors.goldMuted,
  },
  intentPillText: {
    color: colors.gold,
    fontWeight: '600',
  },
  structurePill: {
    borderColor: colors.border,
  },
  structurePillText: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
  },
  composerWrapper: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    backgroundColor: colors.backgroundElevated,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  actionFooter: {
    height: 72,
    backgroundColor: colors.backgroundElevated,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.xl,
  },
  passButton: {
    flex: 1,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  passButtonText: {
    ...typography.button,
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: 16,
  },
  likeButton: {
    flex: 1,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.gold,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.md,
  },
  likeButtonText: {
    ...typography.button,
    color: colors.textInverse,
    fontWeight: '800',
    fontSize: 16,
  },
});
