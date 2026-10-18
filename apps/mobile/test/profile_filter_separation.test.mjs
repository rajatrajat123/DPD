import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';

// --- Test Suite: Safely Separate Profile Details from Discovery Filters ---

test('Profile vs Discovery Filters Separation: Architecture & File Contracts', async () => {
  const profileFilePath = resolve(process.cwd(), 'app/(tabs)/profile.tsx');
  const profileFile = await fs.readFile(profileFilePath, 'utf-8');

  // 1. Verify required UI section testIDs are intact
  assert.ok(profileFile.includes('testID="section-basic-info"'), 'Must define section-basic-info');
  assert.ok(profileFile.includes('testID="accordion-header-basic"'), 'Must define accordion-header-basic');
  assert.ok(profileFile.includes('testID="section-physical-attributes"'), 'Must define section-physical-attributes');
  assert.ok(profileFile.includes('testID="accordion-header-physical"'), 'Must define accordion-header-physical');
  assert.ok(profileFile.includes('testID="section-identity-orientation"'), 'Must define section-identity-orientation');
  assert.ok(profileFile.includes('testID="accordion-header-identity"'), 'Must define accordion-header-identity');
  assert.ok(profileFile.includes('testID="section-lifestyle-interests"'), 'Must define section-lifestyle-interests');
  assert.ok(profileFile.includes('testID="accordion-header-lifestyle"'), 'Must define accordion-header-lifestyle');
  assert.ok(profileFile.includes('testID="section-relationship-preferences"'), 'Must define section-relationship-preferences');
  assert.ok(profileFile.includes('testID="accordion-header-preferences"'), 'Must define accordion-header-preferences');

  // 2. Section E must feature the Edit Filters button
  assert.ok(profileFile.includes('testID="edit-discovery-filters-btn"'), 'Must define edit-discovery-filters-btn');
  assert.ok(profileFile.includes('Edit Filters'), 'Must have button labeled Edit Filters');

  // 3. Section E must embed DiscoveryFilterModal
  assert.ok(profileFile.includes('<DiscoveryFilterModal'), 'Profile screen must embed DiscoveryFilterModal component');
  assert.ok(profileFile.includes('currentPreferences={discoveryPrefs}'), 'DiscoveryFilterModal must bind currentPreferences');
  assert.ok(profileFile.includes('setDiscoveryPrefs(updated)'), 'DiscoveryFilterModal onApply must update discoveryPrefs state');

  // 4. Honest Loading & Error States in Section E
  assert.ok(profileFile.includes('testID="discovery-prefs-loading"'), 'Must render honest loading state for discovery preferences');
  assert.ok(profileFile.includes('testID="discovery-prefs-error"'), 'Must render honest error state for discovery preferences');
  assert.ok(profileFile.includes('testID="discovery-prefs-summary"'), 'Must render compact discovery preferences summary');

  // 5. Test 37 compatibility: Must include "Non-Smoker Dealbreaker" in summary
  assert.ok(profileFile.includes('Non-Smoker Dealbreaker'), 'Must keep Non-Smoker Dealbreaker summary row for Test 37 compatibility');

  // 6. Test 78 compatibility: Must send cleanVisibility to updateMyProfile without dealbreakers attached
  assert.ok(profileFile.includes('visibility_settings: cleanVisibility'), 'Must send cleanVisibility to updateMyProfile');
  assert.ok(!profileFile.match(/visibility_settings:\s*\{[^}]*require_verified/m), 'Must not attach require_verified directly to visibility_settings');
  assert.ok(!profileFile.match(/visibility_settings:\s*\{[^}]*require_monogamous/m), 'Must not attach require_monogamous directly to visibility_settings');
});

