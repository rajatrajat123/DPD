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
  Platform,
  LayoutAnimation,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { colors, typography, spacing, borderRadius, useTheme } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';
import { mediaUploader } from '../../src/services/media/mediaUploader';
import { authService } from '../../src/services/auth/authService';
import { discoveryService } from '../../src/services/discovery/discoveryService';
import { SmokingPreference, ProfilePhoto, DiscoveryPreferences, FavouriteProfileCard } from '../../src/types';
import { DiscoveryFilterModal } from '../../src/components/DiscoveryFilterModal';
import {
  GENDER_IDENTITY_OPTIONS,
  LOOKING_FOR_OPTIONS,
  SEXUAL_ORIENTATION_OPTIONS,
} from '../(auth)/register';

export const PRONOUN_OPTIONS = [
  { value: 'they/them', label: 'they/them' },
  { value: 'she/her', label: 'she/her' },
  { value: 'he/him', label: 'he/him' },
  { value: 'ze/zir', label: 'ze/zir' },
  { value: 'custom', label: 'Custom' },
];

export const SMOKING_HABIT_OPTIONS: { value: SmokingPreference; label: string }[] = [
  { value: 'NON_SMOKER', label: 'Non-smoker' },
  { value: 'SOCIAL_SMOKER', label: 'Social smoker' },
  { value: 'REGULAR_SMOKER', label: 'Regular smoker' },
];

