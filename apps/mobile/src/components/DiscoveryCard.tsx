import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Dimensions,
  Animated,
  PanResponder,
  Modal,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { colors, typography, spacing, borderRadius } from '../theme';
import { DiscoveryCandidate } from '../types';
import { SafeAreaView } from 'react-native-safe-area-context';

const SCREEN_WIDTH = Dimensions.get('window').width;

interface DiscoveryCardProps {
  candidate: DiscoveryCandidate;
  onLike: () => void;
  onPass: () => void;
  onSuperSpark: () => void;
  onRewind?: () => void;
  canRewind?: boolean;
}

export const DiscoveryCard: React.FC<DiscoveryCardProps> = ({
  candidate,
  onLike,
  onPass,
  onSuperSpark,
  onRewind,
  canRewind = false,
}) => {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const cardWidth = Math.min(windowWidth - spacing.md * 2, 420);
  // Responsively scale photo height so the total card (photo + ~74px actionsBar) starts completely
  // below the header & compact banner and fits above the bottom tab bar without overlapping.
  const maxAvailablePhotoHeight = Math.max(windowHeight - 310, 280);
  const photoHeight = Math.min(
    cardWidth * 1.34,
    maxAvailablePhotoHeight,
    windowHeight * 0.54,
    460
  );

  const [photoIndex, setPhotoIndex] = useState(0);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [imageError, setImageError] = useState(false);

  const photos =
    candidate.photos && candidate.photos.length > 0
      ? candidate.photos
      : [{ id: 'default', url: '', is_primary: true, order: 0 }];
  const currentPhoto = photos[photoIndex] || photos[0] || { id: 'default', url: '', is_primary: true, order: 0 };

  const pan = useRef(new Animated.ValueXY()).current;

  useEffect(() => {
    pan.setValue({ x: 0, y: 0 });
    setPhotoIndex(0);
    setImageError(false);
    setShowDetailsModal(false);
  }, [candidate.id, candidate.user_id]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 15 || Math.abs(gestureState.dy) > 15;
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > 110) {
          Animated.timing(pan, {
            toValue: { x: windowWidth + 150, y: gestureState.dy },
            duration: 200,
            useNativeDriver: false,
          }).start(() => onLike());
        } else if (gestureState.dx < -110) {
          Animated.timing(pan, {
            toValue: { x: -windowWidth - 150, y: gestureState.dy },
            duration: 200,
            useNativeDriver: false,
          }).start(() => onPass());
        } else {
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            friction: 5,
            useNativeDriver: false,
          }).start();
        }
      },
    })
  ).current;

  const rotate = pan.x.interpolate({
    inputRange: [-windowWidth * 1.5, 0, windowWidth * 1.5],
    outputRange: ['-18deg', '0deg', '18deg'],
  });

  const likeOpacity = pan.x.interpolate({
    inputRange: [20, 100],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const passOpacity = pan.x.interpolate({
    inputRange: [-100, -20],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const animatedCardStyle = {
    transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }],
  };

  const handleLikeBtn = () => {
    Animated.timing(pan, {
      toValue: { x: windowWidth + 150, y: 0 },
      duration: 250,
      useNativeDriver: false,
    }).start(() => onLike());
  };

  const handlePassBtn = () => {
    Animated.timing(pan, {
      toValue: { x: -windowWidth - 150, y: 0 },
      duration: 250,
      useNativeDriver: false,
    }).start(() => onPass());
  };

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

  return (
    <View style={styles.cardContainer}>
      <Animated.View style={[styles.card, { width: cardWidth }, animatedCardStyle]} {...panResponder.panHandlers}>
        {/* Swipe Stamp: LIKE (Red stamp matching new red Like action) */}
        <Animated.View style={[styles.stampContainer, styles.likeStamp, { opacity: likeOpacity }]} pointerEvents="none">
          <Text style={styles.likeStampText}>LIKE</Text>
        </Animated.View>

        {/* Swipe Stamp: PASS */}
        <Animated.View style={[styles.stampContainer, styles.passStamp, { opacity: passOpacity }]} pointerEvents="none">
          <Text style={styles.passStampText}>PASS</Text>
        </Animated.View>

        {/* Main Photo Container */}
        <View style={[styles.photoContainer, { height: photoHeight }]}>
          {currentPhoto.url && !imageError ? (
            <Image
              source={{ uri: currentPhoto.url }}
              style={styles.photo}
              resizeMode="cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <View style={styles.placeholderPhoto}>
              <Text style={styles.placeholderMonogram}>{candidate.display_name.charAt(0)}</Text>
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

          {/* Top Info Badges */}
          <View style={styles.topBadgesRow} pointerEvents="box-none">
            {candidate.distance_bucket_km > 0 ? (
              <View style={styles.badgePill}>
                <Text style={styles.badgePillText}>📍 {candidate.distance_bucket_km} km away</Text>
              </View>
            ) : <View />}

            {candidate.is_verified && (
              <View style={styles.verifiedPill}>
                <Text style={styles.verifiedPillText}>✓ 18+ Verified</Text>
              </View>
            )}
          </View>

          {/* Tap Zones for cycling photos */}
          <TouchableOpacity style={styles.leftTapZone} onPress={handlePrevPhoto} activeOpacity={1} />
          <TouchableOpacity style={styles.rightTapZone} onPress={handleNextPhoto} activeOpacity={1} />

          {/* Bottom Card Info Overlay */}
          <View style={styles.infoOverlay}>
            <View style={styles.nameHeaderRow}>
              <View style={styles.nameAndAge}>
                <Text style={styles.name} numberOfLines={1}>
                  {candidate.display_name}
                </Text>
                <Text style={styles.age}> {candidate.age}</Text>
              </View>

              {/* Info Button to Open Details Modal */}
              <TouchableOpacity
                style={styles.infoBtn}
                onPress={() => setShowDetailsModal(true)}
                activeOpacity={0.8}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.infoBtnText}>ⓘ</Text>
              </TouchableOpacity>
            </View>

            {/* Tags & Lifestyle Pills */}
            <View style={styles.tagsRow}>
              {candidate.compatibility_score > 0 && (
                <View style={styles.scoreTag}>
                  <Text style={styles.scoreTagText}>★ {candidate.compatibility_score}% Compatibility</Text>
                </View>
              )}
              {candidate.pronouns && candidate.pronouns.length > 0 && (
                <View style={styles.tag}>
                  <Text style={styles.tagText}>{candidate.pronouns.join('/')}</Text>
                </View>
              )}
              {candidate.smoking_preference && (
                <View
                  style={[
                    styles.tag,
                    candidate.smoking_preference === 'NON_SMOKER' ? styles.tagNonSmoker : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.tagText,
                      candidate.smoking_preference === 'NON_SMOKER' ? styles.tagTextNonSmoker : null,
                    ]}
                  >
                    🚭 {candidate.smoking_preference === 'NON_SMOKER' ? 'Non-smoker' : 'Smoker'}
                  </Text>
                </View>
              )}
            </View>

            {/* Bio Snippet */}
            {candidate.bio ? (
              <Text style={styles.bio} numberOfLines={2}>
                {candidate.bio}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Premium Rounded Action Buttons */}
        <View style={styles.actionsBar}>
          {canRewind && onRewind && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.rewindBtn]}
              onPress={onRewind}
              activeOpacity={0.8}
            >
              <Text style={styles.rewindIcon}>↺</Text>
            </TouchableOpacity>
          )}

          {/* Pass Button: Charcoal round button with clear cross */}
          <TouchableOpacity
            style={[styles.actionBtn, styles.passBtn]}
            onPress={handlePassBtn}
            activeOpacity={0.8}
          >
            <Text style={styles.passIcon}>✕</Text>
          </TouchableOpacity>

          {/* Super Spark Button: Charcoal with gold star */}
          <TouchableOpacity
            style={[styles.actionBtn, styles.superSparkBtn]}
            onPress={onSuperSpark}
            activeOpacity={0.8}
          >
            <Text style={styles.superSparkIcon}>★</Text>
          </TouchableOpacity>

          {/* Like Button: Red Like Button with heart */}
          <TouchableOpacity
            style={[styles.actionBtn, styles.likeBtn]}
            onPress={handleLikeBtn}
            activeOpacity={0.8}
          >
            <Text style={styles.likeIcon}>♥</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* Profile Details Modal */}
      <Modal
        visible={showDetailsModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowDetailsModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Profile Details</Text>
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setShowDetailsModal(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.modalCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalScroll}>
            {/* Main Modal Image */}
            <View style={styles.modalImageContainer}>
              {photos[0]?.url ? (
                <Image source={{ uri: photos[0].url }} style={styles.modalImage} resizeMode="cover" />
              ) : (
                <View style={[styles.modalImage, styles.placeholderPhoto]}>
                  <Text style={styles.placeholderMonogram}>{candidate.display_name.charAt(0)}</Text>
                </View>
              )}
            </View>

            <View style={styles.modalBody}>
              <View style={styles.modalNameRow}>
                <Text style={styles.modalName}>{candidate.display_name},</Text>
                <Text style={styles.modalAge}> {candidate.age}</Text>
                {candidate.is_verified && (
                  <View style={styles.modalVerifiedBadge}>
                    <Text style={styles.modalVerifiedText}>✓ 18+ Verified</Text>
                  </View>
                )}
              </View>

              {candidate.distance_bucket_km > 0 && (
                <Text style={styles.modalDistance}>📍 {candidate.distance_bucket_km} km away</Text>
              )}

              {/* Bio Section */}
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>About</Text>
                <Text style={styles.modalBioText}>
                  {candidate.bio || 'This member has not written a bio yet.'}
                </Text>
              </View>

              {/* Identities & Orientations */}
              {((candidate.gender_identities && candidate.gender_identities.length > 0) ||
                (candidate.sexual_orientations && candidate.sexual_orientations.length > 0)) && (
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Identity & Orientation</Text>
                  <View style={styles.tagsRow}>
                    {candidate.gender_identities?.map((g, i) => (
                      <View key={`g-${i}`} style={styles.modalPill}>
                        <Text style={styles.modalPillText}>{g}</Text>
                      </View>
                    ))}
                    {candidate.sexual_orientations?.map((o, i) => (
                      <View key={`o-${i}`} style={styles.modalPill}>
                        <Text style={styles.modalPillText}>{o}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Lifestyle & Dealbreakers */}
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>Lifestyle</Text>
                <View style={styles.tagsRow}>
                  <View
                    style={[
                      styles.modalPill,
                      candidate.smoking_preference === 'NON_SMOKER' ? styles.tagNonSmoker : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.modalPillText,
                        candidate.smoking_preference === 'NON_SMOKER' ? styles.tagTextNonSmoker : null,
                      ]}
                    >
                      🚭 {candidate.smoking_preference === 'NON_SMOKER' ? 'Non-smoker' : 'Smoker'}
                    </Text>
                  </View>

                  {candidate.relationship_structure ? (
                    <View style={styles.modalPill}>
                      <Text style={styles.modalPillText}>
                        🔗 {candidate.relationship_structure}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {/* Additional Photos Grid if present */}
              {photos.length > 1 && (
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>More Photos</Text>
                  <View style={styles.modalPhotosGrid}>
                    {photos.slice(1).map((p, idx) => (
                      <Image key={p.id || idx} source={{ uri: p.url }} style={styles.modalGridPhoto} />
                    ))}
                  </View>
                </View>
              )}
            </View>
          </ScrollView>

          {/* Modal Action Controls */}
          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.passBtn]}
              onPress={() => {
                setShowDetailsModal(false);
                handlePassBtn();
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.passIcon}>✕</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.superSparkBtn]}
              onPress={() => {
                setShowDetailsModal(false);
                onSuperSpark();
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.superSparkIcon}>★</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.likeBtn]}
              onPress={() => {
                setShowDetailsModal(false);
                handleLikeBtn();
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.likeIcon}>♥</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  photoContainer: {
    width: '100%',
    position: 'relative',
    backgroundColor: colors.backgroundElevated,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  placeholderPhoto: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.cardMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderMonogram: {
    ...typography.display,
    color: colors.gold,
    fontSize: 72,
  },
  paginationRow: {
    position: 'absolute',
    top: 6,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    gap: 5,
    zIndex: 10,
  },
  paginationDot: {
    flex: 1,
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
    borderRadius: 2,
  },
  paginationDotActive: {
    backgroundColor: colors.gold,
  },
  topBadgesRow: {
    position: 'absolute',
    top: 14,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  badgePill: {
    backgroundColor: 'rgba(9, 10, 14, 0.72)',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgePillText: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  verifiedPill: {
    backgroundColor: colors.emeraldMuted,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.emerald,
  },
  verifiedPillText: {
    ...typography.caption,
    color: colors.emerald,
    fontSize: 11,
    fontWeight: '700',
  },
  leftTapZone: {
    position: 'absolute',
    left: 0,
    top: 50,
    bottom: 120,
    width: '35%',
  },
  rightTapZone: {
    position: 'absolute',
    right: 0,
    top: 50,
    bottom: 120,
    width: '35%',
  },
  infoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: 'rgba(9, 10, 14, 0.90)',
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  nameHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  nameAndAge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flex: 1,
  },
  name: {
    ...typography.h1,
    fontSize: 22,
    color: colors.text,
    fontWeight: '700',
  },
  age: {
    ...typography.h2,
    fontSize: 20,
    color: colors.gold,
    fontWeight: '600',
  },
  infoBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.cardElevated,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoBtnText: {
    fontSize: 16,
    color: colors.gold,
    fontWeight: '700',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  scoreTag: {
    backgroundColor: colors.goldMuted,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  scoreTagText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.gold,
    fontWeight: '700',
  },
  tag: {
    backgroundColor: colors.backgroundElevated,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
  },
  tagNonSmoker: {
    borderColor: colors.emerald,
    backgroundColor: colors.emeraldMuted,
  },
  tagTextNonSmoker: {
    color: colors.emerald,
  },
  bio: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
    fontSize: 12,
  },
  actionsBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    backgroundColor: '#10121A',
  },
  actionBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 4,
  },
  rewindBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  rewindIcon: {
    fontSize: 16,
    color: colors.gold,
    fontWeight: '700',
  },
  passBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#1D202B',
    borderWidth: 1,
    borderColor: '#2D3243',
  },
  passIcon: {
    fontSize: 22,
    color: '#8E95A8',
    fontWeight: '700',
  },
  superSparkBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1D202B',
    borderWidth: 1,
    borderColor: colors.gold,
  },
  superSparkIcon: {
    fontSize: 20,
    color: colors.gold,
  },
  likeBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#E53935', // Red Like Button per user specifications
    borderWidth: 1,
    borderColor: '#FF5252',
  },
  likeIcon: {
    fontSize: 24,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  stampContainer: {
    position: 'absolute',
    top: 40,
    zIndex: 99,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
    borderWidth: 3,
  },
  likeStamp: {
    left: 24,
    borderColor: '#E53935',
    transform: [{ rotate: '-18deg' }],
  },
  likeStampText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#E53935',
    letterSpacing: 2,
  },
  passStamp: {
    right: 24,
    borderColor: '#8E95A8',
    transform: [{ rotate: '18deg' }],
  },
  passStampText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#8E95A8',
    letterSpacing: 2,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  modalTitle: {
    ...typography.h3,
    color: colors.text,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalCloseText: {
    fontSize: 16,
    color: colors.textMuted,
  },
  modalScroll: {
    paddingBottom: 100,
  },
  modalImageContainer: {
    width: '100%',
    height: 340,
    backgroundColor: colors.card,
  },
  modalImage: {
    width: '100%',
    height: '100%',
  },
  modalBody: {
    padding: spacing.lg,
  },
  modalNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  modalName: {
    ...typography.h1,
    color: colors.text,
  },
  modalAge: {
    ...typography.h1,
    color: colors.gold,
  },
  modalVerifiedBadge: {
    marginLeft: spacing.sm,
    backgroundColor: colors.emeraldMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.xs,
    borderWidth: 1,
    borderColor: colors.emerald,
  },
  modalVerifiedText: {
    ...typography.caption,
    color: colors.emerald,
    fontWeight: '700',
    fontSize: 11,
  },
  modalDistance: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  modalSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  modalSectionTitle: {
    ...typography.caption,
    color: colors.gold,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
    fontSize: 11,
  },
  modalBioText: {
    ...typography.body,
    color: colors.text,
    lineHeight: 20,
  },
  modalPill: {
    backgroundColor: colors.cardElevated,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalPillText: {
    ...typography.bodySmall,
    color: colors.text,
    fontSize: 12,
  },
  modalPhotosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  modalGridPhoto: {
    width: (SCREEN_WIDTH - spacing.lg * 2 - spacing.sm) / 2,
    height: 200,
    borderRadius: borderRadius.md,
  },
  modalActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: 'rgba(9, 10, 14, 0.95)',
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
});
