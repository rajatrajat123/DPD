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

export interface TaxonomyOption {
  value: string;
  label: string;
}

export const GENDER_OPTIONS: TaxonomyOption[] = [
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
];

export const ORIENTATION_OPTIONS: TaxonomyOption[] = [
  { value: 'lesbian', label: 'Lesbian' },
  { value: 'gay', label: 'Gay' },
  { value: 'bisexual', label: 'Bisexual' },
  { value: 'pansexual', label: 'Pansexual' },
  { value: 'queer', label: 'Queer' },
  { value: 'asexual', label: 'Asexual' },
  { value: 'demisexual', label: 'Demisexual' },
  { value: 'questioning', label: 'Questioning' },
];

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
  const [selectedGenders, setSelectedGenders] = useState<string[]>([]);
  const [selectedOrientations, setSelectedOrientations] = useState<string[]>([]);
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);

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

    if (selectedGenders.length === 0) {
      Alert.alert('Gender Identity', 'Please select at least one gender identity.');
      return;
    }

    if (selectedOrientations.length === 0) {
      Alert.alert('Sexual Orientation', 'Please select at least one sexual orientation.');
      return;
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
        gender_identities: selectedGenders,
        sexual_orientations: selectedOrientations,
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

          {/* LGBTQ+ Taxonomy */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Gender Identity (Select all that apply)</Text>
            <View style={styles.chipsRow}>
              {GENDER_OPTIONS.map((g) => {
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
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Sexual Orientation (Select all that apply)</Text>
            <View style={styles.chipsRow}>
              {ORIENTATION_OPTIONS.map((o) => {
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
    marginBottom: spacing.lg,
  },
  submitBtnText: {
    ...typography.button,
    color: colors.textInverse,
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
});