export const DRINKING_HABIT_OPTIONS = [
  { value: 'NEVER', label: 'Never' },
  { value: 'SOCIALLY', label: 'Socially' },
  { value: 'FREQUENTLY', label: 'Frequently' },
  { value: 'SOBER', label: 'Sober' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say' },
];

export const RELATIONSHIP_INTENT_OPTIONS = [
  { value: 'long-term partner', label: 'Long-term partner' },
  { value: 'serious dating', label: 'Serious dating' },
  { value: 'casual dating', label: 'Casual dating' },
  { value: 'queer platonic', label: 'Queer platonic' },
  { value: 'community / friends', label: 'Community & friends' },
  { value: 'exploring', label: 'Exploring' },
];

export const RELATIONSHIP_STRUCTURE_OPTIONS = [
  { value: 'MONOGAMOUS', label: 'Monogamous' },
  { value: 'ENM', label: 'Ethically Non-Monogamous' },
  { value: 'POLYAMOROUS', label: 'Polyamorous' },
  { value: 'OPEN', label: 'Open relationship' },
  { value: 'EXPLORING', label: 'Exploring' },
];

export const COMMUNITY_INTERESTS_OPTIONS = [
  'Art & Design',
  'Music & Concerts',
  'Film & Cinema',
  'Books & Writing',
  'Travel & Outdoors',
  'Fitness & Yoga',
  'Cooking & Foodie',
  'Gaming & Tech',
  'Activism & Queer Culture',
  'Nightlife & Dancing',
  'Pets & Animals',
  'Coffee & Cafes',
];

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

function formatGendersSummary(genders?: string[]): string {
  if (!genders || genders.length === 0) return 'All genders';
  return genders
    .map((g) => {
      if (g.startsWith('custom:')) return g.slice(7);
      const opt = LOOKING_FOR_OPTIONS.find((o) => o.value === g);
      return opt ? opt.label : g;
    })
    .join(', ');
}

function formatOrientationsSummary(orientations?: string[]): string {
  if (!orientations || orientations.length === 0) return 'Any orientation';
  return orientations
    .map((o) => {
      if (o.startsWith('custom:')) return o.slice(7);
      const opt = SEXUAL_ORIENTATION_OPTIONS.find((item) => item.value === o);
      return opt ? opt.label : o;
    })
    .join(', ');
}

function formatIntentsSummary(intents?: string[]): string {
  if (!intents || intents.length === 0) return 'Any intention';
  const labelMap: Record<string, string> = {
    dating: 'Dating',
    long_term: 'Long-term',
    friendship: 'Friendship',
    casual: 'Casual / Hookups',
    exploring: 'Open to Explore',
  };
  return intents
    .map((intent) => {
      if (labelMap[intent]) return labelMap[intent];
      const opt = RELATIONSHIP_INTENT_OPTIONS.find((o) => o.value === intent);
      return opt ? opt.label : intent;
    })
    .join(', ');
}

function formatHeightBoundsSummary(minCm?: number, maxCm?: number): string {
  const hasMin = minCm !== undefined && minCm > 90;
  const hasMax = maxCm !== undefined && maxCm < 250;
  if (!hasMin && !hasMax) return 'Any height';
  if (hasMin && hasMax) return `${minCm} cm – ${maxCm} cm`;
  if (hasMin) return `Min ${minCm} cm`;
  return `Max ${maxCm} cm`;
}

function formatWeightBoundsSummary(minKg?: number, maxKg?: number): string {
  const hasMin = minKg !== undefined && minKg > 30;
  const hasMax = maxKg !== undefined && maxKg < 300;
  if (!hasMin && !hasMax) return 'Any weight';
  if (hasMin && hasMax) return `${minKg} kg – ${maxKg} kg`;
  if (hasMin) return `Min ${minKg} kg`;
  return `Max ${maxKg} kg`;
}

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();
  const { themeId, setTheme, themes, colors } = useTheme();
  const [isThemeDropdownOpen, setIsThemeDropdownOpen] = useState(false);
  const currentThemeMeta = themes.find((t) => t.id === themeId) || themes[0];

  // Collapsible Accordion Sections (Basic expanded by default; secondary collapsed)
  const [expandedSections, setExpandedSections] = useState<{
    basic: boolean;
    physical: boolean;
    identity: boolean;
    lifestyle: boolean;
    preferences: boolean;
    favourites: boolean;
  }>({
    basic: true,       // Expanded by default
    physical: false,    // Collapsed by default
    identity: false,    // Collapsed by default
    lifestyle: false,   // Collapsed by default
    preferences: false, // Collapsed by default
    favourites: false,  // Collapsed by default
  });

  const toggleSection = (key: keyof typeof expandedSections) => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setExpandedSections((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // Section A: Basic Information
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [selectedPronouns, setSelectedPronouns] = useState<string[]>(['they/them']);
  const [customPronounText, setCustomPronounText] = useState('');

  // Section B: Physical Attributes (Required for Discovery completion)
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

  // Section C: Identity & Orientation
  const [selectedGenders, setSelectedGenders] = useState<string[]>([]);
  const [customGenderText, setCustomGenderText] = useState('');
  const [selectedOrientations, setSelectedOrientations] = useState<string[]>([]);
  const [customOrientationText, setCustomOrientationText] = useState('');

  // Section D: Lifestyle & Interests
  const [smokingPref, setSmokingPref] = useState<SmokingPreference>(profile?.smoking_preference || 'NON_SMOKER');
  const [drinkingHabit, setDrinkingHabit] = useState<string>(profile?.drinking_habit || 'SOCIALLY');
  const [selectedIntents, setSelectedIntents] = useState<string[]>(profile?.relationship_intents || []);
  const [relationshipStructure, setRelationshipStructure] = useState<string>(profile?.relationship_structure || 'MONOGAMOUS');
  const [selectedInterests, setSelectedInterests] = useState<string[]>(profile?.interests || []);

  // Section E: Discovery Preferences Summary (Partner search preferences owned by Discovery filters)
  const [discoveryPrefs, setDiscoveryPrefs] = useState<DiscoveryPreferences | null>(null);
  const [isLoadingPrefs, setIsLoadingPrefs] = useState<boolean>(true);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState<boolean>(false);

  const loadDiscoveryPrefs = useCallback(async () => {
    setIsLoadingPrefs(true);
    setPrefsError(null);
    try {
      const prefs = await discoveryService.getPreferences();
      setDiscoveryPrefs(prefs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not load discovery preferences.';
      setPrefsError(msg);
    } finally {
      setIsLoadingPrefs(false);
    }
  }, []);

  useEffect(() => {
    loadDiscoveryPrefs();
  }, [loadDiscoveryPrefs]);

  // Section F: My Favourites (Private bookmarks loaded from backend)
  const [favourites, setFavourites] = useState<FavouriteProfileCard[]>([]);
  const [isLoadingFavourites, setIsLoadingFavourites] = useState<boolean>(false);
  const [favouritesError, setFavouritesError] = useState<string | null>(null);

  const loadFavourites = useCallback(async () => {
    setIsLoadingFavourites(true);
    setFavouritesError(null);
    try {
      const res = await discoveryService.getFavourites();
      setFavourites(res.favourites || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not load favourites.';
      setFavouritesError(msg);
    } finally {
      setIsLoadingFavourites(false);
    }
  }, []);

  const handleRemoveFavourite = async (targetUserId: string) => {
    try {
      await discoveryService.removeFavourite(targetUserId);
      setFavourites((prev) => prev.filter((f) => f.user_id !== targetUserId));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not remove favourite.';
      Alert.alert('Error', msg);
    }
  };

  useEffect(() => {
    loadFavourites();
  }, [loadFavourites]);

  useFocusEffect(
    useCallback(() => {
      loadFavourites();
    }, [loadFavourites])
  );

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

      const parsedPronouns = parseInitialTaxonomy(profile.pronouns);
      setSelectedPronouns(parsedPronouns.selected.length > 0 ? parsedPronouns.selected : ['they/them']);
      setCustomPronounText(parsedPronouns.customText);

      const parsedGenders = parseInitialTaxonomy(profile.gender_identities);
      setSelectedGenders(parsedGenders.selected);
      setCustomGenderText(parsedGenders.customText);

      const parsedOrientations = parseInitialTaxonomy(profile.sexual_orientations);
      setSelectedOrientations(parsedOrientations.selected);
      setCustomOrientationText(parsedOrientations.customText);

      if (profile.drinking_habit) {
        setDrinkingHabit(profile.drinking_habit);
      }
      if (profile.relationship_intents && Array.isArray(profile.relationship_intents)) {
        setSelectedIntents(profile.relationship_intents);
      }
      if (profile.relationship_structure) {
        setRelationshipStructure(profile.relationship_structure);
      }
      if (profile.interests && Array.isArray(profile.interests)) {
        setSelectedInterests(profile.interests);
      }

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

  const togglePronoun = (p: string) => {
    setSelectedPronouns((prev) =>
      prev.includes(p) ? (prev.length > 1 ? prev.filter((item) => item !== p) : prev) : [...prev, p]
    );
  };

  const toggleGender = (g: string) => {
    setSelectedGenders((prev) =>
      prev.includes(g) ? prev.filter((item) => item !== g) : [...prev, g]
    );
  };

  const toggleOrientation = (o: string) => {
    setSelectedOrientations((prev) =>
      prev.includes(o) ? prev.filter((item) => item !== o) : [...prev, o]
    );
  };

  const toggleIntent = (intent: string) => {
    setSelectedIntents((prev) =>
      prev.includes(intent) ? prev.filter((i) => i !== intent) : [...prev, intent]
    );
  };

  const toggleInterest = (interest: string) => {
    setSelectedInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
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
    const finalPronouns = buildFinalList(selectedPronouns, customPronounText);
    const finalGenders = buildFinalList(selectedGenders, customGenderText);
    const finalOrientations = buildFinalList(selectedOrientations, customOrientationText);

    if (finalGenders.length === 0) {
      Alert.alert('Gender Identity Required', 'Please select at least one gender identity under "I am a".');
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
      // 1. Build clean visibility settings strictly matching backend VisibilitySettings struct
      const cleanVisibility: Record<string, string | boolean> = {
        height: heightVisibility,
        weight: weightVisibility,
      };
      if (profile?.visibility_settings) {
        const allowedVisibilityKeys = [
          'gender_identity',
          'sexual_orientation',
          'pronouns',
          'distance',
          'online_status',
          'traveler_safety',
        ];
        for (const key of allowedVisibilityKeys) {
          if (profile.visibility_settings[key] !== undefined) {
            cleanVisibility[key] = profile.visibility_settings[key];
          }
        }
      }

      // 2. Update profile details on backend using exact DTO fields (Personal attributes only)
      await authService.updateMyProfile({
        display_name: displayName.trim(),
        bio: bio.trim(),
        pronouns: finalPronouns,
        gender_identities: finalGenders,
        sexual_orientations: finalOrientations,
        smoking_habit: smokingPref,
        smoking_preference: smokingPref,
        drinking_habit: drinkingHabit,
        relationship_intents: selectedIntents,
        relationship_structure: relationshipStructure,
        interests: selectedInterests,
        height_cm: finalHeightCm,
        weight_kg: finalWeightKg,
        visibility_settings: cleanVisibility,
      });

      // 3. Re-affirm active theme persistence
      try {
        await setTheme(themeId);
      } catch {
        // Handled
      }

      await refreshProfile();
      Alert.alert('Profile Saved', 'Your profile details have been updated.');
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
                <Text
                  style={[styles.locationBadgeText, { color: colors.textMuted }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
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

        {/* SECTION A: Basic Information */}
        <View
          testID="section-basic-info"
          style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <TouchableOpacity
            testID="accordion-header-basic"
            style={styles.accordionHeader}
            onPress={() => toggleSection('basic')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Basic Information section"
            accessibilityState={{ expanded: expandedSections.basic }}
          >
            <View style={styles.accordionTitleCol}>
              <View style={styles.accordionTitleRow}>
                <Text style={styles.accordionIcon}>👤</Text>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Basic Information</Text>
                <View
                  style={[
                    styles.accordionBadge,
                    {
                      backgroundColor: displayName ? `${colors.emerald}20` : `${colors.amber}20`,
                      borderColor: displayName ? colors.emerald : colors.amber,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.accordionBadgeText,
                      { color: displayName ? colors.emerald : colors.amber },
                    ]}
                  >
                    {displayName ? '✓ Active' : 'Required'}
                  </Text>
                </View>
              </View>
              <Text style={styles.accordionDesc}>Display name, verified age, pronouns & bio</Text>
            </View>
            <View
              style={[
                styles.accordionChevronWrap,
                { backgroundColor: colors.backgroundElevated, borderColor: colors.borderSubtle },
              ]}
            >
              <Text style={[styles.accordionChevronText, { color: colors.gold }]}>
                {expandedSections.basic ? '▲' : '▼'}
              </Text>
            </View>
          </TouchableOpacity>

          {expandedSections.basic && (
            <View style={[styles.accordionBody, { borderTopColor: colors.borderSubtle }]}>
              {/* Display Name */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Display Name</Text>
                <TextInput
                  testID="input-display-name"
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.backgroundElevated,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Your display name"
                  placeholderTextColor={colors.textSubtle}
                />
              </View>

              {/* Certified Age / Birthdate (Read-only Display) */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Age & Birthdate (Certified)</Text>
                <View
                  testID="readonly-age-card"
                  style={[
                    styles.readOnlyFieldCard,
                    {
                      backgroundColor: colors.backgroundElevated,
                      borderColor: colors.borderSubtle,
                    },
                  ]}
                >
                  <View style={styles.readOnlyFieldRow}>
                    <Text style={[styles.readOnlyFieldMain, { color: colors.text }]}>
                      {profile?.age ? `${profile.age} years old` : 'Age pending verification'}
                    </Text>
                    {profile?.birthdate ? (
                      <Text style={[styles.readOnlyFieldSub, { color: colors.textMuted }]}>
                        Born: {profile.birthdate}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.readOnlyFieldNotice, { color: colors.textSubtle }]}>
                    🔒 Age and birthdate are permanently certified according to Aura's 18+ Age Assurance policy. Contact member support to request a correction.
                  </Text>
                  {!profile?.is_age_verified && (
                    <TouchableOpacity
                      style={[
                        styles.miniVerifyBtn,
                        { backgroundColor: colors.goldMuted, borderColor: colors.gold },
                      ]}
                      onPress={() => router.push('/(auth)/verify-age')}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.miniVerifyBtnText, { color: colors.gold }]}>
                        Complete 18+ Verification →
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* Pronouns */}
              <View style={styles.inputGroup}>
                <Text style={[styles.sectionHeaderLabel, { color: colors.text }]}>Pronouns</Text>
                <Text style={[styles.sectionSubLabel, { color: colors.gold }]}>Select all that apply</Text>
                <View style={styles.chipsRow}>
                  {PRONOUN_OPTIONS.map((p) => {
                    const selected = selectedPronouns.includes(p.value);
                    return (
                      <TouchableOpacity
                        key={p.value}
                        style={[
                          styles.chip,
                          { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                          selected && [
                            styles.chipSelected,
                            { borderColor: colors.gold, backgroundColor: colors.goldMuted },
                          ],
                        ]}
                        onPress={() => togglePronoun(p.value)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: colors.textMuted },
                            selected && [styles.chipTextSelected, { color: colors.gold }],
                          ]}
                        >
                          {p.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {selectedPronouns.includes('custom') && (
                  <TextInput
                    style={[
                      styles.input,
                      styles.customInput,
                      {
                        backgroundColor: colors.backgroundElevated,
                        borderColor: colors.border,
                        color: colors.text,
                      },
                    ]}
                    value={customPronounText}
                    onChangeText={setCustomPronounText}
                    placeholder="Enter custom pronouns (e.g. fae/faer)..."
                    placeholderTextColor={colors.textSubtle}
                    maxLength={30}
                  />
                )}
              </View>

              {/* Bio with Character Counter */}
              <View style={styles.inputGroup}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.inputLabel}>Bio</Text>
                  <Text
                    style={[
                      styles.bioCharCount,
                      {
                        color:
                          bio.length > 450
                            ? colors.amber
                            : bio.length === 500
                            ? colors.ruby
                            : colors.textSubtle,
                      },
                    ]}
                  >
                    {bio.length}/500
                  </Text>
                </View>
                <TextInput
                  testID="input-bio"
                  style={[
                    styles.input,
                    styles.bioInput,
                    {
                      backgroundColor: colors.backgroundElevated,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={bio}
                  onChangeText={setBio}
                  placeholder="Tell other members what you are passionate about..."
                  placeholderTextColor={colors.textSubtle}
                  multiline
                  numberOfLines={4}
                  maxLength={500}
                />
              </View>
            </View>
          )}
        </View>

        {/* SECTION B: Physical Attributes */}
        <View
          testID="section-physical-attributes"
          style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <TouchableOpacity
            testID="accordion-header-physical"
            style={styles.accordionHeader}
            onPress={() => toggleSection('physical')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Physical Attributes section"
            accessibilityState={{ expanded: expandedSections.physical }}
          >
            <View style={styles.accordionTitleCol}>
              <View style={styles.accordionTitleRow}>
                <Text style={styles.accordionIcon}>📏</Text>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Physical Attributes</Text>
                <View
                  style={[
                    styles.accordionBadge,
                    {
                      backgroundColor: Boolean(profile?.height_cm && profile?.weight_kg)
                        ? `${colors.emerald}20`
                        : `${colors.amber}20`,
                      borderColor: Boolean(profile?.height_cm && profile?.weight_kg)
                        ? colors.emerald
                        : colors.amber,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.accordionBadgeText,
                      {
                        color: Boolean(profile?.height_cm && profile?.weight_kg)
                          ? colors.emerald
                          : colors.amber,
                      },
                    ]}
                  >
                    {Boolean(profile?.height_cm && profile?.weight_kg) ? '✓ Completed' : 'Required'}
                  </Text>
                </View>
              </View>
              <Text style={styles.accordionDesc}>
                Height & weight metrics for Discovery filtering with card visibility controls
              </Text>
            </View>
            <View
              style={[
                styles.accordionChevronWrap,
                { backgroundColor: colors.backgroundElevated, borderColor: colors.borderSubtle },
              ]}
            >
              <Text style={[styles.accordionChevronText, { color: colors.gold }]}>
                {expandedSections.physical ? '▲' : '▼'}
              </Text>
            </View>
          </TouchableOpacity>

          {expandedSections.physical && (
            <View style={[styles.accordionBody, { borderTopColor: colors.borderSubtle }]}>
              {/* Informative Body Neutrality Note */}
              <View
                style={[
                  styles.noticeBox,
                  { backgroundColor: colors.backgroundElevated, borderColor: colors.borderSubtle },
                ]}
              >
                <Text style={[styles.noticeBoxText, { color: colors.textMuted }]}>
                  ✨ Aura promotes body neutrality and size diversity across all identities. Height and weight inputs are used strictly for member preference filtering and can be set to Public, Matches Only, or Hidden.
                </Text>
              </View>

              {/* Height Input */}
              <View style={styles.inputGroup}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.inputLabel}>Height (90–250 cm)</Text>
                  <View
                    style={[
                      styles.unitToggleGroup,
                      { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                    ]}
                  >
                    <TouchableOpacity
                      style={[
                        styles.unitToggleBtn,
                        heightUnit === 'metric' && [
                          styles.unitToggleBtnActive,
                          { backgroundColor: colors.gold },
                        ],
                      ]}
                      onPress={() => {
                        setHeightUnit('metric');
                        if (!heightCmInput && heightFtInput) {
                          const ft = parseInt(heightFtInput, 10) || 0;
                          const inc = parseInt(heightInInput, 10) || 0;
                          setHeightCmInput(String(Math.round((ft * 12 + inc) * 2.54)));
                        }
                      }}
                    >
                      <Text
                        style={[
                          styles.unitToggleText,
                          heightUnit === 'metric' && [
                            styles.unitToggleTextActive,
                            { color: colors.textInverse },
                          ],
                        ]}
                      >
                        cm
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.unitToggleBtn,
                        heightUnit === 'imperial' && [
                          styles.unitToggleBtnActive,
                          { backgroundColor: colors.gold },
                        ],
                      ]}
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
                      <Text
                        style={[
                          styles.unitToggleText,
                          heightUnit === 'imperial' && [
                            styles.unitToggleTextActive,
                            { color: colors.textInverse },
                          ],
                        ]}
                      >
                        ft / in
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {heightUnit === 'metric' ? (
                  <View style={styles.numericInputWrapper}>
                    <TextInput
                      style={[
                        styles.input,
                        styles.numericInput,
                        {
                          backgroundColor: colors.backgroundElevated,
                          borderColor: colors.border,
                          color: colors.text,
                        },
                        heightError ? styles.inputError : null,
                      ]}
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
                        style={[
                          styles.input,
                          styles.numericInput,
                          {
                            backgroundColor: colors.backgroundElevated,
                            borderColor: colors.border,
                            color: colors.text,
                          },
                          heightError ? styles.inputError : null,
                        ]}
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
                        style={[
                          styles.input,
                          styles.numericInput,
                          {
                            backgroundColor: colors.backgroundElevated,
                            borderColor: colors.border,
                            color: colors.text,
                          },
                          heightError ? styles.inputError : null,
                        ]}
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
                          heightVisibility === vis && [
                            styles.visPillActive,
                            { borderColor: colors.gold, backgroundColor: colors.goldMuted },
                          ],
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
                  <View
                    style={[
                      styles.unitToggleGroup,
                      { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                    ]}
                  >
                    <TouchableOpacity
                      style={[
                        styles.unitToggleBtn,
                        weightUnit === 'metric' && [
                          styles.unitToggleBtnActive,
                          { backgroundColor: colors.gold },
                        ],
                      ]}
                      onPress={() => {
                        setWeightUnit('metric');
                        if (!weightKgInput && weightLbInput) {
                          const lb = parseInt(weightLbInput, 10) || 0;
                          setWeightKgInput(String(Math.round(lb * 0.45359237)));
                        }
                      }}
                    >
                      <Text
                        style={[
                          styles.unitToggleText,
                          weightUnit === 'metric' && [
                            styles.unitToggleTextActive,
                            { color: colors.textInverse },
                          ],
                        ]}
                      >
                        kg
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.unitToggleBtn,
                        weightUnit === 'imperial' && [
                          styles.unitToggleBtnActive,
                          { backgroundColor: colors.gold },
                        ],
                      ]}
                      onPress={() => {
                        setWeightUnit('imperial');
                        if (!weightLbInput && weightKgInput) {
                          const kg = parseInt(weightKgInput, 10) || 0;
                          setWeightLbInput(String(Math.round(kg * 2.20462)));
                        }
                      }}
                    >
                      <Text
                        style={[
                          styles.unitToggleText,
                          weightUnit === 'imperial' && [
                            styles.unitToggleTextActive,
                            { color: colors.textInverse },
                          ],
                        ]}
                      >
                        lb
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {weightUnit === 'metric' ? (
                  <View style={styles.numericInputWrapper}>
                    <TextInput
                      style={[
                        styles.input,
                        styles.numericInput,
                        {
                          backgroundColor: colors.backgroundElevated,
                          borderColor: colors.border,
                          color: colors.text,
                        },
                        weightError ? styles.inputError : null,
                      ]}
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
                      style={[
                        styles.input,
                        styles.numericInput,
                        {
                          backgroundColor: colors.backgroundElevated,
                          borderColor: colors.border,
                          color: colors.text,
                        },
                        weightError ? styles.inputError : null,
                      ]}
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
                          weightVisibility === vis && [
                            styles.visPillActive,
                            { borderColor: colors.gold, backgroundColor: colors.goldMuted },
                          ],
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
          )}
        </View>

        {/* SECTION C: Identity & Orientation */}
        <View
          testID="section-identity-orientation"
          style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <TouchableOpacity
            testID="accordion-header-identity"
            style={styles.accordionHeader}
            onPress={() => toggleSection('identity')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Identity and Orientation section"
            accessibilityState={{ expanded: expandedSections.identity }}
          >
            <View style={styles.accordionTitleCol}>
              <View style={styles.accordionTitleRow}>
                <Text style={styles.accordionIcon}>🏳️‍🌈</Text>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Identity & Orientation</Text>
                <View
                  style={[
                    styles.accordionBadge,
                    {
                      backgroundColor:
                        selectedGenders.length > 0 && selectedOrientations.length > 0
                          ? `${colors.emerald}20`
                          : `${colors.amber}20`,
                      borderColor:
                        selectedGenders.length > 0 && selectedOrientations.length > 0
                          ? colors.emerald
                          : colors.amber,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.accordionBadgeText,
                      {
                        color:
                          selectedGenders.length > 0 && selectedOrientations.length > 0
                            ? colors.emerald
                            : colors.amber,
                      },
                    ]}
                  >
                    {selectedGenders.length > 0 && selectedOrientations.length > 0
                      ? '✓ Set'
                      : 'Required'}
                  </Text>
                </View>
              </View>
              <Text style={styles.accordionDesc}>
                Gender identity & sexual orientation taxonomy for queer matchmaking
              </Text>
            </View>
            <View
              style={[
                styles.accordionChevronWrap,
                { backgroundColor: colors.backgroundElevated, borderColor: colors.borderSubtle },
              ]}
            >
              <Text style={[styles.accordionChevronText, { color: colors.gold }]}>
                {expandedSections.identity ? '▲' : '▼'}
              </Text>
            </View>
          </TouchableOpacity>

          {expandedSections.identity && (
            <View style={[styles.accordionBody, { borderTopColor: colors.borderSubtle }]}>
              {/* Note on Pronouns */}
              <View
                style={[
                  styles.noticeBox,
                  { backgroundColor: colors.backgroundElevated, borderColor: colors.borderSubtle },
                ]}
              >
                <Text style={[styles.noticeBoxText, { color: colors.textMuted }]}>
                  💡 Pronouns are configured under Basic Information to ensure seamless visibility on your public member card.
                </Text>
              </View>

              {/* Gender Identity */}
              <View style={styles.inputGroup}>
                <Text style={[styles.sectionHeaderLabel, { color: colors.text }]}>
                  Gender Identity
                </Text>
                <Text style={[styles.sectionSubLabel, { color: colors.gold }]}>
                  Select all that apply
                </Text>
                <View style={styles.chipsRow}>
                  {GENDER_IDENTITY_OPTIONS.map((g) => {
                    const selected = selectedGenders.includes(g.value);
                    return (
                      <TouchableOpacity
                        key={g.value}
                        style={[
                          styles.chip,
                          { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                          selected && [
                            styles.chipSelected,
                            { borderColor: colors.gold, backgroundColor: colors.goldMuted },
                          ],
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
                    style={[
                      styles.input,
                      styles.customInput,
                      {
                        backgroundColor: colors.backgroundElevated,
                        borderColor: colors.border,
                        color: colors.text,
                      },
                    ]}
                    value={customGenderText}
                    onChangeText={setCustomGenderText}
                    placeholder="Enter your gender identity..."
                    placeholderTextColor={colors.textSubtle}
                    maxLength={40}
                  />
                )}
              </View>

              {/* Sexual Orientation */}
              <View style={styles.inputGroup}>
                <Text style={[styles.sectionHeaderLabel, { color: colors.text }]}>
                  Sexual Orientation
                </Text>
                <Text style={[styles.sectionSubLabel, { color: colors.gold }]}>
                  Select all that apply
                </Text>
                <View style={styles.chipsRow}>
                  {SEXUAL_ORIENTATION_OPTIONS.map((o) => {
                    const selected = selectedOrientations.includes(o.value);
                    return (
                      <TouchableOpacity
                        key={o.value}
                        style={[
                          styles.chip,
                          { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                          selected && [
                            styles.chipSelected,
                            { borderColor: colors.gold, backgroundColor: colors.goldMuted },
                          ],
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
                    style={[
                      styles.input,
                      styles.customInput,
                      {
                        backgroundColor: colors.backgroundElevated,
                        borderColor: colors.border,
                        color: colors.text,
                      },
                    ]}
                    value={customOrientationText}
                    onChangeText={setCustomOrientationText}
                    placeholder="Enter your sexual orientation..."
                    placeholderTextColor={colors.textSubtle}
                    maxLength={40}
                  />
                )}
              </View>
            </View>
          )}
        </View>

        {/* SECTION D: Lifestyle & Interests */}
        <View
          testID="section-lifestyle-interests"
          style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <TouchableOpacity
            testID="accordion-header-lifestyle"
            style={styles.accordionHeader}
            onPress={() => toggleSection('lifestyle')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Lifestyle and Interests section"
            accessibilityState={{ expanded: expandedSections.lifestyle }}
          >
            <View style={styles.accordionTitleCol}>
              <View style={styles.accordionTitleRow}>
                <Text style={styles.accordionIcon}>✨</Text>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Lifestyle & Interests</Text>
                <View
                  style={[
                    styles.accordionBadge,
                    {
                      backgroundColor: `${colors.gold}20`,
                      borderColor: colors.gold,
                    },
                  ]}
                >
                  <Text style={[styles.accordionBadgeText, { color: colors.gold }]}>
                    {selectedInterests.length > 0 ? `${selectedInterests.length} Selected` : 'Optional'}
                  </Text>
                </View>
              </View>
              <Text style={styles.accordionDesc}>
                Habits, intentions, relationship structure & community passions
              </Text>
            </View>
            <View
              style={[
                styles.accordionChevronWrap,
                { backgroundColor: colors.backgroundElevated, borderColor: colors.borderSubtle },
              ]}
            >
              <Text style={[styles.accordionChevronText, { color: colors.gold }]}>
                {expandedSections.lifestyle ? '▲' : '▼'}
              </Text>
            </View>
          </TouchableOpacity>

          {expandedSections.lifestyle && (
            <View style={[styles.accordionBody, { borderTopColor: colors.borderSubtle }]}>
              {/* Smoking Habit */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Smoking Habit</Text>
                <View style={styles.chipsRow}>
                  {SMOKING_HABIT_OPTIONS.map((opt) => {
                    const isSelected = smokingPref === opt.value;
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[
                          styles.chip,
                          { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                          isSelected && [
                            styles.chipSelected,
                            { borderColor: colors.gold, backgroundColor: colors.goldMuted },
                          ],
                        ]}
                        onPress={() => setSmokingPref(opt.value as SmokingPreference)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: colors.textMuted },
                            isSelected && [styles.chipTextSelected, { color: colors.gold }],
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Drinking Habit */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Drinking Habit</Text>
                <View style={styles.chipsRow}>
                  {DRINKING_HABIT_OPTIONS.map((opt) => {
                    const isSelected = drinkingHabit === opt.value;
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[
                          styles.chip,
                          { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                          isSelected && [
                            styles.chipSelected,
                            { borderColor: colors.gold, backgroundColor: colors.goldMuted },
                          ],
                        ]}
                        onPress={() => setDrinkingHabit(opt.value)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: colors.textMuted },
                            isSelected && [styles.chipTextSelected, { color: colors.gold }],
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Relationship Intentions */}
              <View style={styles.inputGroup}>
                <Text style={[styles.sectionHeaderLabel, { color: colors.text }]}>
                  Relationship Intentions
                </Text>
                <Text style={[styles.sectionSubLabel, { color: colors.gold }]}>
                  Select all that apply
                </Text>
                <View style={styles.chipsRow}>
                  {RELATIONSHIP_INTENT_OPTIONS.map((opt) => {
                    const isSelected = selectedIntents.includes(opt.value);
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[
                          styles.chip,
                          { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                          isSelected && [
                            styles.chipSelected,
                            { borderColor: colors.gold, backgroundColor: colors.goldMuted },
                          ],
                        ]}
                        onPress={() => toggleIntent(opt.value)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: colors.textMuted },
                            isSelected && [styles.chipTextSelected, { color: colors.gold }],
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Relationship Structure */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Relationship Structure</Text>
                <View style={styles.chipsRow}>
                  {RELATIONSHIP_STRUCTURE_OPTIONS.map((opt) => {
                    const isSelected = relationshipStructure === opt.value;
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[
                          styles.chip,
                          { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                          isSelected && [
                            styles.chipSelected,
                            { borderColor: colors.gold, backgroundColor: colors.goldMuted },
                          ],
                        ]}
                        onPress={() => setRelationshipStructure(opt.value)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: colors.textMuted },
                            isSelected && [styles.chipTextSelected, { color: colors.gold }],
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Community Interests / Passions */}
              <View style={styles.inputGroup}>
                <Text style={[styles.sectionHeaderLabel, { color: colors.text }]}>
                  Community Interests & Passions
                </Text>
                <Text style={[styles.sectionSubLabel, { color: colors.gold }]}>
                  Select passions to highlight on your profile
                </Text>
                <View style={styles.chipsRow}>
                  {COMMUNITY_INTERESTS_OPTIONS.map((opt) => {
                    const isSelected = selectedInterests.includes(opt);
                    return (
                      <TouchableOpacity
                        key={opt}
                        style={[
                          styles.chip,
                          { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                          isSelected && [
                            styles.chipSelected,
                            { borderColor: colors.gold, backgroundColor: colors.goldMuted },
                          ],
                        ]}
                        onPress={() => toggleInterest(opt)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: colors.textMuted },
                            isSelected && [styles.chipTextSelected, { color: colors.gold }],
                          ]}
                        >
                          {opt}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>
          )}
        </View>

        {/* SECTION E: Discovery Preferences Summary */}
        <View
          testID="section-relationship-preferences"
          style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <TouchableOpacity
            testID="accordion-header-preferences"
            style={styles.accordionHeader}
            onPress={() => toggleSection('preferences')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Discovery Preferences section"
            accessibilityState={{ expanded: expandedSections.preferences }}
          >
            <View style={styles.accordionTitleCol}>
              <View style={styles.accordionTitleRow}>
                <Text style={styles.accordionIcon}>🎯</Text>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Discovery Preferences
                </Text>
                <View
                  style={[
                    styles.accordionBadge,
                    {
                      backgroundColor: isLoadingPrefs
                        ? `${colors.gold}20`
                        : prefsError
                        ? `${colors.ruby}20`
                        : `${colors.emerald}20`,
                      borderColor: isLoadingPrefs
                        ? colors.gold
                        : prefsError
                        ? colors.ruby
                        : colors.emerald,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.accordionBadgeText,
                      {
                        color: isLoadingPrefs
                          ? colors.gold
                          : prefsError
                          ? colors.ruby
                          : colors.emerald,
                      },
                    ]}
                  >
                    {isLoadingPrefs ? 'Loading...' : prefsError ? 'Error' : '✓ Active Filters'}
                  </Text>
                </View>
              </View>
              <Text style={styles.accordionDesc}>
                Partner search preferences & deck filters managed via Discovery Filters
              </Text>
            </View>
            <View
              style={[
                styles.accordionChevronWrap,
                { backgroundColor: colors.backgroundElevated, borderColor: colors.borderSubtle },
              ]}
            >
              <Text style={[styles.accordionChevronText, { color: colors.gold }]}>
                {expandedSections.preferences ? '▲' : '▼'}
              </Text>
            </View>
          </TouchableOpacity>

          {expandedSections.preferences && (
            <View style={[styles.accordionBody, { borderTopColor: colors.borderSubtle }]}>
              {isLoadingPrefs ? (
                <View style={styles.prefLoadingState} testID="discovery-prefs-loading">
                  <ActivityIndicator size="small" color={colors.gold} />
                  <Text style={[styles.prefLoadingText, { color: colors.textMuted }]}>
                    Loading discovery preferences...
                  </Text>
                </View>
              ) : prefsError && !discoveryPrefs ? (
                <View style={styles.prefErrorState} testID="discovery-prefs-error">
                  <Text style={[styles.prefErrorText, { color: colors.ruby }]}>
                    ⚠️ {prefsError}
                  </Text>
                  <TouchableOpacity
                    style={[styles.prefRetryBtn, { borderColor: colors.gold }]}
                    onPress={loadDiscoveryPrefs}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.prefRetryBtnText, { color: colors.gold }]}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : discoveryPrefs ? (
                <View style={styles.prefSummaryContainer} testID="discovery-prefs-summary">
                  <View
                    style={[
                      styles.noticeBox,
                      { backgroundColor: colors.backgroundElevated, borderColor: colors.borderSubtle },
                    ]}
                  >
                    <Text style={[styles.noticeBoxText, { color: colors.textMuted }]}>
                      ✨ Discovery partner preferences and hard dealbreakers filter your discovery deck. Personal profile details (such as your own gender, habits, and intentions) are configured in the sections above.
                    </Text>
                  </View>

                  {/* Summary Rows */}
                  <View style={styles.prefSummaryGrid}>
                    {/* Looking For Genders */}
                    <View style={[styles.prefSummaryRow, { borderBottomColor: colors.borderSubtle }]}>
                      <Text style={[styles.prefSummaryLabel, { color: colors.textMuted }]}>Looking For</Text>
                      <Text style={[styles.prefSummaryValue, { color: colors.text }]} numberOfLines={2}>
                        {formatGendersSummary(discoveryPrefs.preferred_genders)}
                      </Text>
                    </View>

                    {/* Age Range */}
                    <View style={[styles.prefSummaryRow, { borderBottomColor: colors.borderSubtle }]}>
                      <Text style={[styles.prefSummaryLabel, { color: colors.textMuted }]}>Age Range</Text>
                      <Text style={[styles.prefSummaryValue, { color: colors.text }]}>
                        {discoveryPrefs.min_age ?? 18} – {discoveryPrefs.max_age ?? 99} years
                      </Text>
                    </View>

                    {/* Maximum Distance */}
                    <View style={[styles.prefSummaryRow, { borderBottomColor: colors.borderSubtle }]}>
                      <Text style={[styles.prefSummaryLabel, { color: colors.textMuted }]}>Maximum Distance</Text>
                      <Text style={[styles.prefSummaryValue, { color: colors.text }]}>
                        {Math.round((discoveryPrefs.max_distance_km ?? 50) / 1.60934)} miles ({discoveryPrefs.max_distance_km ?? 50} km)
                      </Text>
                    </View>

                    {/* Preferred Orientations */}
                    <View style={[styles.prefSummaryRow, { borderBottomColor: colors.borderSubtle }]}>
                      <Text style={[styles.prefSummaryLabel, { color: colors.textMuted }]}>Sexual Orientations</Text>
                      <Text style={[styles.prefSummaryValue, { color: colors.text }]} numberOfLines={2}>
                        {formatOrientationsSummary(discoveryPrefs.preferred_orientations)}
                      </Text>
                    </View>

                    {/* Preferred Intentions */}
                    <View style={[styles.prefSummaryRow, { borderBottomColor: colors.borderSubtle }]}>
                      <Text style={[styles.prefSummaryLabel, { color: colors.textMuted }]}>Relationship Intentions</Text>
                      <Text style={[styles.prefSummaryValue, { color: colors.text }]} numberOfLines={2}>
                        {formatIntentsSummary(discoveryPrefs.preferred_intents)}
                      </Text>
                    </View>

                    {/* Height Filter Bounds */}
                    <View style={[styles.prefSummaryRow, { borderBottomColor: colors.borderSubtle }]}>
                      <Text style={[styles.prefSummaryLabel, { color: colors.textMuted }]}>Height Range</Text>
                      <Text style={[styles.prefSummaryValue, { color: colors.text }]}>
                        {formatHeightBoundsSummary(discoveryPrefs.min_height_cm, discoveryPrefs.max_height_cm)}
                      </Text>
                    </View>

                    {/* Weight Filter Bounds */}
                    <View style={[styles.prefSummaryRow, { borderBottomColor: colors.borderSubtle }]}>
                      <Text style={[styles.prefSummaryLabel, { color: colors.textMuted }]}>Weight Range</Text>
                      <Text style={[styles.prefSummaryValue, { color: colors.text }]}>
                        {formatWeightBoundsSummary(discoveryPrefs.min_weight_kg, discoveryPrefs.max_weight_kg)}
                      </Text>
                    </View>

                    {/* Non-Smoker Dealbreaker */}
                    <View style={[styles.prefSummaryRow, { borderBottomColor: colors.borderSubtle }]}>
                      <Text style={[styles.prefSummaryLabel, { color: colors.textMuted }]}>Non-Smoker Dealbreaker</Text>
                      <View
                        style={[
                          styles.prefStatusBadge,
                          {
                            backgroundColor: Boolean(
                              discoveryPrefs.dealbreaker_non_smoker ||
                                discoveryPrefs.dealbreakers?.non_smoker_only
                            )
                              ? `${colors.emerald}20`
                              : `${colors.border}`,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.prefStatusBadgeText,
                            {
                              color: Boolean(
                                discoveryPrefs.dealbreaker_non_smoker ||
                                  discoveryPrefs.dealbreakers?.non_smoker_only
                              )
                                ? colors.emerald
                                : colors.textMuted,
                            },
                          ]}
                        >
                          {Boolean(
                            discoveryPrefs.dealbreaker_non_smoker ||
                              discoveryPrefs.dealbreakers?.non_smoker_only
                          )
                            ? 'Strictly Required'
                            : 'Off'}
                        </Text>
                      </View>
                    </View>

                    {/* 18+ Verified Dealbreaker */}
                    <View style={[styles.prefSummaryRow, { borderBottomColor: colors.borderSubtle }]}>
                      <Text style={[styles.prefSummaryLabel, { color: colors.textMuted }]}>18+ Verified Only</Text>
                      <View
                        style={[
                          styles.prefStatusBadge,
                          {
                            backgroundColor: Boolean(
                              discoveryPrefs.verified_only ||
                                discoveryPrefs.verified_profiles_only ||
                                discoveryPrefs.dealbreakers?.require_verified
                            )
                              ? `${colors.emerald}20`
                              : `${colors.border}`,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.prefStatusBadgeText,
                            {
                              color: Boolean(
                                discoveryPrefs.verified_only ||
                                  discoveryPrefs.verified_profiles_only ||
                                  discoveryPrefs.dealbreakers?.require_verified
                              )
                                ? colors.emerald
                                : colors.textMuted,
                            },
                          ]}
                        >
                          {Boolean(
                            discoveryPrefs.verified_only ||
                              discoveryPrefs.verified_profiles_only ||
                              discoveryPrefs.dealbreakers?.require_verified
                          )
                            ? 'Strictly Required'
                            : 'Off'}
                        </Text>
                      </View>
                    </View>

                    {/* Monogamous Intentions Dealbreaker */}
                    <View style={[styles.prefSummaryRow, { borderBottomColor: 'transparent' }]}>
                      <Text style={[styles.prefSummaryLabel, { color: colors.textMuted }]}>Monogamous Intentions</Text>
                      <View
                        style={[
                          styles.prefStatusBadge,
                          {
                            backgroundColor: Boolean(discoveryPrefs.dealbreakers?.require_monogamous)
                              ? `${colors.emerald}20`
                              : `${colors.border}`,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.prefStatusBadgeText,
                            {
                              color: Boolean(discoveryPrefs.dealbreakers?.require_monogamous)
                                ? colors.emerald
                                : colors.textMuted,
                            },
                          ]}
                        >
                          {Boolean(discoveryPrefs.dealbreakers?.require_monogamous)
                            ? 'Strictly Required'
                            : 'Off'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Edit Filters Button */}
                  <TouchableOpacity
                    testID="edit-discovery-filters-btn"
                    style={[styles.editFiltersBtn, { backgroundColor: colors.gold }]}
                    onPress={() => setIsFilterModalOpen(true)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Edit Discovery Filters"
                  >
                    <Text style={[styles.editFiltersBtnText, { color: colors.textInverse }]}>
                      Edit Filters
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          )}
        </View>

        {/* Discovery Filter Modal Integration */}
        <DiscoveryFilterModal
          visible={isFilterModalOpen}
          onClose={() => setIsFilterModalOpen(false)}
          onApply={(updated) => {
            setDiscoveryPrefs(updated);
          }}
          currentPreferences={discoveryPrefs}
        />

        {/* SECTION F: My Favourites */}
        <View
          testID="section-my-favourites"
          style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <TouchableOpacity
            testID="accordion-header-favourites"
            style={styles.accordionHeader}
            onPress={() => router.push('/favourites' as any)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="My Favourites section — tap to open full-screen grid"
          >
            <View style={styles.accordionTitleCol}>
              <View style={styles.accordionTitleRow}>
                <Text style={styles.accordionIcon}>🔖</Text>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>My Favourites</Text>
                <View
                  style={[
                    styles.accordionBadge,
                    {
                      backgroundColor: favourites.length > 0 ? `${colors.gold}20` : `${colors.borderSubtle}`,
                      borderColor: favourites.length > 0 ? colors.gold : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.accordionBadgeText,
                      { color: favourites.length > 0 ? colors.gold : colors.textMuted },
                    ]}
                  >
                    {favourites.length > 0 ? `${favourites.length} Saved` : '0 Saved'}
                  </Text>
                </View>
              </View>
              <Text style={styles.accordionDesc}>
                Private bookmarks — tap to browse your saved profiles in 3-column grid
              </Text>
            </View>
            <View
              style={[
                styles.accordionChevronWrap,
                { backgroundColor: colors.backgroundElevated, borderColor: colors.borderSubtle },
              ]}
            >
              <Text style={[styles.accordionChevronText, { color: colors.gold, fontSize: 16 }]}>
                ›
              </Text>
            </View>
          </TouchableOpacity>

          {expandedSections.favourites && (
            <View style={[styles.accordionBody, { borderTopColor: colors.borderSubtle }]}>
              {isLoadingFavourites && favourites.length === 0 ? (
                <View style={styles.favLoadingState} testID="favourites-loading-state">
                  <ActivityIndicator size="small" color={colors.gold} />
                  <Text style={[styles.favLoadingText, { color: colors.textMuted }]}>
                    Loading saved favourites...
                  </Text>
                </View>
              ) : favouritesError && favourites.length === 0 ? (
                <View style={styles.favErrorState} testID="favourites-error-state">
                  <Text style={[styles.favErrorText, { color: colors.ruby }]}>
                    ⚠️ {favouritesError}
                  </Text>
                  <TouchableOpacity
                    style={[styles.favRetryBtn, { borderColor: colors.gold }]}
                    onPress={loadFavourites}
                    activeOpacity={0.7}
                    testID="favourites-retry-btn"
                  >
                    <Text style={[styles.favRetryBtnText, { color: colors.gold }]}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : favourites.length === 0 ? (
                <View style={styles.favEmptyState} testID="favourites-empty-state">
                  <Text style={styles.favEmptyIcon}>🔖</Text>
                  <Text style={[styles.favEmptyTitle, { color: colors.text }]}>No favourite profiles saved yet</Text>
                  <Text style={[styles.favEmptySubtitle, { color: colors.textMuted }]}>
                    Tap the bookmark icon on any Discovery card to save profiles here for quick private access.
                  </Text>
                </View>
              ) : (
                <View style={styles.favList} testID="favourites-list">
                  {favourites.map((fav) => (
                    <View
                      key={fav.user_id}
                      style={[
                        styles.favCard,
                        { backgroundColor: colors.backgroundElevated, borderColor: colors.borderSubtle },
                      ]}
                      testID={`favourite-item-${fav.user_id}`}
                    >
                      <TouchableOpacity
                        style={styles.favCardTouchable}
                        onPress={() =>
                          router.push({
                            pathname: '/profile/[id]',
                            params: { id: fav.user_id },
                          })
                        }
                        activeOpacity={0.7}
                        testID={`favourite-card-${fav.user_id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`View profile of ${fav.display_name}`}
                      >
                        {fav.photo_url ? (
                          <Image
                            source={{ uri: fav.photo_url }}
                            style={styles.favAvatar}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            style={[
                              styles.favAvatar,
                              styles.favAvatarPlaceholder,
                              { backgroundColor: colors.cardMuted },
                            ]}
                          >
                            <Text style={[styles.favPlaceholderMonogram, { color: colors.gold }]}>
                              {fav.display_name ? fav.display_name.charAt(0).toUpperCase() : 'A'}
                            </Text>
                          </View>
                        )}
                        <View style={styles.favInfoCol}>
                          <View style={styles.favNameRow}>
                            <Text style={[styles.favName, { color: colors.text }]} numberOfLines={1}>
                              {fav.display_name}
                            </Text>
                            {fav.age > 0 && (
                              <Text style={[styles.favAge, { color: colors.gold }]}>, {fav.age}</Text>
                            )}
                          </View>
                          {fav.bio ? (
                            <Text style={[styles.favBio, { color: colors.textMuted }]} numberOfLines={1}>
                              {fav.bio}
                            </Text>
                          ) : (
                            <Text style={[styles.favBio, { color: colors.textSubtle }]}>
                              Saved favourite
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.favRemoveBtn,
                          { backgroundColor: colors.card, borderColor: colors.border },
                        ]}
                        onPress={() => handleRemoveFavourite(fav.user_id)}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        testID={`remove-favourite-${fav.user_id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${fav.display_name} from favourites`}
                      >
                        <Text style={[styles.favRemoveBtnText, { color: colors.textMuted }]}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>

        {/* App Appearance & Themes Section */}
        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>App Appearance & Theme</Text>
            <Text style={[styles.sectionSubtitle, { color: colors.gold }]}>6 Signature Palettes</Text>
          </View>
          <Text style={styles.themeSectionDesc}>
            Choose your signature Aura aesthetic. Themes switch reactively and persist across restarts.
          </Text>

          {/* Compact Dropdown Trigger */}
          <TouchableOpacity
            style={[
              styles.themeDropdownTrigger,
              {
                backgroundColor: colors.backgroundElevated,
                borderColor: isThemeDropdownOpen ? colors.gold : colors.border,
              },
            ]}
            onPress={() => setIsThemeDropdownOpen((prev) => !prev)}
            activeOpacity={0.8}
            accessibilityRole="combobox"
            accessibilityState={{ expanded: isThemeDropdownOpen }}
            accessibilityLabel={`Select theme, current theme is ${currentThemeMeta.name}`}
            testID="theme-dropdown-trigger"
          >
            <View style={styles.dropdownTriggerLeft}>
              <View
                style={[
                  styles.triggerSwatchBadge,
                  { backgroundColor: currentThemeMeta.backgroundColor, borderColor: currentThemeMeta.primaryColor },
                ]}
              >
                <Text style={styles.triggerBadgeEmoji}>{currentThemeMeta.badgeEmoji}</Text>
              </View>
              <View style={styles.triggerTextCol}>
                <View style={styles.triggerNameRow}>
                  <Text style={[styles.triggerThemeName, { color: colors.text }]}>
                    {currentThemeMeta.name}
                  </Text>
                  <View style={[styles.activePill, { backgroundColor: currentThemeMeta.primaryColor }]}>
                    <Text style={styles.activePillText}>Active ✓</Text>
                  </View>
                </View>
                <Text style={[styles.triggerThemeTagline, { color: colors.textSubtle }]} numberOfLines={1}>
                  {currentThemeMeta.tagline}
                </Text>

                {/* Palette Preview Swatches Strip - Dedicated Row */}
                <View style={styles.palettePreviewStrip} testID="theme-palette-preview-strip">
                  {currentThemeMeta.palettePreview.map((hex, idx) => (
                    <View
                      key={idx}
                      style={[
                        styles.paletteDot,
                        {
                          backgroundColor: hex,
                          borderColor: colors.borderSubtle,
                        },
                      ]}
                    />
                  ))}
                </View>
              </View>
            </View>

            {/* Trailing Dedicated Chevron Area */}
            <View style={[styles.chevronWrap, { backgroundColor: colors.cardElevated }]}>
              <Text style={[styles.chevronText, { color: colors.gold }]}>
                {isThemeDropdownOpen ? '▲' : '▼'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Expanded Dropdown Menu */}
          {isThemeDropdownOpen && (
            <View
              style={[
                styles.themeDropdownMenu,
                {
                  backgroundColor: colors.backgroundElevated,
                  borderColor: colors.border,
                },
              ]}
              testID="theme-dropdown-menu"
            >
              {themes.map((t) => {
                const isActive = themeId === t.id;
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[
                      styles.themeDropdownItem,
                      { borderBottomColor: colors.borderSubtle },
                      isActive && [
                        styles.themeDropdownItemActive,
                        {
                          backgroundColor: colors.cardElevated,
                          borderLeftColor: t.primaryColor,
                        },
                      ],
                    ]}
                    onPress={async () => {
                      await setTheme(t.id);
                      setIsThemeDropdownOpen(false);
                    }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={`Choose theme ${t.name}`}
                    testID={`theme-option-${t.id}`}
                  >
                    <View style={styles.dropdownItemLeft}>
                      <View
                        style={[
                          styles.itemSwatchBadge,
                          { backgroundColor: t.backgroundColor, borderColor: t.primaryColor },
                        ]}
                      >
                        <Text style={styles.itemBadgeEmoji}>{t.badgeEmoji}</Text>
                      </View>
                      <View style={styles.itemTextCol}>
                        <View style={styles.itemNameRow}>
                          <Text
                            style={[
                              styles.itemThemeName,
                              { color: colors.text },
                              isActive && { color: t.primaryColor, fontWeight: '700' },
                            ]}
                          >
                            {t.name}
                          </Text>
                          {isActive && (
                            <View style={[styles.activePill, { backgroundColor: t.primaryColor }]}>
                              <Text style={styles.activePillText}>Active ✓</Text>
                            </View>
                          )}
                        </View>
                        <Text style={[styles.itemThemeTagline, { color: colors.textSubtle }]} numberOfLines={1}>
                          {t.tagline}
                        </Text>
                      </View>
                    </View>

                    {/* Right side: Palette Preview Swatches */}
                    <View style={styles.itemPaletteStrip}>
                      {t.palettePreview.map((hex, idx) => (
                        <View
                          key={idx}
                          style={[
                            styles.paletteDotSmall,
                            {
                              backgroundColor: hex,
                              borderColor: colors.borderSubtle,
                            },
                          ]}
                        />
                      ))}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Referral Rewards Shortcut */}
        <TouchableOpacity
          style={[styles.securityCard, { backgroundColor: colors.card, borderColor: colors.gold }]}
          onPress={() => router.push('/referrals')}
          activeOpacity={0.8}
        >
          <View style={[styles.securityIconWrap, { backgroundColor: colors.cardElevated }]}>
            <Text style={styles.securityIcon}>🎁</Text>
          </View>
          <View style={styles.securityInfo}>
            <Text style={[styles.securityTitle, { color: colors.gold }]}>Invite Friends & Earn Free Access</Text>
            <Text style={styles.securityDesc}>
              Get your unique invite link. Earn 30 to 60 days of free access for verified referrals.
            </Text>
          </View>
          <Text style={[styles.securityChevron, { color: colors.gold }]}>➔</Text>
        </TouchableOpacity>

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
    minWidth: 0,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
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
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
    alignItems: 'center',
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
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardElevated,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    maxWidth: '100%',
  },
  locationBadgeText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
    flexShrink: 1,
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
    overflow: 'hidden',
  },
  verificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  verificationTitle: {
    ...typography.h3,
    color: colors.text,
    fontSize: 15,
    flex: 1,
    minWidth: 160,
  },
  verBadge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
    flexShrink: 0,
    marginTop: 2,
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
  themeDropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    minHeight: 64,
  },
  dropdownTriggerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    marginRight: spacing.sm,
  },
  triggerSwatchBadge: {
    width: 38,
    height: 38,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    flexShrink: 0,
  },
  triggerBadgeEmoji: {
    fontSize: 18,
  },
  triggerTextCol: {
    flex: 1,
    minWidth: 0,
  },
  triggerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  triggerThemeName: {
    ...typography.body,
    fontWeight: '700',
    fontSize: 15,
  },
  triggerThemeTagline: {
    ...typography.caption,
    fontSize: 11,
    marginTop: 2,
  },
  palettePreviewStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  paletteDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 0.5,
  },
  chevronWrap: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginLeft: 4,
  },
  chevronText: {
    fontSize: 11,
    fontWeight: '700',
  },
  themeDropdownMenu: {
    marginTop: spacing.sm,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  themeDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    minHeight: 52,
  },
  themeDropdownItemActive: {
    borderLeftWidth: 3,
  },
  dropdownItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    marginRight: spacing.sm,
  },
  itemSwatchBadge: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    flexShrink: 0,
  },
  itemBadgeEmoji: {
    fontSize: 15,
  },
  itemTextCol: {
    flex: 1,
    minWidth: 0,
  },
  itemNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  itemThemeName: {
    ...typography.body,
    fontSize: 14,
    fontWeight: '600',
  },
  itemThemeTagline: {
    ...typography.caption,
    fontSize: 11,
    marginTop: 1,
  },
  itemPaletteStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 3,
    marginLeft: spacing.xs,
  },
  paletteDotSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 0.5,
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
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  accordionTitleCol: {
    flex: 1,
    minWidth: 0,
    marginRight: spacing.sm,
  },
  accordionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  accordionIcon: {
    fontSize: 18,
    marginRight: 4,
  },
  accordionBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  accordionBadgeText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
  },
  accordionDesc: {
    ...typography.bodySmall,
    color: colors.textSubtle,
    fontSize: 11,
    marginTop: 2,
  },
  accordionChevronWrap: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  accordionChevronText: {
    fontSize: 12,
    fontWeight: '700',
  },
  accordionBody: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    paddingTop: spacing.md,
  },
  readOnlyFieldCard: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
  },
  readOnlyFieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  readOnlyFieldMain: {
    ...typography.bodyLarge,
    fontWeight: '700',
  },
  readOnlyFieldSub: {
    ...typography.caption,
    fontSize: 12,
  },
  readOnlyFieldNotice: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 15,
  },
  miniVerifyBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    marginTop: 4,
  },
  miniVerifyBtnText: {
    ...typography.caption,
    fontWeight: '700',
    fontSize: 11,
  },
  bioCharCount: {
    ...typography.caption,
    alignSelf: 'flex-end',
    marginTop: 4,
    fontSize: 11,
  },
  noticeBox: {
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    marginTop: spacing.xs,
  },
  noticeBoxText: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 15,
  },
  prefLoadingState: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  prefLoadingText: {
    ...typography.caption,
    fontSize: 12,
  },
  prefErrorState: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  prefErrorText: {
    ...typography.bodySmall,
    textAlign: 'center',
  },
  prefRetryBtn: {
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  prefRetryBtnText: {
    ...typography.bodySmall,
    fontWeight: '600',
  },
  prefSummaryContainer: {
    gap: spacing.md,
  },
  prefSummaryGrid: {
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  prefSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    gap: spacing.md,
  },
  prefSummaryLabel: {
    ...typography.bodySmall,
    fontWeight: '500',
    flex: 1,
  },
  prefSummaryValue: {
    ...typography.bodySmall,
    fontWeight: '600',
    textAlign: 'right',
    flex: 1.2,
  },
  prefStatusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  prefStatusBadgeText: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '700',
  },
  editFiltersBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editFiltersBtnText: {
    ...typography.body,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  favLoadingState: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  favLoadingText: {
    ...typography.caption,
    fontSize: 12,
  },
  favErrorState: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
  },
  favErrorText: {
    ...typography.caption,
    fontSize: 12,
    textAlign: 'center',
  },
  favRetryBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  favRetryBtnText: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '700',
  },
  favEmptyState: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  favEmptyIcon: {
    fontSize: 28,
    marginBottom: spacing.xs,
  },
  favEmptyTitle: {
    ...typography.body,
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 4,
    textAlign: 'center',
  },
  favEmptySubtitle: {
    ...typography.caption,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
  },
  favList: {
    gap: spacing.sm,
    paddingTop: 4,
  },
  favCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.sm,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  favCardTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacing.sm,
  },
  favAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  favAvatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  favPlaceholderMonogram: {
    fontSize: 18,
    fontWeight: '700',
  },
  favInfoCol: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  favNameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  favName: {
    ...typography.body,
    fontWeight: '700',
    fontSize: 14,
  },
  favAge: {
    ...typography.body,
    fontWeight: '600',
    fontSize: 13,
  },
  favBio: {
    ...typography.caption,
    fontSize: 11,
    marginTop: 2,
  },
  favRemoveBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  favRemoveBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
});