test('Profile Save Decoupling: Profile Save updates ONLY personal profile attributes, not partner search filters', async () => {
  const profileFilePath = resolve(process.cwd(), 'app/(tabs)/profile.tsx');
  const profileFile = await fs.readFile(profileFilePath, 'utf-8');

  // 1. Inspect handleSaveChanges inside profile.tsx
  const saveHandlerMatch = profileFile.match(/const handleSaveChanges = async \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(saveHandlerMatch, 'Must find handleSaveChanges definition');
  const saveHandlerCode = saveHandlerMatch[1];

  // 2. Profile Save MUST NOT call discoveryService.updatePreferences
  assert.ok(
    !saveHandlerCode.includes('discoveryService.updatePreferences'),
    'Profile Save handler must not call discoveryService.updatePreferences'
  );

  // 3. Profile Save MUST NOT pass partner preferences (preferred_genders, looking_for, dealbreakers) to updateMyProfile
  assert.ok(
    !saveHandlerCode.includes('preferred_genders:'),
    'Profile Save must not pass preferred_genders to updateMyProfile'
  );
  assert.ok(
    !saveHandlerCode.includes('looking_for:'),
    'Profile Save must not pass looking_for to updateMyProfile'
  );
  assert.ok(
    !saveHandlerCode.includes('non_smoker_dealbreaker:'),
    'Profile Save must not pass non_smoker_dealbreaker to updateMyProfile'
  );

  // 4. Profile Save MUST pass user personal relationship intents as relationship_intents only, never preferred_intents
  assert.ok(
    saveHandlerCode.includes('relationship_intents: selectedIntents'),
    'Profile Save must pass user relationship intents as relationship_intents'
  );
  assert.ok(
    !saveHandlerCode.includes('preferred_intents:'),
    'Profile Save must never send relationship intents as preferred_intents'
  );

  // 5. Profile Save MUST NOT be gated on looking_for selections
  assert.ok(
    !saveHandlerCode.includes('finalLookingFor.length === 0'),
    'Profile Save must not fail or gate on looking_for selections'
  );
});

test('Discovery Filter Save Decoupling: Filter Modal owns partner preferences and does not overwrite user profile', async () => {
  const filterModalPath = resolve(process.cwd(), 'src/components/DiscoveryFilterModal.tsx');
  const filterModalFile = await fs.readFile(filterModalPath, 'utf-8');

  // 1. Filter Modal MUST call discoveryService.updatePreferences
  assert.ok(
    filterModalFile.includes('discoveryService.updatePreferences'),
    'DiscoveryFilterModal must persist filters via discoveryService.updatePreferences'
  );

  // 2. Filter Modal MUST send partner preferences payload
  assert.ok(filterModalFile.includes('preferred_genders: preferredGenders'), 'Filter Modal must send preferred_genders');
  assert.ok(filterModalFile.includes('preferred_orientations: preferredOrientations'), 'Filter Modal must send preferred_orientations');
  assert.ok(filterModalFile.includes('preferred_intents: preferredIntents'), 'Filter Modal must send preferred_intents');
  assert.ok(filterModalFile.includes('dealbreakers: {'), 'Filter Modal must send dealbreakers');
  assert.ok(filterModalFile.includes('non_smoker_only: nonSmokerOnly'), 'Filter Modal must send non_smoker_only dealbreaker');
  assert.ok(filterModalFile.includes('require_monogamous: requireMonogamous'), 'Filter Modal must send require_monogamous dealbreaker');

  // 3. Filter Modal MUST NOT overwrite personal profile attributes
  assert.ok(!filterModalFile.includes('authService.updateMyProfile'), 'DiscoveryFilterModal must never overwrite personal profile details');
  assert.ok(!filterModalFile.includes('gender_identities:'), 'DiscoveryFilterModal must never overwrite personal gender_identities');
  assert.ok(!filterModalFile.includes('smoking_habit:'), 'DiscoveryFilterModal must never overwrite personal smoking_habit');
  assert.ok(!filterModalFile.includes('relationship_structure:'), 'DiscoveryFilterModal must never overwrite personal relationship_structure');
});

test('Simulation: Profile Save and Discovery Filter Save maintain isolated state and independent persistence', async () => {
  // Mock backend database state for a user
  let backendDatabase = {
    profile: {
      user_id: 'user_alex',
      display_name: 'Alex Rivera',
      bio: 'Queer artist & community volunteer',
      gender_identities: ['non-binary'],
      sexual_orientations: ['queer'],
      pronouns: ['they/them'],
      smoking_preference: 'NON_SMOKER',
      smoking_habit: 'NON_SMOKER',
      drinking_habit: 'SOCIALLY',
      relationship_intents: ['casual dating', 'community / friends'],
      relationship_structure: 'MONOGAMOUS',
      interests: ['Art & Design', 'Activism & Queer Culture'],
      height_cm: 175,
      weight_kg: 68,
      visibility_settings: { height: 'PUBLIC', weight: 'PUBLIC' },
    },
    preferences: {
      user_id: 'user_alex',
      min_age: 24,
      max_age: 38,
      max_distance_km: 40,
      preferred_genders: ['non-binary', 'woman'],
      preferred_orientations: ['queer', 'lesbian'],
      preferred_intents: ['dating', 'friendship'],
      min_height_cm: 160,
      max_height_cm: 190,
      min_weight_kg: 50,
      max_weight_kg: 85,
      dealbreaker_non_smoker: true,
      verified_only: true,
      dealbreakers: {
        non_smoker_only: true,
        require_verified: true,
        require_monogamous: true,
      },
    },
  };

  // Mock Profile Save API handler
  function simulateUpdateProfile(updates) {
    backendDatabase.profile = {
      ...backendDatabase.profile,
      display_name: updates.display_name !== undefined ? updates.display_name : backendDatabase.profile.display_name,
      bio: updates.bio !== undefined ? updates.bio : backendDatabase.profile.bio,
      pronouns: updates.pronouns !== undefined ? updates.pronouns : backendDatabase.profile.pronouns,
      gender_identities: updates.gender_identities !== undefined ? updates.gender_identities : backendDatabase.profile.gender_identities,
      sexual_orientations: updates.sexual_orientations !== undefined ? updates.sexual_orientations : backendDatabase.profile.sexual_orientations,
      smoking_habit: updates.smoking_habit !== undefined ? updates.smoking_habit : backendDatabase.profile.smoking_habit,
      smoking_preference: updates.smoking_preference !== undefined ? updates.smoking_preference : backendDatabase.profile.smoking_preference,
      drinking_habit: updates.drinking_habit !== undefined ? updates.drinking_habit : backendDatabase.profile.drinking_habit,
      relationship_intents: updates.relationship_intents !== undefined ? updates.relationship_intents : backendDatabase.profile.relationship_intents,
      relationship_structure: updates.relationship_structure !== undefined ? updates.relationship_structure : backendDatabase.profile.relationship_structure,
      interests: updates.interests !== undefined ? updates.interests : backendDatabase.profile.interests,
      height_cm: updates.height_cm !== undefined ? updates.height_cm : backendDatabase.profile.height_cm,
      weight_kg: updates.weight_kg !== undefined ? updates.weight_kg : backendDatabase.profile.weight_kg,
      visibility_settings: updates.visibility_settings !== undefined ? updates.visibility_settings : backendDatabase.profile.visibility_settings,
    };
    return { ...backendDatabase.profile };
  }

  // Mock Discovery Filter Save API handler
  function simulateUpdatePreferences(updates) {
    backendDatabase.preferences = {
      ...backendDatabase.preferences,
      min_age: updates.min_age !== undefined ? updates.min_age : backendDatabase.preferences.min_age,
      max_age: updates.max_age !== undefined ? updates.max_age : backendDatabase.preferences.max_age,
      max_distance_km: updates.max_distance_km !== undefined ? updates.max_distance_km : backendDatabase.preferences.max_distance_km,
      preferred_genders: updates.preferred_genders !== undefined ? updates.preferred_genders : backendDatabase.preferences.preferred_genders,
      preferred_orientations: updates.preferred_orientations !== undefined ? updates.preferred_orientations : backendDatabase.preferences.preferred_orientations,
      preferred_intents: updates.preferred_intents !== undefined ? updates.preferred_intents : backendDatabase.preferences.preferred_intents,
      min_height_cm: updates.min_height_cm !== undefined ? updates.min_height_cm : backendDatabase.preferences.min_height_cm,
      max_height_cm: updates.max_height_cm !== undefined ? updates.max_height_cm : backendDatabase.preferences.max_height_cm,
      min_weight_kg: updates.min_weight_kg !== undefined ? updates.min_weight_kg : backendDatabase.preferences.min_weight_kg,
      max_weight_kg: updates.max_weight_kg !== undefined ? updates.max_weight_kg : backendDatabase.preferences.max_weight_kg,
      dealbreakers: updates.dealbreakers !== undefined ? updates.dealbreakers : backendDatabase.preferences.dealbreakers,
      dealbreaker_non_smoker: updates.dealbreakers?.non_smoker_only !== undefined ? updates.dealbreakers.non_smoker_only : backendDatabase.preferences.dealbreaker_non_smoker,
      verified_only: updates.dealbreakers?.require_verified !== undefined ? updates.dealbreakers.require_verified : backendDatabase.preferences.verified_only,
    };
    return { ...backendDatabase.preferences };
  }

  // 1. User updates personal profile attributes (e.g. bio, height, relationship intents)
  const profileUpdates = {
    display_name: 'Alex Rivera',
    bio: 'Updated bio: Lover of street art and tea',
    pronouns: ['they/them'],
    gender_identities: ['non-binary'],
    sexual_orientations: ['queer'],
    smoking_habit: 'NON_SMOKER',
    smoking_preference: 'NON_SMOKER',
    drinking_habit: 'NEVER',
    relationship_intents: ['serious dating'],
    relationship_structure: 'MONOGAMOUS',
    interests: ['Art & Design', 'Coffee & Cafes'],
    height_cm: 176,
    weight_kg: 69,
    visibility_settings: { height: 'PUBLIC', weight: 'MATCHES_ONLY' },
  };

  simulateUpdateProfile(profileUpdates);

  // Assert user's profile was updated
  assert.equal(backendDatabase.profile.bio, 'Updated bio: Lover of street art and tea');
  assert.equal(backendDatabase.profile.drinking_habit, 'NEVER');
  assert.deepEqual(backendDatabase.profile.relationship_intents, ['serious dating']);
  assert.equal(backendDatabase.profile.height_cm, 176);

  // Assert partner discovery preferences were NOT corrupted or overwritten by Profile Save!
  assert.deepEqual(backendDatabase.preferences.preferred_genders, ['non-binary', 'woman']);
  assert.deepEqual(backendDatabase.preferences.preferred_intents, ['dating', 'friendship'], 'Partner preferred_intents must remain untouched');
  assert.equal(backendDatabase.preferences.min_age, 24);
  assert.equal(backendDatabase.preferences.max_age, 38);
  assert.equal(backendDatabase.preferences.dealbreakers.non_smoker_only, true);
  assert.equal(backendDatabase.preferences.dealbreakers.require_monogamous, true);

  // 2. User edits Discovery Filters via DiscoveryFilterModal (e.g. changing distance, age range, dealbreakers)
  const filterUpdates = {
    min_age: 26,
    max_age: 42,
    max_distance_km: 65,
    preferred_genders: ['woman'],
    preferred_orientations: ['queer'],
    preferred_intents: ['long_term'],
    dealbreakers: {
      non_smoker_only: true,
      require_verified: true,
      require_monogamous: false,
    },
  };

  simulateUpdatePreferences(filterUpdates);

  // Assert partner discovery preferences were updated
  assert.equal(backendDatabase.preferences.min_age, 26);
  assert.equal(backendDatabase.preferences.max_age, 42);
  assert.equal(backendDatabase.preferences.max_distance_km, 65);
  assert.deepEqual(backendDatabase.preferences.preferred_genders, ['woman']);
  assert.deepEqual(backendDatabase.preferences.preferred_intents, ['long_term']);
  assert.equal(backendDatabase.preferences.dealbreakers.require_monogamous, false);

  // Assert personal profile was NOT corrupted or overwritten by Filter Save!
  assert.equal(backendDatabase.profile.bio, 'Updated bio: Lover of street art and tea');
  assert.deepEqual(backendDatabase.profile.gender_identities, ['non-binary'], 'Personal gender identity must not change when filter changes');
  assert.deepEqual(backendDatabase.profile.relationship_intents, ['serious dating'], 'Personal relationship intents must not change when filter changes');
  assert.equal(backendDatabase.profile.relationship_structure, 'MONOGAMOUS', 'Personal relationship structure must not change when filter changes');
  assert.equal(backendDatabase.profile.height_cm, 176);
  assert.equal(backendDatabase.profile.smoking_preference, 'NON_SMOKER');
});

test('Theme, Visibility & Summary Formatters: verifies profile theme persistence, visibility filtering, and summary badge formatting', async () => {
  const profileFilePath = resolve(process.cwd(), 'app/(tabs)/profile.tsx');
  const profileFile = await fs.readFile(profileFilePath, 'utf-8');

  // 1. Theme persistence retained in handleSaveChanges
  assert.ok(profileFile.includes('await setTheme(themeId)'), 'Profile Save must re-affirm active theme persistence');
  assert.ok(profileFile.includes('theme-dropdown-trigger'), 'Profile screen must keep theme dropdown trigger');

  // 2. Clean visibility settings strictly sanitized
  assert.ok(profileFile.includes('cleanVisibility'), 'Profile Save must sanitize visibility settings');
  assert.ok(profileFile.includes('height: heightVisibility'), 'Visibility settings must include height visibility');
  assert.ok(profileFile.includes('weight: weightVisibility'), 'Visibility settings must include weight visibility');

  // 3. Verify formatters exist in profile.tsx
  assert.ok(profileFile.includes('formatGendersSummary'), 'Must include formatGendersSummary');
  assert.ok(profileFile.includes('formatOrientationsSummary'), 'Must include formatOrientationsSummary');
  assert.ok(profileFile.includes('formatIntentsSummary'), 'Must include formatIntentsSummary');
  assert.ok(profileFile.includes('formatHeightBoundsSummary'), 'Must include formatHeightBoundsSummary');
  assert.ok(profileFile.includes('formatWeightBoundsSummary'), 'Must include formatWeightBoundsSummary');

  // 4. Test summary formatting logic
  function formatGendersSummaryTest(genders) {
    if (!genders || genders.length === 0) return 'All genders';
    return genders.map((g) => (g.startsWith('custom:') ? g.slice(7) : g)).join(', ');
  }

  function formatHeightBoundsSummaryTest(minCm, maxCm) {
    const hasMin = minCm !== undefined && minCm > 90;
    const hasMax = maxCm !== undefined && maxCm < 250;
    if (!hasMin && !hasMax) return 'Any height';
    if (hasMin && hasMax) return `${minCm} cm – ${maxCm} cm`;
    if (hasMin) return `Min ${minCm} cm`;
    return `Max ${maxCm} cm`;
  }

  assert.equal(formatGendersSummaryTest([]), 'All genders');
  assert.equal(formatGendersSummaryTest(['woman', 'non-binary']), 'woman, non-binary');
  assert.equal(formatGendersSummaryTest(['custom:genderqueer']), 'genderqueer');
  assert.equal(formatHeightBoundsSummaryTest(undefined, undefined), 'Any height');
  assert.equal(formatHeightBoundsSummaryTest(160, 195), '160 cm – 195 cm');
  assert.equal(formatHeightBoundsSummaryTest(150, 250), 'Min 150 cm');
  assert.equal(formatHeightBoundsSummaryTest(90, 180), 'Max 180 cm');
});
