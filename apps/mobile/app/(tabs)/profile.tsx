import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
  Switch,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, typography, spacing, borderRadius, useTheme } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';
import { mediaUploader } from '../../src/services/media/mediaUploader';
import { authService } from '../../src/services/auth/authService';
import { discoveryService } from '../../src/services/discovery/discoveryService';
import { SmokingPreference, ProfilePhoto } from '../../src/types';
import {
  GENDER_IDENTITY_OPTIONS,
  LOOKING_FOR_OPTIONS,
  SEXUAL_ORIENTATION_OPTIONS,
} from '../(auth)/register';

function parseInitialTaxonomy(items?: string[]): { selected: string[]; customText: string } {
  if (!items || items.length === 0) return { selected: [], customText: '' };
  const selected: string[] = [];
  let customText = '';
  for (const item of items) {
    if (item.startsWith('custom:')) {
      selected.push('custom');
      customText = item.slice(7);
    } else if (item === 'custom') {
      selected.push('custom');
    } else {
      selected.push(item);
    }
  }
  return { selected, customText };
}

function buildFinalList(selected: string[], customText: string): string[] {
  const list = selected.filter((item) => item !== 'custom');
  if (selected.includes('custom')) {
    const trimmed = customText.trim().toLowerCase();
    if (trimmed) {
      list.push(trimmed.startsWith('custom:') ? trimmed : `custom:${trimmed}`);
    } else {
      list.push('custom');
    }
  }
  return list;
}

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();
  const { themeId, setTheme, themes, colors } = useTheme();

  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [smokingPref, setSmokingPref] = useState<SmokingPreference>(profile?.smoking_preference || 'NON_SMOKER');
  const [nonSmokerDealbreaker, setNonSmokerDealbreaker] = useState<boolean>(profile?.non_smoker_dealbreaker ?? true);

  // 1. I am a — Gender identity
  const [selectedGenders, setSelectedGenders] = useState<string[]>([]);
  const [customGenderText, setCustomGenderText] = useState('');

  // 2. Looking for — Gender preferences
  const [selectedLookingFor, setSelectedLookingFor] = useState<string[]>([]);
  const [customLookingForText, setCustomLookingForText] = useState('');

  // 3. Sexual orientation
  const [selectedOrientations, setSelectedOrientations] = useState<string[]>([]);
  const [customOrientationText, setCustomOrientationText] = useState('');

  // Physical Attributes (Required for Discovery completion)
  const [heightUnit, setHeightUnit] = useState<'metric' | 'imperial'>('metric');
  const [weightUnit, setWeightUnit] = useState<'metric' | 'imperial'>('metric');
  const [heightCmInput, setHeightCmInput] = useState('');
  const [heightFtInput, setHeightFtInput] = useState('');
  const [heightInInput, setHeightInInput] = useState('');
  const [weightKgInput, setWeightKgInput] = useState('');
  const [weightLbInput, setWeightLbInput] = useState('');
  const [heightVisibility, setHeightVisibility] = useState<'PUBLIC' | 'MATCHES_ONLY' | 'HIDDEN'>('PUBLIC');
  const [weightVisibility, setWeightVisibility] = useState<'PUBLIC' | 'MATCHES_ONLY' | 'HIDDEN'>('PUBLIC');
  const [heightError, setHeightError] = useState<string | null>(null);
  const [weightError, setWeightError] = useState<string | null>(null);

  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [galleryPhotos, setGalleryPhotos] = useState<ProfilePhoto[]>([]);
  const [isLoadingGallery, setIsLoadingGallery] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);

  const loadGallery = useCallback(async () => {
    setIsLoadingGallery(true);
    setGalleryError(null);
    try {
      const photos = await mediaUploader.getMyGallery(true);
      setGalleryPhotos(photos);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not load gallery photos.';
      setGalleryError(msg);
    } finally {
      setIsLoadingGallery(false);
    }
  }, []);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  useEffect(() => {
    loadGallery();
  }, [loadGallery]);

  useEffect(() => {
    if (profile?.photos && profile.photos.length > 0 && galleryPhotos.length === 0) {
      setGalleryPhotos(profile.photos);
    }
  }, [profile?.photos, galleryPhotos.length]);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name || '');
      setBio(profile.bio || '');
      setSmokingPref(profile.smoking_preference || 'NON_SMOKER');
      setNonSmokerDealbreaker(profile.non_smoker_dealbreaker ?? true);

      const parsedGenders = parseInitialTaxonomy(profile.gender_identities);
      setSelectedGenders(parsedGenders.selected);
      setCustomGenderText(parsedGenders.customText);

      const lookingList = profile.preferred_genders || profile.looking_for;
      const parsedLooking = parseInitialTaxonomy(lookingList);
      setSelectedLookingFor(parsedLooking.selected);
      setCustomLookingForText(parsedLooking.customText);

      const parsedOrientations = parseInitialTaxonomy(profile.sexual_orientations);
      setSelectedOrientations(parsedOrientations.selected);
      setCustomOrientationText(parsedOrientations.customText);

      if (profile.height_cm) {
        setHeightCmInput(String(profile.height_cm));
        const totalInches = Math.round(profile.height_cm / 2.54);
        const ft = Math.floor(totalInches / 12);
        const inch = totalInches % 12;
        setHeightFtInput(String(ft));
        setHeightInInput(String(inch));
      }
      if (profile.weight_kg) {
        setWeightKgInput(String(profile.weight_kg));
        setWeightLbInput(String(Math.round(profile.weight_kg * 2.20462)));
      }
      if (profile.visibility_settings?.height) {
        setHeightVisibility(profile.visibility_settings.height as any);
      }
      if (profile.visibility_settings?.weight) {
        setWeightVisibility(profile.visibility_settings.weight as any);
      }
    }
  }, [profile]);

  const toggleGender = (g: string) => {
    setSelectedGenders((prev) =>
      prev.includes(g) ? prev.filter((item) => item !== g) : [...prev, g]
    );
  };

  const toggleLookingFor = (item: string) => {
    setSelectedLookingFor((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
  };

  const toggleOrientation = (o: string) => {
    setSelectedOrientations((prev) =>
      prev.includes(o) ? prev.filter((item) => item !== o) : [...prev, o]
    );
  };

  const handleCheckVerificationStatus = async () => {
    try {
      const statusRes = await authService.getAgeAssuranceStatus();
      if (statusRes?.status === 'VERIFIED') {
        await refreshProfile();
        Alert.alert(
          'Age Verified',
          'Your 18+ age verification is approved! Likes, mutual matching, and messaging are now fully unlocked.'
        );
      } else if (statusRes?.status === 'REJECTED') {
        Alert.alert(
          'Verification Rejected',
          'We were unable to verify your age with the submitted selfie. Please retake your verification selfie.',
          [
            { text: 'Retake Selfie', onPress: () => router.push('/(auth)/verify-age') },
            { text: 'Dismiss', style: 'cancel' },
          ]
        );
      } else {
        Alert.alert(
          'Verification Pending',
          'Your age verification is currently being reviewed by our team. You can continue browsing profiles in the meantime.'
        );
      }
    } catch {
      Alert.alert('Status Check Failed', 'Could not reach verification service. Please try again.');
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    Alert.alert('Delete Photo', 'Are you sure you want to remove this photo from your gallery?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await mediaUploader.deletePhoto(photoId);
            await loadGallery();
            await refreshProfile();
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Could not delete photo. Please try again.';
            Alert.alert('Delete Failed', message);
          }
        },
      },
    ]);
  };

  const handleMovePhoto = async (fromIndex: number, toIndex: number) => {
    const currentList = galleryPhotos.length > 0 ? galleryPhotos : (profile?.photos || []);
    if (!currentList || toIndex < 0 || toIndex >= currentList.length) return;
    const reordered = [...currentList];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    const assetIds = reordered.map((p) => p.id).filter(Boolean);
    try {
      await mediaUploader.reorderGallery(assetIds);
      await loadGallery();
      await refreshProfile();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not reorder photos. Please try again.';
      Alert.alert('Reorder Failed', message);
    }
  };

  const handleAddPhoto = async () => {
    try {
      const picked = await mediaUploader.pickImageFromGallery();
      if (!picked) return;

      setIsUploadingPhoto(true);
      const uploaded = await mediaUploader.uploadProfilePhoto(picked.uri, (step) => {
        switch (step) {
          case 'STRIPPING_EXIF':
            setUploadProgressText('Stripping GPS & EXIF data...');
            break;
          case 'REQUESTING_INTENT':
            setUploadProgressText('Requesting upload session...');
            break;
          case 'UPLOADING':
            setUploadProgressText('Uploading photo bytes...');
            break;
          case 'PROCESSING':
            setUploadProgressText('Automated safety & moderation scan...');
            break;
          case 'DONE':
            setUploadProgressText('Completed!');
            break;
        }
      });

      if (!uploaded || !uploaded.media_id || uploaded.status !== 'READY') {
        throw new Error('Photo processing timed out or failed to complete.');
      }

      await loadGallery();
      await refreshProfile();
      Alert.alert('Photo Uploaded', 'Your photo has been sanitized and added to your profile.');
    } catch (err: unknown) {
      if (__DEV__) {
        console.error('[ProfilePhotoUpload] Failed:', {
          errorName: err instanceof Error ? err.name : 'UnknownError',
          errorMessage: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
      const message = err instanceof Error ? err.message : 'Could not upload photo.';
      Alert.alert('Upload Failed', message);
    } finally {
      setIsUploadingPhoto(false);
      setUploadProgressText('');
    }
  };

  const handleSaveChanges = async () => {
    const finalGenders = buildFinalList(selectedGenders, customGenderText);
    const finalLookingFor = buildFinalList(selectedLookingFor, customLookingForText);
    const finalOrientations = buildFinalList(selectedOrientations, customOrientationText);

    if (finalGenders.length === 0) {
      Alert.alert('Gender Identity Required', 'Please select at least one gender identity under "I am a".');
      return;
    }
    if (finalLookingFor.length === 0) {
      Alert.alert('Gender Preference Required', 'Please select who you are looking for under "Looking for".');
      return;
    }
    if (finalOrientations.length === 0) {
      Alert.alert('Sexual Orientation Required', 'Please select at least one sexual orientation.');
      return;
    }
    // Validate Height (90-250 cm)
    let finalHeightCm: number | undefined;
    if (heightUnit === 'metric') {
      const parsed = parseInt(heightCmInput.trim(), 10);
      if (isNaN(parsed) || parsed < 90 || parsed > 250) {
        setHeightError('Height must be between 90 cm and 250 cm.');
        Alert.alert('Height Required', 'Height must be between 90 cm and 250 cm.');
        return;
      }
      finalHeightCm = parsed;
    } else {
      const ft = parseInt(heightFtInput.trim(), 10);
      const inch = parseInt(heightInInput.trim() || '0', 10);
      if (isNaN(ft) || ft < 3 || ft > 8 || isNaN(inch) || inch < 0 || inch >= 12) {
        setHeightError('Height must be between 3 ft 0 in and 8 ft 2 in.');
        Alert.alert('Height Required', 'Height must be between 3 ft 0 in and 8 ft 2 in.');
        return;
      }
      const totalInches = ft * 12 + inch;
      const converted = Math.round(totalInches * 2.54);
      if (converted < 90 || converted > 250) {
        setHeightError('Height must be between 90 cm (3\'0") and 250 cm (8\'2").');
        Alert.alert('Height Required', 'Height must be between 90 cm (3\'0") and 250 cm (8\'2").');
        return;
      }
      finalHeightCm = converted;
    }
    setHeightError(null);

    // Validate Weight (30-300 kg)
    let finalWeightKg: number | undefined;
    if (weightUnit === 'metric') {
      const parsed = parseInt(weightKgInput.trim(), 10);
      if (isNaN(parsed) || parsed < 30 || parsed > 300) {
        setWeightError('Weight must be between 30 kg and 300 kg.');
        Alert.alert('Weight Required', 'Weight must be between 30 kg and 300 kg.');
        return;
      }
      finalWeightKg = parsed;
    } else {
      const lb = parseInt(weightLbInput.trim(), 10);
      if (isNaN(lb) || lb < 66 || lb > 660) {
        setWeightError('Weight must be between 66 lb and 660 lb.');
        Alert.alert('Weight Required', 'Weight must be between 66 lb and 660 lb.');
        return;
      }
      finalWeightKg = Math.round(lb * 0.45359237);
    }
    setWeightError(null);

    setIsSaving(true);
    try {
      // 1. Update profile details on backend using exact DTO fields
      await authService.updateMyProfile({
        display_name: displayName.trim(),
        bio: bio.trim(),
        gender_identities: finalGenders,
        preferred_genders: finalLookingFor,
        looking_for: finalLookingFor,
        sexual_orientations: finalOrientations,
        smoking_habit: smokingPref,
        smoking_preference: smokingPref,
        height_cm: finalHeightCm,
        weight_kg: finalWeightKg,
        visibility_settings: {
          ...(profile?.visibility_settings || {}),
          height: heightVisibility,
          weight: weightVisibility,
        },
      });

      // 2. Update discovery preferences dealbreaker and preferred genders on backend
      await discoveryService.updatePreferences({
        preferred_genders: finalLookingFor,
        dealbreakers: {
          non_smoker_only: nonSmokerDealbreaker,
          require_verified: false,
          require_monogamous: false,
        },
      });

      // 3. Re-affirm active theme persistence
      try {
        await setTheme(themeId);
      } catch {
        // Handled
      }

      await refreshProfile();
      Alert.alert('Profile Saved', 'Your profile and discovery preferences have been updated.');
    } catch (err: unknown) {
      if (__DEV__) {
        console.error('[ProfileSave] Failed:', err);
      }
      const message = err instanceof Error ? err.message : 'Could not save profile changes.';
      Alert.alert('Save Failed', message);
    } finally {
      setIsSaving(false);
    }
  };

  const displayPhotos = galleryPhotos.length > 0 ? galleryPhotos : (profile?.photos || []);
  const primaryPhoto = displayPhotos[0]?.url;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Profile</Text>
          <Text style={[styles.subtitle, { color: colors.gold }]}>Identity & Preferences</Text>
        </View>
        <TouchableOpacity
          style={[styles.saveHeaderBtn, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]}
          onPress={handleSaveChanges}
          disabled={isSaving}
          activeOpacity={0.8}
        >
          {isSaving ? (
            <ActivityIndicator color={colors.gold} size="small" />
          ) : (
            <Text style={[styles.saveHeaderBtnText, { color: colors.gold }]}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Luxury Profile Header Card */}
        <View style={[styles.profileHeaderCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.avatarWrap, { borderColor: colors.gold }]}>
            {primaryPhoto ? (
              <Image source={{ uri: primaryPhoto }} style={styles.avatarImage} />
            ) : (
              <View style={[styles.avatarImage, styles.avatarPlaceholder, { backgroundColor: colors.cardElevated }]}>
                <Text style={[styles.avatarMonogram, { color: colors.gold }]}>
                  {profile?.display_name ? profile.display_name.charAt(0) : 'A'}
                </Text>
              </View>
            )}
            {profile?.is_photo_verified && (
              <View style={styles.verifiedDot}>
                <Text style={styles.verifiedDotText}>✓</Text>
              </View>
            )}
          </View>

          <View style={styles.headerInfo}>
            <View style={styles.headerNameRow}>
              <Text style={[styles.headerName, { color: colors.text }]}>{profile?.display_name || 'Member'}</Text>
              {profile?.age ? <Text style={[styles.headerAge, { color: colors.gold }]}>, {profile.age}</Text> : null}
            </View>
            <View style={styles.badgesRow}>
              {profile?.is_age_verified ? (
                <View style={styles.verifiedBadge}>
                  <Text style={styles.verifiedBadgeText}>✓ 18+ Verified</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.unverifiedBadge}
                  onPress={() => router.push('/(auth)/verify-age')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.unverifiedBadgeText}>Age Pending</Text>
                </TouchableOpacity>
              )}
              {profile?.is_photo_verified ? (
                <View style={styles.photoVerifiedBadge}>
                  <Text style={styles.photoVerifiedBadgeText}>✓ Photo Verified</Text>
                </View>
              ) : (
                <View style={styles.photoPendingBadge}>
                  <Text style={styles.photoPendingBadgeText}>Photo Unverified</Text>
                </View>
              )}
              <View style={[styles.locationBadge, { backgroundColor: colors.cardElevated, borderColor: colors.borderSubtle }]}>
                <Text style={[styles.locationBadgeText, { color: colors.textMuted }]}>
                  📍 {profile?.city || 'Local Member'}
                </Text>
              </View>
              {Boolean(profile?.height_cm && profile?.weight_kg) ? (
                <View style={styles.completedBadge}>
                  <Text style={styles.completedBadgeText}>✨ Complete</Text>
                </View>
              ) : (
                <View style={styles.incompleteBadge}>
                  <Text style={styles.incompleteBadgeText}>⚠️ Incomplete</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Discovery Incomplete Notice Banner */}
        {(!profile?.height_cm || !profile?.weight_kg) && (
          <View style={styles.incompleteNoticeBanner}>
            <Text style={styles.incompleteNoticeIcon}>⚠️</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.incompleteNoticeTitle}>Height & Weight Required for Discovery</Text>
              <Text style={styles.incompleteNoticeText}>
                Your profile is not yet eligible for Discovery matching. Please enter your height and weight below to activate your account in member feeds.
              </Text>
            </View>
          </View>
        )}

        {/* Photo Gallery Grid */}
        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Profile Gallery</Text>
            <Text style={[styles.photoCountText, { color: colors.gold }]}>
              {displayPhotos.length}/6 Photos
            </Text>
          </View>
          <Text style={styles.sectionDesc}>
            GPS and camera metadata are automatically stripped before upload.
          </Text>

          {isLoadingGallery && displayPhotos.length === 0 ? (
            <View style={styles.galleryStatusBox}>
              <ActivityIndicator color={colors.gold} size="small" />
              <Text style={styles.galleryStatusText}>Loading gallery photos...</Text>
            </View>
          ) : galleryError && displayPhotos.length === 0 ? (
            <View style={styles.galleryStatusBox}>
              <Text style={styles.galleryErrorText}>{galleryError}</Text>
              <TouchableOpacity style={[styles.retryGalleryBtn, { backgroundColor: colors.card, borderColor: colors.gold }]} onPress={loadGallery} activeOpacity={0.8}>
                <Text style={[styles.retryGalleryBtnText, { color: colors.gold }]}>Retry Loading Photos</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.photosGrid}>
              {displayPhotos.map((photo, index) => (
                <View key={photo.id || index} style={[styles.photoWrap, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
                  <Image source={{ uri: photo.url }} style={styles.gridPhoto} />
                  {photo.is_primary && (
                    <View style={[styles.primaryBadge, { backgroundColor: colors.gold }]}>
                      <Text style={[styles.primaryBadgeText, { color: colors.textInverse }]}>Primary</Text>
                    </View>
                  )}

                  {/* Delete Button */}
                  <TouchableOpacity
                    style={styles.deletePhotoBtn}
                    onPress={() => handleDeletePhoto(photo.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.deletePhotoBtnText}>✕</Text>
                  </TouchableOpacity>

                  {/* Reorder Arrows */}
                  <View style={styles.reorderControls}>
                    {index > 0 && (
                      <TouchableOpacity
                        style={styles.moveBtn}
                        onPress={() => handleMovePhoto(index, index - 1)}
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.moveBtnText, { color: colors.gold }]}>◀</Text>
                      </TouchableOpacity>
                    )}
                    {index < displayPhotos.length - 1 && (
                      <TouchableOpacity
                        style={styles.moveBtn}
                        onPress={() => handleMovePhoto(index, index + 1)}
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.moveBtnText, { color: colors.gold }]}>▶</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}

              {/* Add Photo Button Slot */}
              {displayPhotos.length < 6 && (
                <TouchableOpacity
                  style={[styles.addPhotoBtn, { borderColor: colors.gold, backgroundColor: colors.goldMuted }]}
                  onPress={handleAddPhoto}
                  disabled={isUploadingPhoto}
                  activeOpacity={0.8}
                >
                  {isUploadingPhoto ? (
                    <View style={styles.uploadingBox}>
                      <ActivityIndicator color={colors.gold} size="small" />
                      <Text style={[styles.uploadingText, { color: colors.gold }]}>{uploadProgressText}</Text>
                    </View>
                  ) : (
                    <>
                      <View style={[styles.addIconCircle, { backgroundColor: colors.goldMuted }]}>
                        <Text style={[styles.addPhotoIcon, { color: colors.gold }]}>+</Text>
                      </View>
                      <Text style={[styles.addPhotoLabel, { color: colors.gold }]}>Add Photo</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Basic Details Section */}
        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>About You</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Display Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.backgroundElevated, borderColor: colors.border, color: colors.text }]}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your display name"
              placeholderTextColor={colors.textSubtle}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Bio</Text>
            <TextInput
              style={[styles.input, styles.bioInput, { backgroundColor: colors.backgroundElevated, borderColor: colors.border, color: colors.text }]}
              value={bio}
              onChangeText={setBio}
              placeholder="Tell other members what you are passionate about..."
              placeholderTextColor={colors.textSubtle}
              multiline
              numberOfLines={4}
            />
          </View>
        </View>

        {/* Physical Attributes Section (Required for Discovery) */}
        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Physical Attributes</Text>
            <View style={Boolean(profile?.height_cm && profile?.weight_kg) ? styles.completedBadge : styles.incompleteBadge}>
              <Text style={Boolean(profile?.height_cm && profile?.weight_kg) ? styles.completedBadgeText : styles.incompleteBadgeText}>
                {Boolean(profile?.height_cm && profile?.weight_kg) ? '✓ Completed' : 'Required'}
              </Text>
            </View>
          </View>
          <Text style={styles.sectionDesc}>
            Height and weight are required before your profile can appear in Discovery. Choose your preferred display units and card privacy.
          </Text>

          {/* Height Input */}
          <View style={styles.inputGroup}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.inputLabel}>Height (90–250 cm)</Text>
              <View style={[styles.unitToggleGroup, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
                <TouchableOpacity
                  style={[styles.unitToggleBtn, heightUnit === 'metric' && [styles.unitToggleBtnActive, { backgroundColor: colors.gold }]]}
                  onPress={() => {
                    setHeightUnit('metric');
                    if (!heightCmInput && heightFtInput) {
                      const ft = parseInt(heightFtInput, 10) || 0;
                      const inc = parseInt(heightInInput, 10) || 0;
                      setHeightCmInput(String(Math.round((ft * 12 + inc) * 2.54)));
                    }
                  }}
                >
                  <Text style={[styles.unitToggleText, heightUnit === 'metric' && [styles.unitToggleTextActive, { color: colors.textInverse }]]}>cm</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.unitToggleBtn, heightUnit === 'imperial' && [styles.unitToggleBtnActive, { backgroundColor: colors.gold }]]}
                  onPress={() => {
                    setHeightUnit('imperial');
                    if (!heightFtInput && heightCmInput) {
                      const cm = parseInt(heightCmInput, 10) || 0;
                      const totalIn = Math.round(cm / 2.54);
                      setHeightFtInput(String(Math.floor(totalIn / 12)));
                      setHeightInInput(String(totalIn % 12));
                    }
                  }}
                >
                  <Text style={[styles.unitToggleText, heightUnit === 'imperial' && [styles.unitToggleTextActive, { color: colors.textInverse }]]}>ft / in</Text>
                </TouchableOpacity>
              </View>
            </View>

            {heightUnit === 'metric' ? (
              <View style={styles.numericInputWrapper}>
                <TextInput
                  style={[styles.input, styles.numericInput, { backgroundColor: colors.backgroundElevated, borderColor: colors.border, color: colors.text }, heightError ? styles.inputError : null]}
                  value={heightCmInput}
                  onChangeText={(val) => {
                    setHeightCmInput(val);
                    setHeightError(null);
                    const cm = parseInt(val, 10);
                    if (!isNaN(cm) && cm > 0) {
                      const totIn = Math.round(cm / 2.54);
                      setHeightFtInput(String(Math.floor(totIn / 12)));
                      setHeightInInput(String(totIn % 12));
                    }
                  }}
                  placeholder="175"
                  placeholderTextColor={colors.textSubtle}
                  keyboardType="numeric"
                  maxLength={3}
                />
                <Text style={styles.unitSuffix}>cm</Text>
              </View>
            ) : (
              <View style={styles.dualInputRow}>
                <View style={[styles.numericInputWrapper, { flex: 1 }]}>
                  <TextInput
                    style={[styles.input, styles.numericInput, { backgroundColor: colors.backgroundElevated, borderColor: colors.border, color: colors.text }, heightError ? styles.inputError : null]}
                    value={heightFtInput}
                    onChangeText={(val) => {
                      setHeightFtInput(val);
                      setHeightError(null);
                      const ft = parseInt(val, 10) || 0;
                      const inc = parseInt(heightInInput, 10) || 0;
                      if (ft > 0) setHeightCmInput(String(Math.round((ft * 12 + inc) * 2.54)));
                    }}
                    placeholder="5"
                    placeholderTextColor={colors.textSubtle}
                    keyboardType="numeric"
                    maxLength={1}
                  />
                  <Text style={styles.unitSuffix}>ft</Text>
                </View>
                <View style={[styles.numericInputWrapper, { flex: 1 }]}>
                  <TextInput
                    style={[styles.input, styles.numericInput, { backgroundColor: colors.backgroundElevated, borderColor: colors.border, color: colors.text }, heightError ? styles.inputError : null]}
                    value={heightInInput}
                    onChangeText={(val) => {
                      setHeightInInput(val);
                      setHeightError(null);
                      const ft = parseInt(heightFtInput, 10) || 0;
                      const inc = parseInt(val, 10) || 0;
                      if (ft > 0) setHeightCmInput(String(Math.round((ft * 12 + inc) * 2.54)));
                    }}
                    placeholder="9"
                    placeholderTextColor={colors.textSubtle}
                    keyboardType="numeric"
                    maxLength={2}
                  />
                  <Text style={styles.unitSuffix}>in</Text>
                </View>
              </View>
            )}

            {heightCmInput ? (
              <Text style={[styles.conversionHelper, { color: colors.gold }]}>
                ≈ {heightCmInput} cm ({heightFtInput || '0'}'{heightInInput || '0'}")
              </Text>
            ) : null}

            {heightError ? <Text style={styles.errorText}>{heightError}</Text> : null}

            <View style={[styles.visibilityRow, { backgroundColor: colors.backgroundElevated }]}>
              <Text style={styles.visibilityLabel}>Card Visibility:</Text>
              <View style={styles.visibilityPills}>
                {(['PUBLIC', 'MATCHES_ONLY', 'HIDDEN'] as const).map((vis) => (
                  <TouchableOpacity
                    key={vis}
                    style={[
                      styles.visPill,
                      { backgroundColor: colors.card, borderColor: colors.border },
                      heightVisibility === vis && [styles.visPillActive, { borderColor: colors.gold, backgroundColor: colors.goldMuted }],
                    ]}
                    onPress={() => setHeightVisibility(vis)}
                  >
                    <Text
                      style={[
                        styles.visPillText,
                        { color: colors.textMuted },
                        heightVisibility === vis && [styles.visPillTextActive, { color: colors.gold }],
                      ]}
                    >
                      {vis === 'PUBLIC' ? 'Public' : vis === 'MATCHES_ONLY' ? 'Matches Only' : 'Hidden'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {/* Weight Input */}
          <View style={styles.inputGroup}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.inputLabel}>Weight (30–300 kg)</Text>
              <View style={[styles.unitToggleGroup, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
                <TouchableOpacity
                  style={[styles.unitToggleBtn, weightUnit === 'metric' && [styles.unitToggleBtnActive, { backgroundColor: colors.gold }]]}
                  onPress={() => {
                    setWeightUnit('metric');
                    if (!weightKgInput && weightLbInput) {
                      const lb = parseInt(weightLbInput, 10) || 0;
                      setWeightKgInput(String(Math.round(lb * 0.45359237)));
                    }
                  }}
                >
                  <Text style={[styles.unitToggleText, weightUnit === 'metric' && [styles.unitToggleTextActive, { color: colors.textInverse }]]}>kg</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.unitToggleBtn, weightUnit === 'imperial' && [styles.unitToggleBtnActive, { backgroundColor: colors.gold }]]}
                  onPress={() => {
                    setWeightUnit('imperial');
                    if (!weightLbInput && weightKgInput) {
                      const kg = parseInt(weightKgInput, 10) || 0;
                      setWeightLbInput(String(Math.round(kg * 2.20462)));
                    }
                  }}
                >
                  <Text style={[styles.unitToggleText, weightUnit === 'imperial' && [styles.unitToggleTextActive, { color: colors.textInverse }]]}>lb</Text>
                </TouchableOpacity>
              </View>
            </View>

            {weightUnit === 'metric' ? (
              <View style={styles.numericInputWrapper}>
                <TextInput
                  style={[styles.input, styles.numericInput, { backgroundColor: colors.backgroundElevated, borderColor: colors.border, color: colors.text }, weightError ? styles.inputError : null]}
                  value={weightKgInput}
                  onChangeText={(val) => {
                    setWeightKgInput(val);
                    setWeightError(null);
                    const kg = parseInt(val, 10);
                    if (!isNaN(kg) && kg > 0) {
                      setWeightLbInput(String(Math.round(kg * 2.20462)));
                    }
                  }}
                  placeholder="70"
                  placeholderTextColor={colors.textSubtle}
                  keyboardType="numeric"
                  maxLength={3}
                />
                <Text style={styles.unitSuffix}>kg</Text>
              </View>
            ) : (
              <View style={styles.numericInputWrapper}>
                <TextInput
                  style={[styles.input, styles.numericInput, { backgroundColor: colors.backgroundElevated, borderColor: colors.border, color: colors.text }, weightError ? styles.inputError : null]}
                  value={weightLbInput}
                  onChangeText={(val) => {
                    setWeightLbInput(val);
                    setWeightError(null);
                    const lb = parseInt(val, 10);
                    if (!isNaN(lb) && lb > 0) {
                      setWeightKgInput(String(Math.round(lb * 0.45359237)));
                    }
                  }}
                  placeholder="154"
                  placeholderTextColor={colors.textSubtle}
                  keyboardType="numeric"
                  maxLength={3}
                />
                <Text style={styles.unitSuffix}>lb</Text>
              </View>
            )}

            {weightKgInput ? (
              <Text style={[styles.conversionHelper, { color: colors.gold }]}>
                ≈ {weightKgInput} kg (~{weightLbInput || '0'} lb)
              </Text>
            ) : null}

            {weightError ? <Text style={styles.errorText}>{weightError}</Text> : null}

            <View style={[styles.visibilityRow, { backgroundColor: colors.backgroundElevated }]}>
              <Text style={styles.visibilityLabel}>Card Visibility:</Text>
              <View style={styles.visibilityPills}>
                {(['PUBLIC', 'MATCHES_ONLY', 'HIDDEN'] as const).map((vis) => (
                  <TouchableOpacity
                    key={vis}
                    style={[
                      styles.visPill,
                      { backgroundColor: colors.card, borderColor: colors.border },
                      weightVisibility === vis && [styles.visPillActive, { borderColor: colors.gold, backgroundColor: colors.goldMuted }],
                    ]}
                    onPress={() => setWeightVisibility(vis)}
                  >
                    <Text
                      style={[
                        styles.visPillText,
                        { color: colors.textMuted },
                        weightVisibility === vis && [styles.visPillTextActive, { color: colors.gold }],
                      ]}
                    >
                      {vis === 'PUBLIC' ? 'Public' : vis === 'MATCHES_ONLY' ? 'Matches Only' : 'Hidden'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* Identity & Dating Preferences Section */}
        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Identity & Dating Preferences</Text>
          <Text style={styles.sectionDesc}>
            Customizable identity and preference settings used for discovery and matching.
          </Text>

          {/* SECTION 1: I am a — Gender identity */}
          <View style={styles.inputGroup}>
            <Text style={[styles.sectionHeaderLabel, { color: colors.text }]}>1. I am a — Gender identity</Text>
            <Text style={[styles.sectionSubLabel, { color: colors.gold }]}>Select all that apply</Text>
            <View style={styles.chipsRow}>
              {GENDER_IDENTITY_OPTIONS.map((g) => {
                const selected = selectedGenders.includes(g.value);
                return (
                  <TouchableOpacity
                    key={g.value}
                    style={[
                      styles.chip,
                      { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                      selected && [styles.chipSelected, { borderColor: colors.gold, backgroundColor: colors.goldMuted }],
                    ]}
                    onPress={() => toggleGender(g.value)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: colors.textMuted },
                        selected && [styles.chipTextSelected, { color: colors.gold }],
                      ]}
                    >
                      {g.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {selectedGenders.includes('custom') && (
              <TextInput
                style={[styles.input, styles.customInput, { backgroundColor: colors.backgroundElevated, borderColor: colors.border, color: colors.text }]}
                value={customGenderText}
                onChangeText={setCustomGenderText}
                placeholder="Enter your gender identity..."
                placeholderTextColor={colors.textSubtle}
                maxLength={40}
              />
            )}
          </View>

          {/* SECTION 2: Looking for — Gender preferences */}
          <View style={styles.inputGroup}>
            <Text style={[styles.sectionHeaderLabel, { color: colors.text }]}>2. Looking for — Gender preferences</Text>
            <Text style={[styles.sectionSubLabel, { color: colors.gold }]}>Select all that apply</Text>
            <View style={styles.chipsRow}>
              {LOOKING_FOR_OPTIONS.map((item) => {
                const selected = selectedLookingFor.includes(item.value);
                return (
                  <TouchableOpacity
                    key={item.value}
                    style={[
                      styles.chip,
                      { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                      selected && [styles.chipSelected, { borderColor: colors.gold, backgroundColor: colors.goldMuted }],
                    ]}
                    onPress={() => toggleLookingFor(item.value)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: colors.textMuted },
                        selected && [styles.chipTextSelected, { color: colors.gold }],
                      ]}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {selectedLookingFor.includes('custom') && (
              <TextInput
                style={[styles.input, styles.customInput, { backgroundColor: colors.backgroundElevated, borderColor: colors.border, color: colors.text }]}
                value={customLookingForText}
                onChangeText={setCustomLookingForText}
                placeholder="Enter gender preference..."
                placeholderTextColor={colors.textSubtle}
                maxLength={40}
              />
            )}
          </View>

          {/* SECTION 3: Sexual orientation */}
          <View style={styles.inputGroup}>
            <Text style={[styles.sectionHeaderLabel, { color: colors.text }]}>3. Sexual orientation</Text>
            <Text style={[styles.sectionSubLabel, { color: colors.gold }]}>Select all that apply</Text>
            <View style={styles.chipsRow}>
              {SEXUAL_ORIENTATION_OPTIONS.map((o) => {
                const selected = selectedOrientations.includes(o.value);
                return (
                  <TouchableOpacity
                    key={o.value}
                    style={[
                      styles.chip,
                      { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                      selected && [styles.chipSelected, { borderColor: colors.gold, backgroundColor: colors.goldMuted }],
                    ]}
                    onPress={() => toggleOrientation(o.value)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: colors.textMuted },
                        selected && [styles.chipTextSelected, { color: colors.gold }],
                      ]}
                    >
                      {o.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {selectedOrientations.includes('custom') && (
              <TextInput
                style={[styles.input, styles.customInput, { backgroundColor: colors.backgroundElevated, borderColor: colors.border, color: colors.text }]}
                value={customOrientationText}
                onChangeText={setCustomOrientationText}
                placeholder="Enter your sexual orientation..."
                placeholderTextColor={colors.textSubtle}
                maxLength={40}
              />
            )}
          </View>
        </View>

        {/* Lifestyle & Dealbreakers Section */}
        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Lifestyle & Dealbreakers</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Smoking Habit</Text>
            <View style={styles.chipsRow}>
              {(['NON_SMOKER', 'SOCIAL_SMOKER', 'REGULAR_SMOKER'] as SmokingPreference[]).map((pref) => {
                const isSelected = smokingPref === pref;
                const label =
                  pref === 'NON_SMOKER' ? 'Non-smoker' : pref === 'SOCIAL_SMOKER' ? 'Social smoker' : 'Regular smoker';
                return (
                  <TouchableOpacity
                    key={pref}
                    style={[
                      styles.chip,
                      { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                      isSelected && [styles.chipSelected, { borderColor: colors.gold, backgroundColor: colors.goldMuted }],
                    ]}
                    onPress={() => setSmokingPref(pref)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: colors.textMuted },
                        isSelected && [styles.chipTextSelected, { color: colors.gold }],
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Dealbreaker Switch */}
          <View style={[styles.switchRow, { borderTopColor: colors.borderSubtle }]}>
            <View style={styles.switchTextContainer}>
              <Text style={[styles.switchTitle, { color: colors.text }]}>Non-Smoker Dealbreaker</Text>
              <Text style={styles.switchDesc}>
                Strictly exclude smokers from your discovery deck. Aura never compromises this rule.
              </Text>
            </View>
            <Switch
              value={nonSmokerDealbreaker}
              onValueChange={setNonSmokerDealbreaker}
              trackColor={{ false: colors.border, true: colors.gold }}
              thumbColor={colors.text}
            />
          </View>
        </View>

        {/* App Appearance & Themes Section */}
        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>App Appearance & Theme</Text>
            <Text style={[styles.sectionSubtitle, { color: colors.gold }]}>5 Custom Palettes</Text>
          </View>
          <Text style={styles.themeSectionDesc}>
            Choose your signature Aura aesthetic. Themes switch reactively and persist across restarts.
          </Text>

          <View style={styles.themesList}>
            {themes.map((t) => {
              const isActive = themeId === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[
                    styles.themeCard,
                    { backgroundColor: colors.backgroundElevated, borderColor: isActive ? t.primaryColor : colors.border },
                    isActive && [styles.themeCardActive, { backgroundColor: colors.cardElevated }],
                  ]}
                  onPress={() => setTheme(t.id)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`Select theme ${t.name}`}
                  testID={`theme-option-${t.id}`}
                >
                  {/* Swatch & Emoji */}
                  <View style={[styles.themeSwatchContainer, { backgroundColor: t.backgroundColor }]}>
                    <View style={[styles.themeSwatchAccent, { backgroundColor: t.primaryColor }]}>
                      <Text style={styles.themeSwatchEmoji}>{t.badgeEmoji}</Text>
                    </View>
                    <View style={[styles.themeSwatchSecondary, { backgroundColor: t.secondaryColor }]} />
                  </View>

                  {/* Theme Info */}
                  <View style={styles.themeDetails}>
                    <View style={styles.themeNameRow}>
                      <Text style={[styles.themeName, { color: colors.text }, isActive && { color: t.primaryColor }]}>
                        {t.name}
                      </Text>
                      {isActive && (
                        <View style={[styles.activePill, { backgroundColor: t.primaryColor }]}>
                          <Text style={styles.activePillText}>Active ✓</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.themeTagline}>{t.tagline}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Security & Privacy Shortcut */}
        <TouchableOpacity
          style={[styles.securityCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push('/(tabs)/settings')}
          activeOpacity={0.8}
        >
          <View style={[styles.securityIconWrap, { backgroundColor: colors.cardElevated }]}>
            <Text style={styles.securityIcon}>🛡️</Text>
          </View>
          <View style={styles.securityInfo}>
            <Text style={[styles.securityTitle, { color: colors.text }]}>Privacy & Security Settings</Text>
            <Text style={styles.securityDesc}>
              Biometric lock, app switcher veil, notifications, and telemetry.
            </Text>
          </View>
          <Text style={[styles.securityChevron, { color: colors.gold }]}>➔</Text>
        </TouchableOpacity>

        {/* Mandatory Age Assurance Status */}
        <View style={[styles.verificationCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.verificationHeader}>
            <Text style={[styles.verificationTitle, { color: colors.text }]}>18+ Age Assurance (Mandatory)</Text>
            <View
              style={[
                styles.verBadge,
                profile?.is_age_verified ? styles.verBadgeVerified : styles.verBadgeUnverified,
              ]}
            >
              <Text
                style={[
                  styles.verBadgeText,
                  profile?.is_age_verified ? styles.verTextVerified : styles.verTextUnverified,
                ]}
              >
                {profile?.is_age_verified ? '✓ 18+ Verified' : 'Pending Verification'}
              </Text>
            </View>
          </View>
          <Text style={styles.verificationBody}>
            {profile?.is_age_verified
              ? 'Your account has passed mandatory 18+ verification. Discovery swiping and messaging are active.'
              : 'Mandatory 18+ verification is required before matching and messaging with other members.'}
          </Text>
          {!profile?.is_age_verified && (
            <TouchableOpacity
              style={[styles.verifyActionBtn, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]}
              onPress={() => router.push('/(auth)/verify-age')}
              activeOpacity={0.8}
            >
              <Text style={[styles.verifyActionBtnText, { color: colors.gold }]}>Complete Age Verification</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Photo Verification (Selfie) */}
        <View style={[styles.verificationCard, { marginTop: spacing.md, backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.verificationHeader}>
            <Text style={[styles.verificationTitle, { color: colors.text }]}>Photo Verification (Selfie)</Text>
            <View
              style={[
                styles.verBadge,
                profile?.is_photo_verified ? styles.verBadgeVerified : styles.verBadgeUnverified,
              ]}
            >
              <Text
                style={[
                  styles.verBadgeText,
                  profile?.is_photo_verified ? styles.verTextVerified : styles.verTextUnverified,
                ]}
              >
                {profile?.is_photo_verified ? '✓ Photo Verified' : 'Photo Unverified'}
              </Text>
            </View>
          </View>
          <Text style={styles.verificationBody}>
            {profile?.is_photo_verified
              ? 'Your photo verification selfie is approved. The verified member checkmark is active on your profile.'
              : 'Photo verification confirms authenticity with a private selfie. You can freely edit your profile while verification is pending.'}
          </Text>
          {!profile?.is_photo_verified && (
            <TouchableOpacity
              style={[styles.verifyActionBtn, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]}
              onPress={
                profile?.verification_status === 'PENDING'
                  ? handleCheckVerificationStatus
                  : () => router.push('/(auth)/verify-age')
              }
              activeOpacity={0.8}
            >
              <Text style={[styles.verifyActionBtnText, { color: colors.gold }]}>
                {profile?.verification_status === 'PENDING' ? 'Check Verification Status' : 'Take Verification Selfie'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    letterSpacing: 1,
  },
  subtitle: {
    ...typography.caption,
    color: colors.gold,
    letterSpacing: 0.8,
    marginTop: 2,
  },
  saveHeaderBtn: {
    backgroundColor: colors.goldMuted,
    borderWidth: 1,
    borderColor: colors.gold,
    paddingHorizontal: spacing.md + 4,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
  },
  saveHeaderBtnText: {
    ...typography.button,
    color: colors.gold,
    fontWeight: '700',
    fontSize: 12,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  profileHeaderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  avatarWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: colors.gold,
    position: 'relative',
    marginRight: spacing.md,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 32,
  },
  avatarPlaceholder: {
    backgroundColor: colors.cardElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarMonogram: {
    ...typography.h1,
    color: colors.gold,
    fontSize: 28,
  },
  verifiedDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.emerald,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  verifiedDotText: {
    fontSize: 10,
    color: colors.textInverse,
    fontWeight: '700',
  },
  headerInfo: {
    flex: 1,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  headerName: {
    ...typography.h2,
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  headerAge: {
    ...typography.h2,
    color: colors.gold,
    fontSize: 18,
  },
  badgesRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  verifiedBadge: {
    backgroundColor: colors.emeraldMuted,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.emerald,
  },
  verifiedBadgeText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.emerald,
    fontWeight: '700',
  },
  unverifiedBadge: {
    backgroundColor: colors.amberMuted,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.amber,
  },
  unverifiedBadgeText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.amber,
    fontWeight: '700',
  },
  photoVerifiedBadge: {
    backgroundColor: colors.emeraldMuted,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.emerald,
  },
  photoVerifiedBadgeText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.emerald,
    fontWeight: '700',
  },
  photoPendingBadge: {
    backgroundColor: 'rgba(212, 175, 55, 0.12)',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  photoPendingBadgeText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.gold,
    fontWeight: '600',
  },
  verifyActionBtn: {
    backgroundColor: colors.goldMuted,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: borderRadius.md,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  verifyActionBtnText: {
    ...typography.button,
    color: colors.gold,
    fontSize: 13,
  },
  locationBadge: {
    backgroundColor: colors.cardElevated,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  locationBadgeText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
  },
  sectionCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    fontSize: 16,
  },
  sectionSubtitle: {
    ...typography.caption,
    color: colors.gold,
    fontWeight: '600',
  },
  photoCountText: {
    ...typography.caption,
    color: colors.gold,
    fontWeight: '600',
  },
  sectionDesc: {
    ...typography.bodySmall,
    color: colors.textSubtle,
    fontSize: 11,
    marginBottom: spacing.md,
  },
  photosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  photoWrap: {
    width: 96,
    height: 126,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: colors.cardElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  gridPhoto: {
    width: '100%',
    height: '100%',
  },
  primaryBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: colors.gold,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  primaryBadgeText: {
    ...typography.caption,
    fontSize: 9,
    color: colors.textInverse,
    fontWeight: '700',
  },
  addPhotoBtn: {
    width: 96,
    height: 126,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.borderFocus,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(212, 175, 55, 0.04)',
  },
  addIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.goldMuted,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  addPhotoIcon: {
    fontSize: 20,
    color: colors.gold,
    fontWeight: '700',
  },
  addPhotoLabel: {
    ...typography.caption,
    fontSize: 10,
    color: colors.gold,
    fontWeight: '600',
  },
  uploadingBox: {
    alignItems: 'center',
    padding: 4,
  },
  uploadingText: {
    ...typography.caption,
    fontSize: 8,
    color: colors.gold,
    textAlign: 'center',
    marginTop: 4,
  },
  deletePhotoBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(9, 10, 14, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  deletePhotoBtnText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  reorderControls: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    flexDirection: 'row',
    gap: 3,
    zIndex: 10,
  },
  moveBtn: {
    width: 22,
    height: 20,
    borderRadius: 4,
    backgroundColor: 'rgba(9, 10, 14, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  moveBtnText: {
    color: colors.gold,
    fontSize: 10,
    fontWeight: '700',
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: 6,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeaderLabel: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  sectionSubLabel: {
    ...typography.caption,
    color: colors.gold,
    fontSize: 11,
    marginBottom: spacing.xs,
  },
  input: {
    height: 48,
    backgroundColor: colors.backgroundElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    color: colors.text,
    ...typography.body,
  },
  customInput: {
    marginTop: spacing.xs,
    borderColor: colors.borderFocus,
  },
  bioInput: {
    height: 90,
    paddingVertical: spacing.sm,
    textAlignVertical: 'top',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipSelected: {
    borderColor: colors.gold,
    backgroundColor: colors.goldMuted,
  },
  chipText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  chipTextSelected: {
    color: colors.gold,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  switchTextContainer: {
    flex: 1,
    marginRight: spacing.md,
  },
  switchTitle: {
    ...typography.bodyLarge,
    color: colors.text,
    fontWeight: '600',
  },
  switchDesc: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
    fontSize: 11,
    lineHeight: 15,
  },
  securityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  securityIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.cardElevated,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  securityIcon: {
    fontSize: 20,
  },
  securityInfo: {
    flex: 1,
  },
  securityTitle: {
    ...typography.bodyLarge,
    fontWeight: '700',
    color: colors.text,
  },
  securityDesc: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  securityChevron: {
    color: colors.gold,
    fontSize: 16,
    marginLeft: spacing.sm,
  },
  verificationCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  verificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  verificationTitle: {
    ...typography.h3,
    color: colors.text,
    fontSize: 15,
  },
  verBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  verBadgeVerified: {
    backgroundColor: colors.emeraldMuted,
    borderColor: colors.emerald,
  },
  verBadgeUnverified: {
    backgroundColor: colors.amberMuted,
    borderColor: colors.amber,
  },
  verBadgeText: {
    ...typography.caption,
    fontWeight: '700',
    fontSize: 10,
  },
  verTextVerified: {
    color: colors.emerald,
  },
  verTextUnverified: {
    color: colors.amber,
  },
  verificationBody: {
    ...typography.bodySmall,
    color: colors.textMuted,
    lineHeight: 17,
    fontSize: 12,
  },
  galleryStatusBox: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  galleryStatusText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  galleryErrorText: {
    ...typography.bodySmall,
    color: colors.ruby,
    textAlign: 'center',
  },
  retryGalleryBtn: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  retryGalleryBtnText: {
    ...typography.caption,
    color: colors.gold,
    fontWeight: '600',
  },
  completedBadge: {
    backgroundColor: 'rgba(52, 199, 89, 0.15)',
    borderWidth: 1,
    borderColor: '#34C759',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  completedBadgeText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    color: '#34C759',
  },
  incompleteBadge: {
    backgroundColor: 'rgba(255, 149, 0, 0.15)',
    borderWidth: 1,
    borderColor: '#FF9500',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  incompleteBadgeText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    color: '#FF9500',
  },
  incompleteNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 149, 0, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 149, 0, 0.35)',
    borderRadius: borderRadius.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  incompleteNoticeIcon: {
    fontSize: 22,
  },
  incompleteNoticeTitle: {
    ...typography.body,
    fontWeight: '700',
    color: '#FF9500',
    marginBottom: 2,
  },
  incompleteNoticeText: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  unitToggleGroup: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundElevated,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 2,
  },
  unitToggleBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.xs,
  },
  unitToggleBtnActive: {
    backgroundColor: colors.gold,
  },
  unitToggleText: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  unitToggleTextActive: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  numericInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  numericInput: {
    flex: 1,
    paddingRight: 40,
  },
  unitSuffix: {
    position: 'absolute',
    right: spacing.md,
    ...typography.caption,
    color: colors.textSubtle,
    fontWeight: '600',
  },
  dualInputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  inputError: {
    borderColor: colors.ruby,
  },
  conversionHelper: {
    ...typography.caption,
    color: colors.gold,
    fontSize: 11,
    marginTop: 4,
    fontStyle: 'italic',
  },
  errorText: {
    ...typography.caption,
    color: colors.ruby,
    fontSize: 11,
    marginTop: 4,
  },
  visibilityRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.backgroundElevated,
    borderRadius: borderRadius.sm,
    padding: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  visibilityLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  visibilityPills: {
    flexDirection: 'row',
    gap: 4,
  },
  visPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.xs,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  visPillActive: {
    borderColor: colors.gold,
    backgroundColor: colors.goldMuted,
  },
  visPillText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
  },
  visPillTextActive: {
    color: colors.gold,
    fontWeight: '700',
  },
  themeSectionDesc: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  themesList: {
    gap: spacing.sm,
  },
  themeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundElevated,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  themeCardActive: {
    backgroundColor: colors.cardElevated,
  },
  themeSwatchContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginRight: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  themeSwatchAccent: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  themeSwatchEmoji: {
    fontSize: 14,
  },
  themeSwatchSecondary: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#000',
  },
  themeDetails: {
    flex: 1,
  },
  themeNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  themeName: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  themeTagline: {
    ...typography.caption,
    color: colors.textSubtle,
    fontSize: 12,
  },
  activePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  activePillText: {
    ...typography.caption,
    color: '#000',
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 0.5,
  },
});

