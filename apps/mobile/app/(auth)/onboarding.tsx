import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { colors, typography, spacing, borderRadius } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';
import { authService } from '../../src/services/auth/authService';
import { ApiError } from '../../src/services/api/client';
import { Profile } from '../../src/types';
import {
  GENDER_IDENTITY_OPTIONS,
  LOOKING_FOR_OPTIONS,
  SEXUAL_ORIENTATION_OPTIONS,
  TaxonomyOption,
} from './register';

/**
 * Profile onboarding for accounts that do not have a profile yet.
 *
 * Google Sign-In only proves ownership of an email address: it never supplies
 * birthdate, gender identity, sexual orientation or any other profile detail.
 * Those values are collected here, validated by the backend, and the birthdate
 * becomes immutable afterwards.
 */
export default function OnboardingScreen() {
  const { refreshProfile } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [birthdate, setBirthdate] = useState('');

  const [selectedGenders, setSelectedGenders] = useState<string[]>([]);
  const [customGenderText, setCustomGenderText] = useState('');

  const [selectedLookingFor, setSelectedLookingFor] = useState<string[]>([]);
  const [customLookingForText, setCustomLookingForText] = useState('');

  const [selectedOrientations, setSelectedOrientations] = useState<string[]>([]);
  const [customOrientationText, setCustomOrientationText] = useState('');

  const [loading, setLoading] = useState(false);

  const toggle = (
    value: string,
    selected: string[],
    setSelected: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setSelected(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  const buildFinalList = (selected: string[], customText: string): string[] => {
    const list = selected.filter((item) => item !== 'custom');
    if (selected.includes('custom')) {
      const trimmed = customText.trim().toLowerCase();
      list.push(trimmed ? (trimmed.startsWith('custom:') ? trimmed : `custom:${trimmed}`) : 'custom');
    }
    return list;
  };

  const handleSubmit = async () => {
    if (!displayName.trim()) {
      Alert.alert('Display Name Required', 'Please choose a display name that other members will see.');
      return;
    }
    if (displayName.trim().length > 50) {
      Alert.alert('Invalid Name', 'Display name cannot exceed 50 characters.');
      return;
    }
    if (!birthdate.trim()) {
      Alert.alert('Birthdate Required', 'Please enter your birthdate in YYYY-MM-DD format.');
      return;
    }

    const birth = new Date(birthdate.trim());
    if (isNaN(birth.getTime())) {
      Alert.alert('Invalid Date', 'Please enter a valid birthdate in YYYY-MM-DD format.');
      return;
    }
    const today = new Date();
    const age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    const isAdult = m > 0 || (m === 0 && today.getDate() >= birth.getDate()) ? age >= 18 : age - 1 >= 18;
    if (!isAdult) {
      Alert.alert('18+ Only', 'Aura is strictly for adults 18 years and older.');
      return;
    }

    const finalGenders = buildFinalList(selectedGenders, customGenderText);
    if (finalGenders.length === 0) {
      Alert.alert('Gender Identity Required', 'Please select at least one gender identity under "I am a".');
      return;
    }

    const finalOrientations = buildFinalList(selectedOrientations, customOrientationText);
    if (finalOrientations.length === 0) {
      Alert.alert('Sexual Orientation Required', 'Please select at least one sexual orientation.');
      return;
    }

    const finalLookingFor = buildFinalList(selectedLookingFor, customLookingForText);

    setLoading(true);
    try {
      const profileUpdates: Partial<Profile> = {
        display_name: displayName.trim(),
        birthdate: birthdate.trim(),
        gender_identities: finalGenders,
        sexual_orientations: finalOrientations,
      };
      if (finalLookingFor.length > 0) {
        profileUpdates.preferred_genders = finalLookingFor;
        profileUpdates.looking_for = finalLookingFor;
      }

      await authService.updateMyProfile(profileUpdates);

      // Refreshing clears onboarding_required, which lets the navigation guard
      // move the member on to the next required step (age assurance) or the app.
      await refreshProfile();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'We could not save your profile. Please try again.';
      Alert.alert('Onboarding Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const renderChips = (
    options: TaxonomyOption[],
    selected: string[],
    setSelected: React.Dispatch<React.SetStateAction<string[]>>,
    testIDPrefix: string
  ) => (
    <View style={styles.chipsRow}>
      {options.map((option) => {
        const isSelected = selected.includes(option.value);
        return (
          <TouchableOpacity
            key={option.value}
            style={[styles.chip, isSelected ? styles.chipSelected : null]}
            onPress={() => toggle(option.value, selected, setSelected)}
            activeOpacity={0.7}
            testID={`${testIDPrefix}-${option.value}`}
          >
            <Text style={[styles.chipText, isSelected ? styles.chipTextSelected : null]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.brandTitle}>AURA</Text>
          <Text style={styles.brandSubtitle}>Complete Your Profile</Text>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Tell us about yourself</Text>
          <Text style={styles.helperText}>
            Google verified your email address. These details are yours to choose and are never
            taken from your Google account.
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Display Name (Chosen Name / What matches see)</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="e.g. Alex"
              placeholderTextColor={colors.textSubtle}
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={50}
              testID="onboarding-display-name"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Birthdate (YYYY-MM-DD) — 18+ Required</Text>
            <TextInput
              style={styles.input}
              value={birthdate}
              onChangeText={setBirthdate}
              placeholder="2000-01-15"
              placeholderTextColor={colors.textSubtle}
              autoCapitalize="none"
              testID="onboarding-birthdate"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.sectionHeaderLabel}>1. I am a — Gender identity</Text>
            <Text style={styles.sectionSubLabel}>Select all that apply</Text>
            {renderChips(GENDER_IDENTITY_OPTIONS, selectedGenders, setSelectedGenders, 'onboarding-gender')}
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

          <View style={styles.inputGroup}>
            <Text style={styles.sectionHeaderLabel}>2. Looking for — Gender preferences</Text>
            <Text style={styles.sectionSubLabel}>Optional — select all that apply</Text>
            {renderChips(LOOKING_FOR_OPTIONS, selectedLookingFor, setSelectedLookingFor, 'onboarding-looking-for')}
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

          <View style={styles.inputGroup}>
            <Text style={styles.sectionHeaderLabel}>3. Sexual orientation</Text>
            <Text style={styles.sectionSubLabel}>Select all that apply</Text>
            {renderChips(
              SEXUAL_ORIENTATION_OPTIONS,
              selectedOrientations,
              setSelectedOrientations,
              'onboarding-orientation'
            )}
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

          <TouchableOpacity
            style={styles.submitBtn}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.8}
            testID="onboarding-submit"
          >
            {loading ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.submitBtnText}>Continue</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    padding: spacing.xl,
    paddingTop: spacing.xxxl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  brandTitle: {
    ...typography.h1,
    color: colors.text,
    letterSpacing: 4,
  },
  brandSubtitle: {
    ...typography.caption,
    color: colors.gold,
    letterSpacing: 2,
    marginTop: 4,
  },
  formCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formTitle: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  helperText: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
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
    paddingVertical: spacing.xs,
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
  submitBtn: {
    backgroundColor: colors.gold,
    height: 50,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  submitBtnText: {
    ...typography.button,
    color: colors.textInverse,
  },
});
