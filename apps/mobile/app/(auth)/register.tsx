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
import { useRouter } from 'expo-router';
import { colors, typography, spacing, borderRadius } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';
import { ApiError } from '../../src/services/api/client';
import { GoogleSignInButton } from '../../src/components/GoogleSignInButton';

export interface TaxonomyOption {
  value: string;
  label: string;
}

// Section 1: I am a — Gender identity
export const GENDER_IDENTITY_OPTIONS: TaxonomyOption[] = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'non-binary', label: 'Non-Binary' },
  { value: 'transgender woman', label: 'Transgender Woman' },
  { value: 'transgender man', label: 'Transgender Man' },
  { value: 'cisgender woman', label: 'Cisgender Woman' },
  { value: 'cisgender man', label: 'Cisgender Man' },
  { value: 'genderfluid', label: 'Genderfluid' },
  { value: 'agender', label: 'Agender' },
  { value: 'two-spirit', label: 'Two-Spirit' },
  { value: 'genderqueer', label: 'Genderqueer' },
  { value: 'intersex', label: 'Intersex' },
  { value: 'prefer not to say', label: 'Prefer not to say' },
  { value: 'custom', label: 'Another identity' },
];

// Section 2: Looking for — Gender preferences
export const LOOKING_FOR_OPTIONS: TaxonomyOption[] = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'non-binary', label: 'Non-Binary' },
  { value: 'transgender woman', label: 'Transgender Woman' },
  { value: 'transgender man', label: 'Transgender Man' },
  { value: 'cisgender woman', label: 'Cisgender Woman' },
  { value: 'cisgender man', label: 'Cisgender Man' },
  { value: 'genderfluid', label: 'Genderfluid' },
  { value: 'agender', label: 'Agender' },
  { value: 'two-spirit', label: 'Two-Spirit' },
  { value: 'genderqueer', label: 'Genderqueer' },
  { value: 'intersex', label: 'Intersex' },
  { value: 'all', label: 'Everyone / Open to all' },
  { value: 'custom', label: 'Another identity' },
];

// Section 3: Sexual orientation (Strictly separated from gender identity)
export const SEXUAL_ORIENTATION_OPTIONS: TaxonomyOption[] = [
  { value: 'lesbian', label: 'Lesbian' },
  { value: 'gay', label: 'Gay' },
  { value: 'bisexual', label: 'Bisexual' },
  { value: 'pansexual', label: 'Pansexual' },
  { value: 'queer', label: 'Queer' },
  { value: 'asexual', label: 'Asexual' },
  { value: 'demisexual', label: 'Demisexual' },
  { value: 'questioning', label: 'Questioning' },
  { value: 'straight', label: 'Straight / Heterosexual' },
  { value: 'prefer not to say', label: 'Prefer not to say' },
  { value: 'custom', label: 'Another orientation' },
];

// Backwards-compatible aliases
export const GENDER_OPTIONS = GENDER_IDENTITY_OPTIONS;
export const ORIENTATION_OPTIONS = SEXUAL_ORIENTATION_OPTIONS;

