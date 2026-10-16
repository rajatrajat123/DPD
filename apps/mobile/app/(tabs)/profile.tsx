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
import { colors, typography, spacing, borderRadius } from '../../src/theme';
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
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Profile</Text>
          <Text style={styles.subtitle}>Identity & Preferences</Text>
        </View>
        <TouchableOpacity
          style={styles.saveHeaderBtn}
          onPress={handleSaveChanges}
          disabled={isSaving}
          activeOpacity={0.8}
        >
          {isSaving ? (
            <ActivityIndicator color={colors.gold} size="small" />
          ) : (
            <Text style={styles.saveHeaderBtnText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Luxury Profile Header Card */}
        <View style={styles.profileHeaderCard}>
          <View style={styles.avatarWrap}>
            {primaryPhoto ? (
              <Image source={{ uri: primaryPhoto }} style={styles.avatarImage} />
            ) : (
              <View style={[styles.avatarImage, styles.avatarPlaceholder]}>
                <Text style={styles.avatarMonogram}>
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
              <Text style={styles.headerName}>{profile?.display_name || 'Member'}</Text>
              {profile?.age ? <Text style={styles.headerAge}>, {profile.age}</Text> : null}
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
              <View style={styles.locationBadge}>
                <Text style={styles.locationBadgeText}>
                  📍 {profile?.city || 'Local Member'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Photo Gallery Grid */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>Profile Gallery</Text>
            <Text style={styles.photoCountText}>
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
              <TouchableOpacity style={styles.retryGalleryBtn} onPress={loadGallery} activeOpacity={0.8}>
                <Text style={styles.retryGalleryBtnText}>Retry Loading Photos</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.photosGrid}>
              {displayPhotos.map((photo, index) => (
                <View key={photo.id || index} style={styles.photoWrap}>
                  <Image source={{ uri: photo.url }} style={styles.gridPhoto} />
                  {photo.is_primary && (
                    <View style={styles.primaryBadge}>
                      <Text style={styles.primaryBadgeText}>Primary</Text>
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
                        <Text style={styles.moveBtnText}>◀</Text>
                      </TouchableOpacity>
                    )}
                    {index < displayPhotos.length - 1 && (
                      <TouchableOpacity
                        style={styles.moveBtn}
                        onPress={() => handleMovePhoto(index, index + 1)}
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.moveBtnText}>▶</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}

              {/* Add Photo Button Slot */}
              {displayPhotos.length < 6 && (
                <TouchableOpacity
                  style={styles.addPhotoBtn}
                  onPress={handleAddPhoto}
                  disabled={isUploadingPhoto}
                  activeOpacity={0.8}
                >
                  {isUploadingPhoto ? (
                    <View style={styles.uploadingBox}>
                      <ActivityIndicator color={colors.gold} size="small" />
                      <Text style={styles.uploadingText}>{uploadProgressText}</Text>
                    </View>
                  ) : (
                    <>
                      <View style={styles.addIconCircle}>
                        <Text style={styles.addPhotoIcon}>+</Text>
                      </View>
                      <Text style={styles.addPhotoLabel}>Add Photo</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Basic Details Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>About You</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Display Name</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your display name"
              placeholderTextColor={colors.textSubtle}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Bio</Text>
            <TextInput
              style={[styles.input, styles.bioInput]}
              value={bio}
              onChangeText={setBio}
              placeholder="Tell other members what you are passionate about..."
              placeholderTextColor={colors.textSubtle}
              multiline
              numberOfLines={4}
            />
          </View>
        </View>

        {/* Identity & Dating Preferences Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Identity & Dating Preferences</Text>
          <Text style={styles.sectionDesc}>
            Customizable identity and preference settings used for discovery and matching.
          </Text>

          {/* SECTION 1: I am a — Gender identity */}
          <View style={styles.inputGroup}>
            <Text style={styles.sectionHeaderLabel}>1. I am a — Gender identity</Text>
            <Text style={styles.sectionSubLabel}>Select all that apply</Text>
            <View style={styles.chipsRow}>
              {GENDER_IDENTITY_OPTIONS.map((g) => {
                const selected = selectedGenders.includes(g.value);
                return (
                  <TouchableOpacity
                    key={g.value}
                    style={[styles.chip, selected ? styles.chipSelected : null]}
                    onPress={() => toggleGender(g.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>
                      {g.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {selectedGenders.includes('custom') && (
              <TextInput
                style={[styles.input, styles.customInput]}
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
            <Text style={styles.sectionHeaderLabel}>2. Looking for — Gender preferences</Text>
            <Text style={styles.sectionSubLabel}>Select all that apply</Text>
            <View style={styles.chipsRow}>
              {LOOKING_FOR_OPTIONS.map((item) => {
                const selected = selectedLookingFor.includes(item.value);
                return (
                  <TouchableOpacity
                    key={item.value}
                    style={[styles.chip, selected ? styles.chipSelected : null]}
                    onPress={() => toggleLookingFor(item.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {selectedLookingFor.includes('custom') && (
              <TextInput
                style={[styles.input, styles.customInput]}
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
            <Text style={styles.sectionHeaderLabel}>3. Sexual orientation</Text>
            <Text style={styles.sectionSubLabel}>Select all that apply</Text>
            <View style={styles.chipsRow}>
              {SEXUAL_ORIENTATION_OPTIONS.map((o) => {
                const selected = selectedOrientations.includes(o.value);
                return (
                  <TouchableOpacity
                    key={o.value}
                    style={[styles.chip, selected ? styles.chipSelected : null]}
                    onPress={() => toggleOrientation(o.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>
                      {o.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {selectedOrientations.includes('custom') && (
              <TextInput
                style={[styles.input, styles.customInput]}
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
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Lifestyle & Dealbreakers</Text>

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
                    style={[styles.chip, isSelected ? styles.chipSelected : null]}
                    onPress={() => setSmokingPref(pref)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, isSelected ? styles.chipTextSelected : null]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Dealbreaker Switch */}
          <View style={styles.switchRow}>
            <View style={styles.switchTextContainer}>
              <Text style={styles.switchTitle}>Non-Smoker Dealbreaker</Text>
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

        {/* Security & Privacy Shortcut */}
        <TouchableOpacity
          style={styles.securityCard}
          onPress={() => router.push('/(tabs)/settings')}
          activeOpacity={0.8}
        >
          <View style={styles.securityIconWrap}>
            <Text style={styles.securityIcon}>🛡️</Text>
          </View>
          <View style={styles.securityInfo}>
            <Text style={styles.securityTitle}>Privacy & Security Settings</Text>
            <Text style={styles.securityDesc}>
              Biometric lock, app switcher veil, notifications, and telemetry.
            </Text>
          </View>
          <Text style={styles.securityChevron}>➔</Text>
        </TouchableOpacity>

        {/* Mandatory Age Assurance Status */}
        <View style={styles.verificationCard}>
          <View style={styles.verificationHeader}>
            <Text style={styles.verificationTitle}>18+ Age Assurance (Mandatory)</Text>
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
              style={styles.verifyActionBtn}
              onPress={() => router.push('/(auth)/verify-age')}
              activeOpacity={0.8}
            >
              <Text style={styles.verifyActionBtnText}>Complete Age Verification</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Photo Verification (Selfie) */}
        <View style={[styles.verificationCard, { marginTop: spacing.md }]}>
          <View style={styles.verificationHeader}>
            <Text style={styles.verificationTitle}>Photo Verification (Selfie)</Text>
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
              style={styles.verifyActionBtn}
              onPress={
                profile?.verification_status === 'PENDING'
                  ? handleCheckVerificationStatus
                  : () => router.push('/(auth)/verify-age')
              }
              activeOpacity={0.8}
            >
              <Text style={styles.verifyActionBtnText}>
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
});

