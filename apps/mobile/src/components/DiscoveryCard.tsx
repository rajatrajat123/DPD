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
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { colors, typography, spacing, borderRadius, useTheme } from '../theme';
import { DiscoveryCandidate, DiscoveryMessagingQuota, SwipeResponse } from '../types';
import { discoveryService } from '../services/discovery/discoveryService';
import { QuickMessageComposer } from './QuickMessageComposer';
import { SafeAreaView } from 'react-native-safe-area-context';

const SCREEN_WIDTH = Dimensions.get('window').width;

interface DiscoveryCardProps {
  candidate: DiscoveryCandidate;
  onLike: () => void;
  onPass: () => void;
  onSuperSpark: () => void;
  onRewind?: () => void;
  canRewind?: boolean;
  isKeyboardOpen?: boolean;
  maxCardHeight?: number;
  layout?: 'single' | 'double';
  onPressProfile?: () => void;
  messageQuota?: DiscoveryMessagingQuota | null;
  onQuotaPress?: () => void;
  onSendIntroNote?: (message: string) => Promise<void> | void;
  onQuotaUpdated?: (quota: DiscoveryMessagingQuota | null) => void;
}

export const DiscoveryCard: React.FC<DiscoveryCardProps> = ({
  candidate,
  onLike,
  onPass,
  onSuperSpark,
  onRewind,
  canRewind = false,
  isKeyboardOpen = false,
  maxCardHeight = 0,
  layout = 'single',
  onPressProfile,
  messageQuota,
  onQuotaPress,
  onSendIntroNote,
  onQuotaUpdated,
}) => {
  const { colors } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const cardWidth = Math.min(windowWidth - spacing.md * 2, 420);

  // Stable card dimensions & aspect ratio:
  // Maintain the profile card's intended 1.34 portrait aspect ratio and dimensions consistently,
  // preventing the card photo from collapsing, compressing into a thin sliver, or jumping when the keyboard opens.
  const normalMaxPhotoHeight = Math.max(windowHeight - 330, 260);
  const photoHeight = Math.min(
    cardWidth * 1.34,
    normalMaxPhotoHeight,
    windowHeight * 0.52,
    450
  );

  const [photoIndex, setPhotoIndex] = useState(0);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [hasSentIntroInModal, setHasSentIntroInModal] = useState(false);
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
    setHasSentIntroInModal(false);
  }, [candidate.id, candidate.user_id]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 15 || Math.abs(gestureState.dy) > 15;
      },
      onPanResponderGrant: () => {
        Keyboard.dismiss();
      },
      onPanResponderMove: (evt, gestureState) => {
        if (Math.abs(gestureState.dx) > 10 || Math.abs(gestureState.dy) > 10) {
          Keyboard.dismiss();
        }
        Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false })(evt, gestureState);
      },
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
    Keyboard.dismiss();
    Animated.timing(pan, {
      toValue: { x: windowWidth + 150, y: 0 },
      duration: 250,
      useNativeDriver: false,
    }).start(() => onLike());
  };

  const handlePassBtn = () => {
    Keyboard.dismiss();
    Animated.timing(pan, {
      toValue: { x: -windowWidth - 150, y: 0 },
      duration: 250,
      useNativeDriver: false,
    }).start(() => onPass());
  };

  const handleNextPhoto = () => {
    Keyboard.dismiss();
    if (photoIndex < photos.length - 1) {
      setPhotoIndex(photoIndex + 1);
      setImageError(false);
    }
  };

  const handlePrevPhoto = () => {
    Keyboard.dismiss();
    if (photoIndex > 0) {
      setPhotoIndex(photoIndex - 1);
      setImageError(false);
    }
  };

  const handleOpenDetails = () => {
    Keyboard.dismiss();
    if (onPressProfile) {
      onPressProfile();
    } else {
      setShowDetailsModal(true);
    }
  };

  const handleCloseModal = () => {
    setShowDetailsModal(false);
    if (hasSentIntroInModal) {
      onLike();
    }
  };

  const handleSendIntroFromModal = async (note: string) => {
    if (messageQuota && !messageQuota.is_unlimited && messageQuota.is_locked) {
      if (onQuotaPress) onQuotaPress();
      throw new Error('DISCOVERY_MESSAGE_QUOTA_LOCKED');
    }

    try {
      if (onSendIntroNote) {
        await onSendIntroNote(note);
      } else {
        await discoveryService.swipe(candidate.user_id, 'LIKE', note);
      }

      setHasSentIntroInModal(true);

      if (onQuotaUpdated) {
        try {
          const updated = await discoveryService.getMessagingQuota();
          onQuotaUpdated(updated);
          if (updated && !updated.is_unlimited && updated.is_locked && onQuotaPress) {
            onQuotaPress();
          }
        } catch {
          // non-blocking
        }
      }

      Alert.alert(
        'Intro Note Sent',
        `Your message request was delivered to ${candidate.display_name}. When they like you back, you'll be connected in Chat.`
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes('DISCOVERY_MESSAGE_QUOTA_LOCKED') ||
        errMsg.includes('USAGE_LIMIT_REACHED') ||
        errMsg.includes('usage limit') ||
        errMsg.includes('cooldown is active') ||
        errMsg.includes('quota exhausted')
      ) {
        if (onQuotaPress) onQuotaPress();
        if (onQuotaUpdated) {
          discoveryService.getMessagingQuota().then(onQuotaUpdated).catch(() => {});
        }
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

  const renderProfileDetailsModal = () => (
    <Modal
      visible={showDetailsModal}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCloseModal}
      testID="profile-details-modal"
    >
      <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
        <KeyboardAvoidingView
          style={styles.modalKeyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Modal Header */}
          <View style={[styles.modalHeader, { borderBottomColor: colors.borderSubtle }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Profile Details</Text>
            <TouchableOpacity
              style={[styles.modalCloseBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={handleCloseModal}
              activeOpacity={0.7}
              testID="modal-close-btn"
              accessibilityRole="button"
              accessibilityLabel="Close profile details"
            >
              <Text style={[styles.modalCloseText, { color: colors.textMuted }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Scrollable Profile Content */}
          <ScrollView
            style={styles.modalScrollFlex}
            contentContainerStyle={styles.modalScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Main Modal Image */}
            <View style={[styles.modalImageContainer, { backgroundColor: colors.card }]}>
              {photos[0]?.url ? (
                <Image source={{ uri: photos[0].url }} style={styles.modalImage} resizeMode="cover" />
              ) : (
                <View style={[styles.modalImage, styles.placeholderPhoto, { backgroundColor: colors.cardMuted }]}>
                  <Text style={[styles.placeholderMonogram, { color: colors.gold }]}>
                    {candidate.display_name ? candidate.display_name.charAt(0).toUpperCase() : 'A'}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.modalBody}>
              <View style={styles.modalNameRow}>
                <Text style={[styles.modalName, { color: colors.text }]}>{candidate.display_name},</Text>
                <Text style={[styles.modalAge, { color: colors.gold }]}> {candidate.age}</Text>
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
              <View style={[styles.modalSection, { borderTopColor: colors.borderSubtle }]}>
                <Text style={[styles.modalSectionTitle, { color: colors.gold }]}>About</Text>
                <Text style={[styles.modalBioText, { color: colors.text }]}>
                  {candidate.bio || 'This member has not written a bio yet.'}
                </Text>
              </View>

              {/* Details & Lifestyle Section */}
              <View style={[styles.modalSection, { borderTopColor: colors.borderSubtle }]}>
                <Text style={[styles.modalSectionTitle, { color: colors.gold }]}>Details & Lifestyle</Text>
                <View style={styles.tagsRow}>
                  {candidate.compatibility_score > 0 && (
                    <View style={[styles.scoreTag, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]}>
                      <Text style={[styles.scoreTagText, { color: colors.gold }]}>★ {candidate.compatibility_score}% Compatibility</Text>
                    </View>
                  )}
                  {Boolean(candidate.height_cm) && (
                    <View style={[styles.tag, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
                      <Text style={[styles.tagText, { color: colors.textMuted }]}>📏 {candidate.height_cm} cm</Text>
                    </View>
                  )}
                  {Boolean(candidate.weight_kg) && (
                    <View style={[styles.tag, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
                      <Text style={[styles.tagText, { color: colors.textMuted }]}>⚖️ {candidate.weight_kg} kg</Text>
                    </View>
                  )}
                  {candidate.pronouns && candidate.pronouns.length > 0 && (
                    <View style={[styles.tag, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
                      <Text style={[styles.tagText, { color: colors.textMuted }]}>{candidate.pronouns.join('/')}</Text>
                    </View>
                  )}
                  {candidate.gender_identities && candidate.gender_identities.length > 0 && (
                    <View style={[styles.tag, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
                      <Text style={[styles.tagText, { color: colors.textMuted }]}>{candidate.gender_identities.join(', ')}</Text>
                    </View>
                  )}
                  {candidate.sexual_orientations && candidate.sexual_orientations.length > 0 && (
                    <View style={[styles.tag, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
                      <Text style={[styles.tagText, { color: colors.textMuted }]}>{candidate.sexual_orientations.join(', ')}</Text>
                    </View>
                  )}
                  {candidate.relationship_structure && (
                    <View style={[styles.tag, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
                      <Text style={[styles.tagText, { color: colors.textMuted }]}>🔗 {candidate.relationship_structure}</Text>
                    </View>
                  )}
                  {candidate.smoking_preference && (
                    <View
                      style={[
                        styles.tag,
                        { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                        candidate.smoking_preference === 'NON_SMOKER' ? styles.tagNonSmoker : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.tagText,
                          { color: colors.textMuted },
                          candidate.smoking_preference === 'NON_SMOKER' ? styles.tagTextNonSmoker : null,
                        ]}
                      >
                        🚭 {candidate.smoking_preference === 'NON_SMOKER' ? 'Non-smoker' : 'Smoker'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Gallery / More Photos Grid */}
              {photos.length > 1 && (
                <View style={[styles.modalSection, { borderTopColor: colors.borderSubtle }]}>
                  <Text style={[styles.modalSectionTitle, { color: colors.gold }]}>Gallery</Text>
                  <View style={styles.modalPhotosGrid}>
                    {photos.slice(1).map((p, idx) => (
                      <View key={p.id || idx} style={[styles.galleryItem, { backgroundColor: colors.cardElevated }]}>
                        <Image source={{ uri: p.url }} style={styles.modalGridPhoto} resizeMode="cover" />
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          </ScrollView>

          {/* Fixed Bottom Footer: Message Composer + Action Controls */}
          <View style={[styles.modalFooterContainer, { backgroundColor: colors.card, borderTopColor: colors.borderSubtle }]}>
            {/* Intro Message Composer */}
            <View style={styles.modalComposerWrapper}>
              <QuickMessageComposer
                recipientId={candidate.user_id || candidate.id}
                recipientName={candidate.display_name}
                placeholder="Write an intro message..."
                quota={messageQuota}
                onQuotaPress={onQuotaPress}
                inputTestID={`modal-quick-message-input-${candidate.user_id || candidate.id}`}
                sendBtnTestID={`modal-quick-message-send-btn-${candidate.user_id || candidate.id}`}
                onSend={handleSendIntroFromModal}
                containerStyle={styles.modalComposerContainer}
              />
            </View>

            {/* Modal Action Controls (✕, ★, ♥) */}
            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.passBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}
                onPress={() => {
                  setShowDetailsModal(false);
                  onPass();
                }}
                activeOpacity={0.8}
                testID="modal-pass-btn"
                accessibilityLabel="Pass"
                accessibilityRole="button"
              >
                <Text style={[styles.passIcon, { color: colors.textMuted }]}>✕</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, styles.superSparkBtn, { backgroundColor: colors.cardElevated, borderColor: colors.gold }]}
                onPress={() => {
                  setShowDetailsModal(false);
                  onSuperSpark();
                }}
                activeOpacity={0.8}
                testID="modal-superspark-btn"
                accessibilityLabel="Super Spark"
                accessibilityRole="button"
              >
                <Text style={[styles.superSparkIcon, { color: colors.gold }]}>★</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  styles.likeBtn,
                  { backgroundColor: colors.cardElevated, borderColor: colors.like || colors.gold, shadowColor: colors.like || colors.gold },
                ]}
                onPress={() => {
                  setShowDetailsModal(false);
                  onLike();
                }}
                activeOpacity={0.8}
                testID="modal-like-btn"
                accessibilityLabel="Like"
                accessibilityRole="button"
              >
                <Text style={[styles.likeIcon, { color: colors.like || '#FF6584' }]}>♥</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );

  if (layout === 'double') {
    const doubleCardWidth = Math.floor((windowWidth - spacing.md * 2 - spacing.sm) / 2);
    const doublePhotoHeight = Math.min(doubleCardWidth * 1.25, 210);

    return (
      <View style={[styles.doubleCardWrapper, { width: doubleCardWidth }]}>
        <TouchableOpacity
          style={[styles.doubleCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          activeOpacity={0.88}
          onPress={handleOpenDetails}
          testID={`discovery-double-card-${candidate.user_id || candidate.id}`}
        >
          {/* Photo Container */}
          <View style={[styles.doublePhotoContainer, { height: doublePhotoHeight, backgroundColor: colors.backgroundElevated }]}>
            {currentPhoto.url && !imageError ? (
              <Image
                source={{ uri: currentPhoto.url }}
                style={styles.doublePhoto}
                resizeMode="cover"
                onError={() => setImageError(true)}
              />
            ) : (
              <View style={[styles.doublePlaceholderPhoto, { backgroundColor: colors.cardMuted }]}>
                <Text style={[styles.doublePlaceholderMonogram, { color: colors.gold }]}>
                  {candidate.display_name ? candidate.display_name.charAt(0).toUpperCase() : 'A'}
                </Text>
              </View>
            )}

            {/* Top Badges */}
            <View style={styles.doubleTopBadgesRow} pointerEvents="none">
              {/* Online Indicator */}
              <View style={styles.doubleOnlineBadge}>
                <View style={[styles.doubleOnlineDot, { backgroundColor: colors.emerald || '#10B981' }]} />
                <Text style={styles.doubleOnlineText}>Active</Text>
              </View>

              {/* 18+ Verified Badge */}
              {candidate.is_verified && (
                <View
                  style={[
                    styles.doubleVerifiedPill,
                    {
                      backgroundColor: colors.emeraldMuted || 'rgba(16, 185, 129, 0.15)',
                      borderColor: colors.emerald || '#10B981',
                    },
                  ]}
                >
                  <Text style={[styles.doubleVerifiedText, { color: colors.emerald || '#10B981' }]}>✓ 18+</Text>
                </View>
              )}
            </View>

            {/* Distance Overlay at bottom of photo */}
            {candidate.distance_bucket_km > 0 && (
              <View style={styles.doubleBottomBadge}>
                <Text style={styles.doubleBottomBadgeText}>📍 {candidate.distance_bucket_km} km</Text>
              </View>
            )}
          </View>

          {/* Details Section */}
          <View style={styles.doubleDetails}>
            <TouchableOpacity
              style={styles.doubleNameRow}
              onPress={handleOpenDetails}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              testID={`discovery-double-name-${candidate.user_id || candidate.id}`}
              accessibilityRole="button"
              accessibilityLabel={`View details for ${candidate.display_name}`}
            >
              <Text style={[styles.doubleName, { color: colors.text }]} numberOfLines={1}>
                {candidate.display_name}
              </Text>
              <Text style={[styles.doubleAge, { color: colors.gold }]}> {candidate.age}</Text>
            </TouchableOpacity>

            {/* Compatibility or Pronouns/Bio */}
            {candidate.compatibility_score > 0 ? (
              <Text style={[styles.doubleScoreText, { color: colors.gold }]} numberOfLines={1}>
                ★ {candidate.compatibility_score}% Compatibility
              </Text>
            ) : candidate.pronouns && candidate.pronouns.length > 0 ? (
              <Text style={[styles.doubleSubtitle, { color: colors.textMuted }]} numberOfLines={1}>
                {candidate.pronouns.join('/')}
              </Text>
            ) : candidate.bio ? (
              <Text style={[styles.doubleSubtitle, { color: colors.textMuted }]} numberOfLines={1}>
                {candidate.bio}
              </Text>
            ) : (
              <Text style={[styles.doubleSubtitle, { color: colors.textMuted }]} numberOfLines={1}>
                Aura Member
              </Text>
            )}

            {/* Compact Action Buttons */}
            <View style={[styles.doubleActionsRow, { borderTopColor: colors.borderSubtle }]}>
              <TouchableOpacity
                style={[
                  styles.doubleActionBtn,
                  styles.doublePassBtn,
                  { backgroundColor: colors.cardElevated, borderColor: colors.border },
                ]}
                onPress={onPass}
                activeOpacity={0.7}
                testID={`double-pass-${candidate.user_id || candidate.id}`}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Pass"
              >
                <Text style={[styles.doublePassIcon, { color: colors.textMuted }]}>✕</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.doubleActionBtn,
                  styles.doubleSuperSparkBtn,
                  { backgroundColor: colors.cardElevated, borderColor: colors.gold },
                ]}
                onPress={onSuperSpark}
                activeOpacity={0.7}
                testID={`double-superspark-${candidate.user_id || candidate.id}`}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Super Spark"
              >
                <Text style={[styles.doubleSuperSparkIcon, { color: colors.gold }]}>★</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.doubleActionBtn,
                  styles.doubleLikeBtn,
                  {
                    backgroundColor: colors.cardElevated,
                    borderColor: colors.like || colors.gold,
                  },
                ]}
                onPress={onLike}
                activeOpacity={0.7}
                testID={`double-like-${candidate.user_id || candidate.id}`}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Like"
              >
                <Text style={[styles.doubleLikeIcon, { color: colors.like || '#FF6584' }]}>♥</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>

        {/* Profile Details Modal */}
        {renderProfileDetailsModal()}
      </View>
    );
  }

  return (
    <View style={[styles.cardContainer, isKeyboardOpen && styles.cardContainerKeyboard]}>
      <Animated.View
        style={[
          styles.card,
          { width: cardWidth, backgroundColor: colors.card, borderColor: colors.border },
          isKeyboardOpen && styles.cardCompact,
          animatedCardStyle,
        ]}
        {...panResponder.panHandlers}
      >
        {/* Swipe Stamp: LIKE (Red stamp matching new red Like action) */}
        <Animated.View style={[styles.stampContainer, styles.likeStamp, { opacity: likeOpacity }]} pointerEvents="none">
          <Text style={styles.likeStampText}>LIKE</Text>
        </Animated.View>

        {/* Swipe Stamp: PASS */}
        <Animated.View style={[styles.stampContainer, styles.passStamp, { opacity: passOpacity }]} pointerEvents="none">
          <Text style={styles.passStampText}>PASS</Text>
        </Animated.View>

        {/* Main Photo Container */}
        <View style={[styles.photoContainer, { height: photoHeight, backgroundColor: colors.backgroundElevated }]}>
          {currentPhoto.url && !imageError ? (
            <Image
              source={{ uri: currentPhoto.url }}
              style={styles.photo}
              resizeMode="cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <View style={[styles.placeholderPhoto, { backgroundColor: colors.cardMuted }]}>
              <Text style={[styles.placeholderMonogram, { color: colors.gold }]}>{candidate.display_name.charAt(0)}</Text>
            </View>
          )}

          {/* Photo Pagination Bar */}
          {photos.length > 1 && (
            <View style={styles.paginationRow}>
              {photos.map((_, idx) => (
                <View
                  key={idx}
                  style={[styles.paginationDot, idx === photoIndex ? [styles.paginationDotActive, { backgroundColor: colors.gold }] : null]}
                />
              ))}
            </View>
          )}

          {/* Top Info Badges */}
          <View style={styles.topBadgesRow} pointerEvents="box-none">
            <View style={styles.badgeLeftGroup}>
              {/* Online Indicator */}
              <View style={styles.onlineBadge}>
                <View style={[styles.onlineDot, { backgroundColor: colors.emerald || '#10B981' }]} />
                <Text style={styles.onlineBadgeText}>Active</Text>
              </View>

              {candidate.distance_bucket_km > 0 ? (
                <View style={[styles.badgePill, { borderColor: colors.border }]}>
                  <Text style={styles.badgePillText}>📍 {candidate.distance_bucket_km} km away</Text>
                </View>
              ) : null}
            </View>

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
          <View style={[styles.infoOverlay, { borderTopColor: colors.borderSubtle }, isKeyboardOpen && styles.infoOverlayCompact]}>
            <View style={styles.nameHeaderRow}>
              <TouchableOpacity
                style={styles.nameAndAge}
                onPress={handleOpenDetails}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID={`discovery-card-name-${candidate.user_id || candidate.id}`}
                accessibilityRole="button"
                accessibilityLabel={`View details for ${candidate.display_name}`}
              >
                <Text style={[styles.name, { color: colors.text }, isKeyboardOpen && styles.nameCompact]} numberOfLines={1}>
                  {candidate.display_name}
                </Text>
                <Text style={[styles.age, { color: colors.gold }, isKeyboardOpen && styles.ageCompact]}> {candidate.age}</Text>
              </TouchableOpacity>

              {/* Info Button to Open Details Modal */}
              <TouchableOpacity
                style={[styles.infoBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}
                onPress={handleOpenDetails}
                activeOpacity={0.8}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                testID={`discovery-info-btn-${candidate.user_id || candidate.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Profile info for ${candidate.display_name}`}
              >
                <Text style={[styles.infoBtnText, { color: colors.gold }]}>ⓘ</Text>
              </TouchableOpacity>
            </View>

            {/* Tags & Lifestyle Pills */}
            <View style={styles.tagsRow}>
              {candidate.compatibility_score > 0 && (
                <View style={[styles.scoreTag, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]}>
                  <Text style={[styles.scoreTagText, { color: colors.gold }]}>★ {candidate.compatibility_score}% Compatibility</Text>
                </View>
              )}
              {Boolean(candidate.height_cm) && (
                <View style={[styles.tag, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
                  <Text style={[styles.tagText, { color: colors.textMuted }]}>📏 {candidate.height_cm} cm</Text>
                </View>
              )}
              {Boolean(candidate.weight_kg) && (
                <View style={[styles.tag, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
                  <Text style={[styles.tagText, { color: colors.textMuted }]}>⚖️ {candidate.weight_kg} kg</Text>
                </View>
              )}
              {candidate.pronouns && candidate.pronouns.length > 0 && (
                <View style={[styles.tag, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
                  <Text style={[styles.tagText, { color: colors.textMuted }]}>{candidate.pronouns.join('/')}</Text>
                </View>
              )}
              {candidate.smoking_preference && (
                <View
                  style={[
                    styles.tag,
                    { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                    candidate.smoking_preference === 'NON_SMOKER' ? styles.tagNonSmoker : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.tagText,
                      { color: colors.textMuted },
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
              <Text style={[styles.bio, { color: colors.textMuted }]} numberOfLines={isKeyboardOpen ? 1 : 2}>
                {candidate.bio}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Premium Rounded Action Buttons */}
        <View style={[styles.actionsBar, { backgroundColor: colors.card }, isKeyboardOpen && styles.actionsBarCompact]}>
          {canRewind && onRewind && (
            <TouchableOpacity
              style={[
                styles.actionBtn,
                styles.rewindBtn,
                { backgroundColor: colors.card, borderColor: colors.gold },
                isKeyboardOpen && styles.rewindBtnCompact,
              ]}
              onPress={() => {
                Keyboard.dismiss();
                onRewind();
              }}
              activeOpacity={0.8}
            >
              <Text style={[styles.rewindIcon, { color: colors.gold }, isKeyboardOpen && styles.rewindIconCompact]}>↺</Text>
            </TouchableOpacity>
          )}

          {/* Pass Button: Charcoal round button with clear cross */}
          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.passBtn,
              { backgroundColor: colors.cardElevated, borderColor: colors.border },
              isKeyboardOpen && styles.passBtnCompact,
            ]}
            onPress={handlePassBtn}
            activeOpacity={0.8}
          >
            <Text style={[styles.passIcon, { color: colors.textMuted }, isKeyboardOpen && styles.passIconCompact]}>✕</Text>
          </TouchableOpacity>

          {/* Super Spark Button: Charcoal with gold star */}
          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.superSparkBtn,
              { backgroundColor: colors.cardElevated, borderColor: colors.gold },
              isKeyboardOpen && styles.superSparkBtnCompact,
            ]}
            onPress={() => {
              Keyboard.dismiss();
              onSuperSpark();
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.superSparkIcon, { color: colors.gold }, isKeyboardOpen && styles.superSparkIconCompact]}>★</Text>
          </TouchableOpacity>

          {/* Like Button: Red Like Button with heart */}
          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.likeBtn,
              {
                backgroundColor: colors.cardElevated,
                borderColor: colors.like || colors.gold,
                shadowColor: colors.like || colors.gold,
              },
              isKeyboardOpen && styles.likeBtnCompact,
            ]}
            onPress={handleLikeBtn}
            activeOpacity={0.8}
          >
            <Text style={[styles.likeIcon, { color: colors.like || '#FF6584' }, isKeyboardOpen && styles.likeIconCompact]}>♥</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* Profile Details Modal */}
      {renderProfileDetailsModal()}
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
    backgroundColor: '#1D202B',
    borderWidth: 1.5,
    borderColor: colors.gold,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  likeIcon: {
    fontSize: 24,
    color: '#FF6584', // Warm coral/rose heart on charcoal with gold border
    fontWeight: '700',
  },
  infoOverlayCompact: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  nameCompact: {
    fontSize: 18,
  },
  ageCompact: {
    fontSize: 16,
  },
  cardContainerKeyboard: {
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  cardCompact: {
    borderRadius: 18,
  },
  actionsBarCompact: {
    paddingVertical: 3,
    gap: spacing.sm,
  },
  rewindBtnCompact: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  rewindIconCompact: {
    fontSize: 13,
  },
  passBtnCompact: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  passIconCompact: {
    fontSize: 17,
  },
  superSparkBtnCompact: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  superSparkIconCompact: {
    fontSize: 16,
  },
  likeBtnCompact: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  likeIconCompact: {
    fontSize: 19,
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
    borderColor: '#FF6584',
    transform: [{ rotate: '-18deg' }],
  },
  likeStampText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FF6584',
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
  galleryItem: {
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  modalKeyboardAvoid: {
    flex: 1,
  },
  modalScrollFlex: {
    flex: 1,
  },
  modalFooterContainer: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: 'rgba(9, 10, 14, 0.98)',
    paddingTop: spacing.xs,
    paddingBottom: Platform.OS === 'ios' ? spacing.md : spacing.xs,
    paddingHorizontal: spacing.sm,
    width: '100%',
  },
  modalComposerWrapper: {
    width: '100%',
    marginBottom: spacing.xs,
  },
  modalComposerContainer: {
    width: '100%',
  },
  modalActionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: 2,
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
  badgeLeftGroup: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(9, 10, 14, 0.72)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    gap: 4,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  onlineBadgeText: {
    ...typography.caption,
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  doubleCardWrapper: {
    marginBottom: spacing.md,
  },
  doubleCard: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  doublePhotoContainer: {
    width: '100%',
    position: 'relative',
  },
  doublePhoto: {
    width: '100%',
    height: '100%',
  },
  doublePlaceholderPhoto: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  doublePlaceholderMonogram: {
    fontSize: 42,
    fontWeight: '700',
  },
  doubleTopBadgesRow: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 5,
  },
  doubleOnlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(9, 10, 14, 0.72)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    gap: 4,
  },
  doubleOnlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  doubleOnlineText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  doubleVerifiedPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  doubleVerifiedText: {
    fontSize: 10,
    fontWeight: '700',
  },
  doubleBottomBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(9, 10, 14, 0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  doubleBottomBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
  },
  doubleDetails: {
    padding: 8,
  },
  doubleNameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  doubleName: {
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  doubleAge: {
    fontSize: 13,
    fontWeight: '700',
  },
  doubleScoreText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  doubleSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  doubleActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
  },
  doubleActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  doublePassBtn: {},
  doubleSuperSparkBtn: {},
  doubleLikeBtn: {},
  doublePassIcon: {
    fontSize: 13,
    fontWeight: '700',
  },
  doubleSuperSparkIcon: {
    fontSize: 13,
  },
  doubleLikeIcon: {
    fontSize: 15,
  },
});