function validatePassword(pwd: string): string | null {
  if (pwd.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (pwd.length > 128) {
    return 'Password cannot exceed 128 characters.';
  }
  if (!/\d/.test(pwd)) {
    return 'Password must contain at least one numeric digit (0-9).';
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(pwd)) {
    return 'Password must contain at least one special character (!, @, #, $, _, etc.).';
  }
  return null;
}

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [birthdate, setBirthdate] = useState('');

  // 1. I am a — Gender identity
  const [selectedGenders, setSelectedGenders] = useState<string[]>([]);
  const [customGenderText, setCustomGenderText] = useState('');

  // 2. Looking for — Gender preferences
  const [selectedLookingFor, setSelectedLookingFor] = useState<string[]>([]);
  const [customLookingForText, setCustomLookingForText] = useState('');

  // 3. Sexual orientation
  const [selectedOrientations, setSelectedOrientations] = useState<string[]>([]);
  const [customOrientationText, setCustomOrientationText] = useState('');

  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);

  // 4. Physical Attributes (Required for Discovery)
  const [heightUnit, setHeightUnit] = useState<'metric' | 'imperial'>('metric');
  const [weightUnit, setWeightUnit] = useState<'metric' | 'imperial'>('metric');
  const [heightCmText, setHeightCmText] = useState('');
  const [heightFtText, setHeightFtText] = useState('');
  const [heightInText, setHeightInText] = useState('');
  const [weightKgText, setWeightKgText] = useState('');
  const [weightLbText, setWeightLbText] = useState('');

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

  const buildFinalList = (selected: string[], customText: string): string[] => {
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
  };

  const handleRegister = async () => {
    if (!displayName.trim() || !email.trim() || !password || !birthdate.trim()) {
      Alert.alert('Required Fields', 'Please complete display name, email, password, and birthdate.');
      return;
    }

    if (displayName.trim().length > 50) {
      Alert.alert('Invalid Name', 'Display name cannot exceed 50 characters.');
      return;
    }

    const pwdErr = validatePassword(password);
    if (pwdErr) {
      Alert.alert('Weak Password', pwdErr);
      return;
    }

    // 1. Validate Gender Identity ("I am a")
    const finalGenders = buildFinalList(selectedGenders, customGenderText);
    if (finalGenders.length === 0) {
      Alert.alert('Gender Identity Required', 'Please select at least one gender identity under "I am a".');
      return;
    }

    // 2. Validate Gender Preferences ("Looking for")
    const finalLookingFor = buildFinalList(selectedLookingFor, customLookingForText);
    if (finalLookingFor.length === 0) {
      Alert.alert('Gender Preference Required', 'Please select who you are looking for under "Looking for".');
      return;
    }

    // 3. Validate Sexual Orientation
    const finalOrientations = buildFinalList(selectedOrientations, customOrientationText);
    if (finalOrientations.length === 0) {
      Alert.alert('Sexual Orientation Required', 'Please select at least one sexual orientation.');
      return;
    }

    // 4. Validate Height & Weight (Required for Discovery completion)
    let finalHeightCm: number | undefined;
    if (heightUnit === 'metric') {
      const parsed = parseInt(heightCmText.trim(), 10);
      if (isNaN(parsed) || parsed < 90 || parsed > 250) {
        Alert.alert('Height Required', 'Please enter a valid height between 90 cm and 250 cm.');
        return;
      }
      finalHeightCm = parsed;
    } else {
      const ft = parseInt(heightFtText.trim(), 10);
      const inch = parseInt(heightInText.trim() || '0', 10);
      if (isNaN(ft) || ft < 3 || ft > 8 || isNaN(inch) || inch < 0 || inch >= 12) {
        Alert.alert('Height Required', 'Please enter a valid height between 3 ft 0 in and 8 ft 2 in.');
        return;
      }
      const totalInches = ft * 12 + inch;
      const converted = Math.round(totalInches * 2.54);
      if (converted < 90 || converted > 250) {
        Alert.alert('Height Required', 'Height must be between 90 cm (3\'0") and 250 cm (8\'2").');
        return;
      }
      finalHeightCm = converted;
    }

    let finalWeightKg: number | undefined;
    if (weightUnit === 'metric') {
      const parsed = parseInt(weightKgText.trim(), 10);
      if (isNaN(parsed) || parsed < 30 || parsed > 300) {
        Alert.alert('Weight Required', 'Please enter a valid weight between 30 kg and 300 kg.');
        return;
      }
      finalWeightKg = parsed;
    } else {
      const lb = parseInt(weightLbText.trim(), 10);
      if (isNaN(lb) || lb < 66 || lb > 660) {
        Alert.alert('Weight Required', 'Please enter a valid weight between 66 lb and 660 lb.');
        return;
      }
      finalWeightKg = Math.round(lb * 0.45359237);
    }

    // Preflight 18+ check
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

    setLoading(true);
    try {
      await register({
        display_name: displayName.trim(),
        email: email.trim(),
        password,
        birthdate: birthdate.trim(),
        gender_identities: finalGenders,
        preferred_genders: finalLookingFor,
        looking_for: finalLookingFor,
        sexual_orientations: finalOrientations,
        height_cm: finalHeightCm,
        weight_kg: finalWeightKg,
        referral_code: referralCode.trim() || undefined,
      });

      router.replace('/(tabs)');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Registration failed. Please check your details.';
      Alert.alert('Registration Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const hasCustomGender = selectedGenders.includes('custom');
  const hasCustomLookingFor = selectedLookingFor.includes('custom');
  const hasCustomOrientation = selectedOrientations.includes('custom');

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.brandTitle}>AURA</Text>
          <Text style={styles.brandSubtitle}>Create Your Member Profile</Text>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Membership Application</Text>

          {/* Chosen Display Name */}
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
            />
          </View>

          {/* Account Credentials */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Email Address</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.com"
              placeholderTextColor={colors.textSubtle}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputGroup}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.inputLabel}>Password (Min 8 Chars, Digit & Special)</Text>
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ color: colors.gold, fontSize: 12, marginBottom: spacing.xs }}>
                  {showPassword ? 'Hide' : 'Show'}
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••••••"
              placeholderTextColor={colors.textSubtle}
              secureTextEntry={!showPassword}
              maxLength={128}
              autoCapitalize="none"
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
            />
          </View>

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
            {hasCustomGender && (
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
            {hasCustomLookingFor && (
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
            {hasCustomOrientation && (
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

          {/* SECTION 4: Height & Weight (Required for Discovery) */}
          <View style={styles.inputGroup}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeaderLabel}>4. Height (Required)</Text>
              <View style={styles.unitToggleGroup}>
                <TouchableOpacity
                  style={[styles.unitToggleBtn, heightUnit === 'metric' && styles.unitToggleBtnActive]}
                  onPress={() => setHeightUnit('metric')}
                >
                  <Text style={[styles.unitToggleText, heightUnit === 'metric' && styles.unitToggleTextActive]}>cm</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.unitToggleBtn, heightUnit === 'imperial' && styles.unitToggleBtnActive]}
                  onPress={() => setHeightUnit('imperial')}
                >
                  <Text style={[styles.unitToggleText, heightUnit === 'imperial' && styles.unitToggleTextActive]}>ft / in</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.sectionSubLabel}>90–250 cm (3'0"–8'2")</Text>

            {heightUnit === 'metric' ? (
              <View style={styles.numericInputWrapper}>
                <TextInput
                  style={[styles.input, styles.numericInput]}
                  value={heightCmText}
                  onChangeText={setHeightCmText}
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
                    style={[styles.input, styles.numericInput]}
                    value={heightFtText}
                    onChangeText={setHeightFtText}
                    placeholder="5"
                    placeholderTextColor={colors.textSubtle}
                    keyboardType="numeric"
                    maxLength={1}
                  />
                  <Text style={styles.unitSuffix}>ft</Text>
                </View>
                <View style={[styles.numericInputWrapper, { flex: 1 }]}>
                  <TextInput
                    style={[styles.input, styles.numericInput]}
                    value={heightInText}
                    onChangeText={setHeightInText}
                    placeholder="9"
                    placeholderTextColor={colors.textSubtle}
                    keyboardType="numeric"
                    maxLength={2}
                  />
                  <Text style={styles.unitSuffix}>in</Text>
                </View>
              </View>
            )}
          </View>

          <View style={styles.inputGroup}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeaderLabel}>5. Weight (Required)</Text>
              <View style={styles.unitToggleGroup}>
                <TouchableOpacity
                  style={[styles.unitToggleBtn, weightUnit === 'metric' && styles.unitToggleBtnActive]}
                  onPress={() => setWeightUnit('metric')}
                >
                  <Text style={[styles.unitToggleText, weightUnit === 'metric' && styles.unitToggleTextActive]}>kg</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.unitToggleBtn, weightUnit === 'imperial' && styles.unitToggleBtnActive]}
                  onPress={() => setWeightUnit('imperial')}
                >
                  <Text style={[styles.unitToggleText, weightUnit === 'imperial' && styles.unitToggleTextActive]}>lb</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.sectionSubLabel}>30–300 kg (66–660 lb)</Text>

            {weightUnit === 'metric' ? (
              <View style={styles.numericInputWrapper}>
                <TextInput
                  style={[styles.input, styles.numericInput]}
                  value={weightKgText}
                  onChangeText={setWeightKgText}
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
                  style={[styles.input, styles.numericInput]}
                  value={weightLbText}
                  onChangeText={setWeightLbText}
                  placeholder="154"
                  placeholderTextColor={colors.textSubtle}
                  keyboardType="numeric"
                  maxLength={3}
                />
                <Text style={styles.unitSuffix}>lb</Text>
              </View>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Referral Code (Optional)</Text>
            <TextInput
              style={styles.input}
              value={referralCode}
              onChangeText={setReferralCode}
              placeholder="e.g. VIP2026"
              placeholderTextColor={colors.textSubtle}
              autoCapitalize="characters"
            />
          </View>

          <TouchableOpacity
            style={styles.submitBtn}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.submitBtnText}>Submit Application</Text>
            )}
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <GoogleSignInButton
            isRegister
            onSuccess={() => {
              router.replace('/(tabs)');
            }}
          />

          <View style={styles.footerRow}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/login')} activeOpacity={0.7}>
              <Text style={styles.loginLink}> Sign In</Text>
            </TouchableOpacity>
          </View>
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
    marginBottom: spacing.sm,
  },
  submitBtnText: {
    ...typography.button,
    color: colors.textInverse,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    ...typography.caption,
    color: colors.textMuted,
    marginHorizontal: spacing.md,
    fontWeight: '600',
    letterSpacing: 1,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  loginLink: {
    ...typography.bodySmall,
    color: colors.gold,
    fontWeight: '700',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
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
});
