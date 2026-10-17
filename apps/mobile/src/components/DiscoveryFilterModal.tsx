import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, useTheme } from '../theme';
import { DiscoveryPreferences } from '../types';
import { discoveryService } from '../services/discovery/discoveryService';
import { RangeSlider } from './RangeSlider';
import { SingleSlider } from './SingleSlider';
import {
  LOOKING_FOR_OPTIONS,
  SEXUAL_ORIENTATION_OPTIONS,
} from '../../app/(auth)/register';

const INTENT_OPTIONS = [
  { value: 'dating', label: 'Dating' },
  { value: 'long_term', label: 'Long-term' },
  { value: 'friendship', label: 'Friendship' },
  { value: 'casual', label: 'Casual / Hookups' },
  { value: 'exploring', label: 'Open to Explore' },
];

const DISTANCE_PRESETS_MILES = [5, 15, 25, 50, 100, 160];

interface DiscoveryFilterModalProps {
  visible: boolean;
  onClose: () => void;
  onApply: (updated: DiscoveryPreferences) => void;
  currentPreferences?: DiscoveryPreferences | null;
}

// Unit conversion helpers
export const cmToFtIn = (cm: number) => {
  const totalIn = Math.round(cm / 2.54);
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn % 12;
  return { ft, inch, label: `${ft}'${inch}"` };
};

export const ftInToCm = (ft: number, inch: number) => {
  const totalIn = (Number(ft) || 0) * 12 + (Number(inch) || 0);
  return Math.round(totalIn * 2.54);
};

export const kgToLb = (kg: number) => {
  return Math.round(kg / 0.45359237);
};

export const lbToKg = (lb: number) => {
  return Math.round(lb * 0.45359237);
};

export const milesToKm = (miles: number) => {
  return Math.round(miles * 1.60934);
};

export const kmToMiles = (km: number) => {
  return Math.round(km / 1.60934);
};

export const DiscoveryFilterModal: React.FC<DiscoveryFilterModalProps> = ({
  visible,
  onClose,
  onApply,
  currentPreferences,
}) => {
  const { colors } = useTheme();
  // Age Range (18 - 99)
  const [minAge, setMinAge] = useState(18);
  const [maxAge, setMaxAge] = useState(99);
  const [minAgeText, setMinAgeText] = useState('18');
  const [maxAgeText, setMaxAgeText] = useState('99');

  // Maximum Distance (2 - 160 miles)
  const [distanceMiles, setDistanceMiles] = useState(50);
  const [distanceText, setDistanceText] = useState('50');

  // Height Filter (90 - 250 cm)
  const [heightUnit, setHeightUnit] = useState<'cm' | 'ft-in'>('cm');
  const [minHeightCm, setMinHeightCm] = useState(90);
  const [maxHeightCm, setMaxHeightCm] = useState(250);
  const [minHeightText, setMinHeightText] = useState('90');
  const [maxHeightText, setMaxHeightText] = useState('250');
  const [minHeightFt, setMinHeightFt] = useState('2');
  const [minHeightIn, setMinHeightIn] = useState('11');
  const [maxHeightFt, setMaxHeightFt] = useState('8');
  const [maxHeightIn, setMaxHeightIn] = useState('2');
  const [isHeightFiltered, setIsHeightFiltered] = useState(false);

  // Weight Filter (30 - 300 kg / 66 - 661 lb)
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg');
  const [minWeightKg, setMinWeightKg] = useState(30);
  const [maxWeightKg, setMaxWeightKg] = useState(300);
  const [minWeightText, setMinWeightText] = useState('30');
  const [maxWeightText, setMaxWeightText] = useState('300');
  const [minWeightLbText, setMinWeightLbText] = useState('66');
  const [maxWeightLbText, setMaxWeightLbText] = useState('661');
  const [isWeightFiltered, setIsWeightFiltered] = useState(false);

  // Gender & Orientation & Intents
  const [preferredGenders, setPreferredGenders] = useState<string[]>([]);
  const [preferredOrientations, setPreferredOrientations] = useState<string[]>([]);
  const [preferredIntents, setPreferredIntents] = useState<string[]>([]);

  // Toggles
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [nonSmokerOnly, setNonSmokerOnly] = useState(false);
  const [requireVerifiedDealbreaker, setRequireVerifiedDealbreaker] = useState(false);
  const [requireMonogamous, setRequireMonogamous] = useState(false);

  const [isSaving, setIsSaving] = useState(false);

  const syncHeightTexts = (minH: number, maxH: number) => {
    setMinHeightText(String(minH));
    setMaxHeightText(String(maxH));
    const minImp = cmToFtIn(minH);
    const maxImp = cmToFtIn(maxH);
    setMinHeightFt(String(minImp.ft));
    setMinHeightIn(String(minImp.inch));
    setMaxHeightFt(String(maxImp.ft));
    setMaxHeightIn(String(maxImp.inch));
  };

  const syncWeightTexts = (minW: number, maxW: number) => {
    setMinWeightText(String(minW));
    setMaxWeightText(String(maxW));
    setMinWeightLbText(String(kgToLb(minW)));
    setMaxWeightLbText(String(kgToLb(maxW)));
  };

  useEffect(() => {
    if (visible && currentPreferences) {
      // 1. Age
      const pMinAge = currentPreferences.min_age || 18;
      const pMaxAge = currentPreferences.max_age || 99;
      setMinAge(pMinAge);
      setMaxAge(pMaxAge);
      setMinAgeText(String(pMinAge));
      setMaxAgeText(String(pMaxAge));

      // 2. Distance: convert stored km to miles
      const km = currentPreferences.max_distance_km || 80;
      const miles = Math.min(160, Math.max(2, Math.round(km / 1.60934)));
      setDistanceMiles(miles);
      setDistanceText(String(miles));

      // 3. Height
      if (currentPreferences.min_height_cm || currentPreferences.max_height_cm) {
        setIsHeightFiltered(true);
        const minH = Math.max(90, Math.min(250, currentPreferences.min_height_cm || 90));
        const maxH = Math.max(minH, Math.min(250, currentPreferences.max_height_cm || 250));
        setMinHeightCm(minH);
        setMaxHeightCm(maxH);
        syncHeightTexts(minH, maxH);
      } else {
        setIsHeightFiltered(false);
        setMinHeightCm(90);
        setMaxHeightCm(250);
        syncHeightTexts(90, 250);
      }

      // 4. Weight
      if (currentPreferences.min_weight_kg || currentPreferences.max_weight_kg) {
        setIsWeightFiltered(true);
        const minW = Math.max(30, Math.min(300, currentPreferences.min_weight_kg || 30));
        const maxW = Math.max(minW, Math.min(300, currentPreferences.max_weight_kg || 300));
        setMinWeightKg(minW);
        setMaxWeightKg(maxW);
        syncWeightTexts(minW, maxW);
      } else {
        setIsWeightFiltered(false);
        setMinWeightKg(30);
        setMaxWeightKg(300);
        syncWeightTexts(30, 300);
      }

      // Preferences & Toggles
      setPreferredGenders(currentPreferences.preferred_genders || []);
      setPreferredOrientations(currentPreferences.preferred_orientations || []);
      setPreferredIntents(currentPreferences.preferred_intents || []);

      setVerifiedOnly(Boolean(currentPreferences.verified_only || currentPreferences.dealbreakers?.require_verified));
      setNonSmokerOnly(Boolean(currentPreferences.dealbreaker_non_smoker || currentPreferences.dealbreakers?.non_smoker_only));
      setRequireVerifiedDealbreaker(Boolean(currentPreferences.dealbreakers?.require_verified));
      setRequireMonogamous(Boolean(currentPreferences.dealbreakers?.require_monogamous));
    }
  }, [visible, currentPreferences]);

  const toggleGender = (val: string) => {
    setPreferredGenders((prev) =>
      prev.includes(val) ? prev.filter((g) => g !== val) : [...prev, val]
    );
  };

  const toggleOrientation = (val: string) => {
    setPreferredOrientations((prev) =>
      prev.includes(val) ? prev.filter((o) => o !== val) : [...prev, val]
    );
  };

  const toggleIntent = (val: string) => {
    setPreferredIntents((prev) =>
      prev.includes(val) ? prev.filter((i) => i !== val) : [...prev, val]
    );
  };

  const handleReset = () => {
    setMinAge(18);
    setMaxAge(99);
    setMinAgeText('18');
    setMaxAgeText('99');

    setDistanceMiles(50);
    setDistanceText('50');

    setMinHeightCm(90);
    setMaxHeightCm(250);
    syncHeightTexts(90, 250);
    setIsHeightFiltered(false);

    setMinWeightKg(30);
    setMaxWeightKg(300);
    syncWeightTexts(30, 300);
    setIsWeightFiltered(false);

    setPreferredGenders([]);
    setPreferredOrientations([]);
    setPreferredIntents([]);
    setVerifiedOnly(false);
    setNonSmokerOnly(false);
    setRequireVerifiedDealbreaker(false);
    setRequireMonogamous(false);
  };

  const handleApply = async () => {
    if (minAge > maxAge) {
      Alert.alert('Invalid Age Range', 'Minimum age cannot be greater than maximum age.');
      return;
    }

    if (minHeightCm > maxHeightCm) {
      Alert.alert('Invalid Height Range', 'Minimum height cannot exceed maximum height.');
      return;
    }

    if (minWeightKg > maxWeightKg) {
      Alert.alert('Invalid Weight Range', 'Minimum weight cannot exceed maximum weight.');
      return;
    }

    // Convert miles to km for backend persistence
    const maxDistanceKm = Math.round(distanceMiles * 1.60934);

    // Apply explicit bounds if filtered or non-default
    const parsedMinH = (isHeightFiltered || minHeightCm > 90) ? minHeightCm : undefined;
    const parsedMaxH = (isHeightFiltered || maxHeightCm < 250) ? maxHeightCm : undefined;
    const parsedMinW = (isWeightFiltered || minWeightKg > 30) ? minWeightKg : undefined;
    const parsedMaxW = (isWeightFiltered || maxWeightKg < 300) ? maxWeightKg : undefined;

    const updatedPayload: Partial<DiscoveryPreferences> = {
      min_age: minAge,
      max_age: maxAge,
      max_distance_km: maxDistanceKm,
      preferred_genders: preferredGenders,
      preferred_orientations: preferredOrientations,
      preferred_intents: preferredIntents,
      min_height_cm: parsedMinH,
      max_height_cm: parsedMaxH,
      min_weight_kg: parsedMinW,
      max_weight_kg: parsedMaxW,
      verified_only: verifiedOnly,
      dealbreaker_non_smoker: nonSmokerOnly,
      dealbreakers: {
        non_smoker_only: nonSmokerOnly,
        require_verified: requireVerifiedDealbreaker || verifiedOnly,
        require_monogamous: requireMonogamous,
      },
    };

    setIsSaving(true);
    try {
      const saved = await discoveryService.updatePreferences(updatedPayload);
      onApply(saved);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not save filters.';
      Alert.alert('Filter Update Failed', msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        {/* Header Bar */}
        <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7} testID="filter-close-button">
            <Text style={[styles.closeBtnText, { color: colors.textSubtle }]}>✕</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Discovery Filters</Text>
          <TouchableOpacity onPress={handleReset} style={styles.resetBtn} activeOpacity={0.7} testID="filter-reset-button">
            <Text style={[styles.resetBtnText, { color: colors.gold }]}>Reset</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* 1. Age Range Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Age Range</Text>
              <Text style={styles.valueHighlight}>
                {minAge} – {maxAge} years
              </Text>
            </View>
            <Text style={styles.sectionDesc}>Filter candidates between 18 and 99 years old.</Text>

            {/* Direct Input Fields */}
            <View style={styles.rangeInputsRow}>
              <View style={styles.inputWrapper}>
                <Text style={styles.inputLabel}>Min Age</Text>
                <View style={styles.inputContainer}>
                  <TextInput
                    style={styles.textInput}
                    value={minAgeText}
                    onChangeText={(val) => {
                      setMinAgeText(val);
                      const n = parseInt(val, 10);
                      if (!isNaN(n) && n >= 18 && n <= 99) {
                        setMinAge(Math.min(n, maxAge));
                      }
                    }}
                    onBlur={() => {
                      const n = parseInt(minAgeText, 10);
                      if (isNaN(n) || n < 18) {
                        setMinAge(18);
                        setMinAgeText('18');
                      } else if (n > maxAge) {
                        setMinAge(maxAge);
                        setMinAgeText(String(maxAge));
                      } else {
                        setMinAge(n);
                        setMinAgeText(String(n));
                      }
                    }}
                    keyboardType="numeric"
                    maxLength={2}
                    placeholder="18"
                    placeholderTextColor={colors.textSubtle}
                    testID="min-age-input"
                  />
                  <Text style={styles.inputSuffix}>yrs</Text>
                </View>
              </View>

              <Text style={styles.rangeDash}>—</Text>

              <View style={styles.inputWrapper}>
                <Text style={styles.inputLabel}>Max Age</Text>
                <View style={styles.inputContainer}>
                  <TextInput
                    style={styles.textInput}
                    value={maxAgeText}
                    onChangeText={(val) => {
                      setMaxAgeText(val);
                      const n = parseInt(val, 10);
                      if (!isNaN(n) && n >= 18 && n <= 99) {
                        setMaxAge(Math.max(n, minAge));
                      }
                    }}
                    onBlur={() => {
                      const n = parseInt(maxAgeText, 10);
                      if (isNaN(n) || n > 99) {
                        setMaxAge(99);
                        setMaxAgeText('99');
                      } else if (n < minAge) {
                        setMaxAge(minAge);
                        setMaxAgeText(String(minAge));
                      } else {
                        setMaxAge(n);
                        setMaxAgeText(String(n));
                      }
                    }}
                    keyboardType="numeric"
                    maxLength={2}
                    placeholder="99"
                    placeholderTextColor={colors.textSubtle}
                    testID="max-age-input"
                  />
                  <Text style={styles.inputSuffix}>yrs</Text>
                </View>
              </View>
            </View>

            {/* Dual-ended Range Slider */}
            <RangeSlider
              min={18}
              max={99}
              step={1}
              minValue={minAge}
              maxValue={maxAge}
              onChange={(newMin, newMax) => {
                setMinAge(newMin);
                setMaxAge(newMax);
                setMinAgeText(String(newMin));
                setMaxAgeText(String(newMax));
              }}
              minLabel="18"
              maxLabel="99"
              testID="age-range-slider"
            />
          </View>

          {/* 2. Maximum Distance Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Maximum Distance</Text>
              <Text style={styles.valueHighlight}>
                {distanceMiles} mi ({milesToKm(distanceMiles)} km)
              </Text>
            </View>
            <Text style={styles.sectionDesc}>Search radius from 2 to 160 miles.</Text>

            {/* Direct Distance Input */}
            <View style={styles.singleInputRow}>
              <View style={[styles.inputWrapper, { maxWidth: 160 }]}>
                <Text style={styles.inputLabel}>Exact Distance</Text>
                <View style={styles.inputContainer}>
                  <TextInput
                    style={styles.textInput}
                    value={distanceText}
                    onChangeText={(val) => {
                      setDistanceText(val);
                      const n = parseInt(val, 10);
                      if (!isNaN(n) && n >= 2 && n <= 160) {
                        setDistanceMiles(n);
                      }
                    }}
                    onBlur={() => {
                      const n = parseInt(distanceText, 10);
                      if (isNaN(n) || n < 2) {
                        setDistanceMiles(2);
                        setDistanceText('2');
                      } else if (n > 160) {
                        setDistanceMiles(160);
                        setDistanceText('160');
                      } else {
                        setDistanceMiles(n);
                        setDistanceText(String(n));
                      }
                    }}
                    keyboardType="numeric"
                    maxLength={3}
                    placeholder="50"
                    placeholderTextColor={colors.textSubtle}
                    testID="distance-input"
                  />
                  <Text style={styles.inputSuffix}>miles</Text>
                </View>
              </View>

              {/* Quick Select Presets */}
              <View style={styles.compactChipsRow}>
                {DISTANCE_PRESETS_MILES.map((miles) => {
                  const selected = distanceMiles === miles;
                  return (
                    <TouchableOpacity
                      key={miles}
                      style={[styles.compactChip, selected ? styles.compactChipSelected : null]}
                      onPress={() => {
                        setDistanceMiles(miles);
                        setDistanceText(String(miles));
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.compactChipText, selected ? styles.compactChipTextSelected : null]}>
                        {miles}m
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Continuous Horizontal Slider */}
            <SingleSlider
              min={2}
              max={160}
              step={1}
              value={distanceMiles}
              onChange={(val) => {
                setDistanceMiles(val);
                setDistanceText(String(val));
              }}
              minLabel="2 mi"
              maxLabel="160 mi"
              testID="distance-slider"
            />
          </View>

          {/* 3. Height Filter Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionTitleRow}>
              <View>
                <Text style={styles.sectionTitle}>Height Bounds</Text>
                <Text style={styles.valueHighlight}>
                  {heightUnit === 'cm'
                    ? `${minHeightCm} – ${maxHeightCm} cm`
                    : `${cmToFtIn(minHeightCm).label} – ${cmToFtIn(maxHeightCm).label}`}
                </Text>
              </View>
              <View style={styles.unitToggleRow}>
                <TouchableOpacity
                  style={[styles.unitPill, heightUnit === 'cm' ? styles.unitPillActive : null]}
                  onPress={() => setHeightUnit('cm')}
                >
                  <Text style={[styles.unitPillText, heightUnit === 'cm' ? styles.unitPillTextActive : null]}>
                    cm
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.unitPill, heightUnit === 'ft-in' ? styles.unitPillActive : null]}
                  onPress={() => setHeightUnit('ft-in')}
                >
                  <Text style={[styles.unitPillText, heightUnit === 'ft-in' ? styles.unitPillTextActive : null]}>
                    ft/in
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.sectionDesc}>Filter candidates by height (90 to 250 cm / 3'0" to 8'2").</Text>

            {/* Direct Inputs: Metric vs Imperial */}
            {heightUnit === 'cm' ? (
              <View style={styles.rangeInputsRow}>
                <View style={styles.inputWrapper}>
                  <Text style={styles.inputLabel}>Min Height</Text>
                  <View style={styles.inputContainer}>
                    <TextInput
                      style={styles.textInput}
                      value={minHeightText}
                      onChangeText={(val) => {
                        setMinHeightText(val);
                        setIsHeightFiltered(true);
                        const n = parseInt(val, 10);
                        if (!isNaN(n) && n >= 90 && n <= 250) {
                          const clamped = Math.min(n, maxHeightCm);
                          setMinHeightCm(clamped);
                          const imp = cmToFtIn(clamped);
                          setMinHeightFt(String(imp.ft));
                          setMinHeightIn(String(imp.inch));
                        }
                      }}
                      onBlur={() => {
                        const n = parseInt(minHeightText, 10);
                        const clamped = isNaN(n) ? 90 : Math.max(90, Math.min(maxHeightCm, n));
                        setMinHeightCm(clamped);
                        syncHeightTexts(clamped, maxHeightCm);
                      }}
                      keyboardType="numeric"
                      maxLength={3}
                      placeholder="90"
                      placeholderTextColor={colors.textSubtle}
                      testID="min-height-input"
                    />
                    <Text style={styles.inputSuffix}>cm</Text>
                  </View>
                  <Text style={styles.conversionHint}>{cmToFtIn(minHeightCm).label}</Text>
                </View>

                <Text style={styles.rangeDash}>—</Text>

                <View style={styles.inputWrapper}>
                  <Text style={styles.inputLabel}>Max Height</Text>
                  <View style={styles.inputContainer}>
                    <TextInput
                      style={styles.textInput}
                      value={maxHeightText}
                      onChangeText={(val) => {
                        setMaxHeightText(val);
                        setIsHeightFiltered(true);
                        const n = parseInt(val, 10);
                        if (!isNaN(n) && n >= 90 && n <= 250) {
                          const clamped = Math.max(n, minHeightCm);
                          setMaxHeightCm(clamped);
                          const imp = cmToFtIn(clamped);
                          setMaxHeightFt(String(imp.ft));
                          setMaxHeightIn(String(imp.inch));
                        }
                      }}
                      onBlur={() => {
                        const n = parseInt(maxHeightText, 10);
                        const clamped = isNaN(n) ? 250 : Math.min(250, Math.max(minHeightCm, n));
                        setMaxHeightCm(clamped);
                        syncHeightTexts(minHeightCm, clamped);
                      }}
                      keyboardType="numeric"
                      maxLength={3}
                      placeholder="250"
                      placeholderTextColor={colors.textSubtle}
                      testID="max-height-input"
                    />
                    <Text style={styles.inputSuffix}>cm</Text>
                  </View>
                  <Text style={styles.conversionHint}>{cmToFtIn(maxHeightCm).label}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.rangeInputsRow}>
                {/* Min ft / in */}
                <View style={styles.inputWrapper}>
                  <Text style={styles.inputLabel}>Min Height</Text>
                  <View style={styles.dualFtInRow}>
                    <View style={[styles.inputContainer, { flex: 1 }]}>
                      <TextInput
                        style={styles.textInput}
                        value={minHeightFt}
                        onChangeText={(val) => {
                          setMinHeightFt(val);
                          setIsHeightFiltered(true);
                          const ft = parseInt(val, 10) || 0;
                          const inch = parseInt(minHeightIn, 10) || 0;
                          const cm = ftInToCm(ft, inch);
                          if (cm >= 90 && cm <= 250) {
                            const clamped = Math.min(cm, maxHeightCm);
                            setMinHeightCm(clamped);
                            setMinHeightText(String(clamped));
                          }
                        }}
                        keyboardType="numeric"
                        maxLength={1}
                        placeholder="5"
                        placeholderTextColor={colors.textSubtle}
                      />
                      <Text style={styles.inputSuffix}>ft</Text>
                    </View>
                    <View style={[styles.inputContainer, { flex: 1 }]}>
                      <TextInput
                        style={styles.textInput}
                        value={minHeightIn}
                        onChangeText={(val) => {
                          setMinHeightIn(val);
                          setIsHeightFiltered(true);
                          const ft = parseInt(minHeightFt, 10) || 0;
                          const inch = parseInt(val, 10) || 0;
                          const cm = ftInToCm(ft, inch);
                          if (cm >= 90 && cm <= 250) {
                            const clamped = Math.min(cm, maxHeightCm);
                            setMinHeightCm(clamped);
                            setMinHeightText(String(clamped));
                          }
                        }}
                        keyboardType="numeric"
                        maxLength={2}
                        placeholder="9"
                        placeholderTextColor={colors.textSubtle}
                      />
                      <Text style={styles.inputSuffix}>in</Text>
                    </View>
                  </View>
                  <Text style={styles.conversionHint}>{minHeightCm} cm</Text>
                </View>

                <Text style={styles.rangeDash}>—</Text>

                {/* Max ft / in */}
                <View style={styles.inputWrapper}>
                  <Text style={styles.inputLabel}>Max Height</Text>
                  <View style={styles.dualFtInRow}>
                    <View style={[styles.inputContainer, { flex: 1 }]}>
                      <TextInput
                        style={styles.textInput}
                        value={maxHeightFt}
                        onChangeText={(val) => {
                          setMaxHeightFt(val);
                          setIsHeightFiltered(true);
                          const ft = parseInt(val, 10) || 0;
                          const inch = parseInt(maxHeightIn, 10) || 0;
                          const cm = ftInToCm(ft, inch);
                          if (cm >= 90 && cm <= 250) {
                            const clamped = Math.max(cm, minHeightCm);
                            setMaxHeightCm(clamped);
                            setMaxHeightText(String(clamped));
                          }
                        }}
                        keyboardType="numeric"
                        maxLength={1}
                        placeholder="6"
                        placeholderTextColor={colors.textSubtle}
                      />
                      <Text style={styles.inputSuffix}>ft</Text>
                    </View>
                    <View style={[styles.inputContainer, { flex: 1 }]}>
                      <TextInput
                        style={styles.textInput}
                        value={maxHeightIn}
                        onChangeText={(val) => {
                          setMaxHeightIn(val);
                          setIsHeightFiltered(true);
                          const ft = parseInt(maxHeightFt, 10) || 0;
                          const inch = parseInt(val, 10) || 0;
                          const cm = ftInToCm(ft, inch);
                          if (cm >= 90 && cm <= 250) {
                            const clamped = Math.max(cm, minHeightCm);
                            setMaxHeightCm(clamped);
                            setMaxHeightText(String(clamped));
                          }
                        }}
                        keyboardType="numeric"
                        maxLength={2}
                        placeholder="2"
                        placeholderTextColor={colors.textSubtle}
                      />
                      <Text style={styles.inputSuffix}>in</Text>
                    </View>
                  </View>
                  <Text style={styles.conversionHint}>{maxHeightCm} cm</Text>
                </View>
              </View>
            )}

            {/* Dual-ended Height Range Slider */}
            <RangeSlider
              min={90}
              max={250}
              step={1}
              minValue={minHeightCm}
              maxValue={maxHeightCm}
              onChange={(newMin, newMax) => {
                setIsHeightFiltered(true);
                setMinHeightCm(newMin);
                setMaxHeightCm(newMax);
                syncHeightTexts(newMin, newMax);
              }}
              minLabel={heightUnit === 'cm' ? '90 cm' : '3\'0"'}
              maxLabel={heightUnit === 'cm' ? '250 cm' : '8\'2"'}
              testID="height-range-slider"
            />
          </View>

          {/* 4. Weight Filter Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionTitleRow}>
              <View>
                <Text style={styles.sectionTitle}>Weight Bounds</Text>
                <Text style={styles.valueHighlight}>
                  {weightUnit === 'kg'
                    ? `${minWeightKg} – ${maxWeightKg} kg`
                    : `${kgToLb(minWeightKg)} – ${kgToLb(maxWeightKg)} lb`}
                </Text>
              </View>
              <View style={styles.unitToggleRow}>
                <TouchableOpacity
                  style={[styles.unitPill, weightUnit === 'kg' ? styles.unitPillActive : null]}
                  onPress={() => setWeightUnit('kg')}
                >
                  <Text style={[styles.unitPillText, weightUnit === 'kg' ? styles.unitPillTextActive : null]}>
                    kg
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.unitPill, weightUnit === 'lb' ? styles.unitPillActive : null]}
                  onPress={() => setWeightUnit('lb')}
                >
                  <Text style={[styles.unitPillText, weightUnit === 'lb' ? styles.unitPillTextActive : null]}>
                    lb
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.sectionDesc}>Filter candidates by weight (30 to 300 kg / 66 to 661 lb).</Text>

            {/* Direct Weight Inputs */}
            {weightUnit === 'kg' ? (
              <View style={styles.rangeInputsRow}>
                <View style={styles.inputWrapper}>
                  <Text style={styles.inputLabel}>Min Weight</Text>
                  <View style={styles.inputContainer}>
                    <TextInput
                      style={styles.textInput}
                      value={minWeightText}
                      onChangeText={(val) => {
                        setMinWeightText(val);
                        setIsWeightFiltered(true);
                        const n = parseInt(val, 10);
                        if (!isNaN(n) && n >= 30 && n <= 300) {
                          const clamped = Math.min(n, maxWeightKg);
                          setMinWeightKg(clamped);
                          setMinWeightLbText(String(kgToLb(clamped)));
                        }
                      }}
                      onBlur={() => {
                        const n = parseInt(minWeightText, 10);
                        const clamped = isNaN(n) ? 30 : Math.max(30, Math.min(maxWeightKg, n));
                        setMinWeightKg(clamped);
                        syncWeightTexts(clamped, maxWeightKg);
                      }}
                      keyboardType="numeric"
                      maxLength={3}
                      placeholder="30"
                      placeholderTextColor={colors.textSubtle}
                      testID="min-weight-input"
                    />
                    <Text style={styles.inputSuffix}>kg</Text>
                  </View>
                  <Text style={styles.conversionHint}>{kgToLb(minWeightKg)} lb</Text>
                </View>

                <Text style={styles.rangeDash}>—</Text>

                <View style={styles.inputWrapper}>
                  <Text style={styles.inputLabel}>Max Weight</Text>
                  <View style={styles.inputContainer}>
                    <TextInput
                      style={styles.textInput}
                      value={maxWeightText}
                      onChangeText={(val) => {
                        setMaxWeightText(val);
                        setIsWeightFiltered(true);
                        const n = parseInt(val, 10);
                        if (!isNaN(n) && n >= 30 && n <= 300) {
                          const clamped = Math.max(n, minWeightKg);
                          setMaxWeightKg(clamped);
                          setMaxWeightLbText(String(kgToLb(clamped)));
                        }
                      }}
                      onBlur={() => {
                        const n = parseInt(maxWeightText, 10);
                        const clamped = isNaN(n) ? 300 : Math.min(300, Math.max(minWeightKg, n));
                        setMaxWeightKg(clamped);
                        syncWeightTexts(minWeightKg, clamped);
                      }}
                      keyboardType="numeric"
                      maxLength={3}
                      placeholder="300"
                      placeholderTextColor={colors.textSubtle}
                      testID="max-weight-input"
                    />
                    <Text style={styles.inputSuffix}>kg</Text>
                  </View>
                  <Text style={styles.conversionHint}>{kgToLb(maxWeightKg)} lb</Text>
                </View>
              </View>
            ) : (
              <View style={styles.rangeInputsRow}>
                <View style={styles.inputWrapper}>
                  <Text style={styles.inputLabel}>Min Weight</Text>
                  <View style={styles.inputContainer}>
                    <TextInput
                      style={styles.textInput}
                      value={minWeightLbText}
                      onChangeText={(val) => {
                        setMinWeightLbText(val);
                        setIsWeightFiltered(true);
                        const n = parseInt(val, 10);
                        if (!isNaN(n) && n >= 66 && n <= 661) {
                          const kg = lbToKg(n);
                          const clamped = Math.min(kg, maxWeightKg);
                          setMinWeightKg(clamped);
                          setMinWeightText(String(clamped));
                        }
                      }}
                      onBlur={() => {
                        const n = parseInt(minWeightLbText, 10);
                        const kg = isNaN(n) ? 30 : lbToKg(n);
                        const clamped = Math.max(30, Math.min(maxWeightKg, kg));
                        setMinWeightKg(clamped);
                        syncWeightTexts(clamped, maxWeightKg);
                      }}
                      keyboardType="numeric"
                      maxLength={3}
                      placeholder="66"
                      placeholderTextColor={colors.textSubtle}
                    />
                    <Text style={styles.inputSuffix}>lb</Text>
                  </View>
                  <Text style={styles.conversionHint}>{minWeightKg} kg</Text>
                </View>

                <Text style={styles.rangeDash}>—</Text>

                <View style={styles.inputWrapper}>
                  <Text style={styles.inputLabel}>Max Weight</Text>
                  <View style={styles.inputContainer}>
                    <TextInput
                      style={styles.textInput}
                      value={maxWeightLbText}
                      onChangeText={(val) => {
                        setMaxWeightLbText(val);
                        setIsWeightFiltered(true);
                        const n = parseInt(val, 10);
                        if (!isNaN(n) && n >= 66 && n <= 661) {
                          const kg = lbToKg(n);
                          const clamped = Math.max(kg, minWeightKg);
                          setMaxWeightKg(clamped);
                          setMaxWeightText(String(clamped));
                        }
                      }}
                      onBlur={() => {
                        const n = parseInt(maxWeightLbText, 10);
                        const kg = isNaN(n) ? 300 : lbToKg(n);
                        const clamped = Math.min(300, Math.max(minWeightKg, kg));
                        setMaxWeightKg(clamped);
                        syncWeightTexts(minWeightKg, clamped);
                      }}
                      keyboardType="numeric"
                      maxLength={3}
                      placeholder="661"
                      placeholderTextColor={colors.textSubtle}
                    />
                    <Text style={styles.inputSuffix}>lb</Text>
                  </View>
                  <Text style={styles.conversionHint}>{maxWeightKg} kg</Text>
                </View>
              </View>
            )}

            {/* Dual-ended Weight Range Slider */}
            {weightUnit === 'kg' ? (
              <RangeSlider
                min={30}
                max={300}
                step={1}
                minValue={minWeightKg}
                maxValue={maxWeightKg}
                onChange={(newMin, newMax) => {
                  setIsWeightFiltered(true);
                  setMinWeightKg(newMin);
                  setMaxWeightKg(newMax);
                  syncWeightTexts(newMin, newMax);
                }}
                minLabel="30 kg"
                maxLabel="300 kg"
                testID="weight-range-slider"
              />
            ) : (
              <RangeSlider
                min={66}
                max={661}
                step={1}
                minValue={kgToLb(minWeightKg)}
                maxValue={kgToLb(maxWeightKg)}
                onChange={(newMinLb, newMaxLb) => {
                  setIsWeightFiltered(true);
                  const newMinKg = lbToKg(newMinLb);
                  const newMaxKg = lbToKg(newMaxLb);
                  setMinWeightKg(newMinKg);
                  setMaxWeightKg(newMaxKg);
                  syncWeightTexts(newMinKg, newMaxKg);
                }}
                minLabel="66 lb"
                maxLabel="661 lb"
                testID="weight-range-slider-lb"
              />
            )}
          </View>

          {/* 5. Gender Preferences Section */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Gender Preferences</Text>
            <Text style={styles.sectionDesc}>Select all gender identities you wish to see.</Text>
            <View style={styles.chipsRow}>
              {LOOKING_FOR_OPTIONS.filter((o) => o.value !== 'custom').map((opt) => {
                const selected = preferredGenders.includes(opt.value);
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.chip, selected ? styles.chipSelected : null]}
                    onPress={() => toggleGender(opt.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* 6. Sexual Orientation Preferences Section */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Sexual Orientation Preferences</Text>
            <Text style={styles.sectionDesc}>Filter candidates by sexual orientation.</Text>
            <View style={styles.chipsRow}>
              {SEXUAL_ORIENTATION_OPTIONS.filter((o) => o.value !== 'custom').map((opt) => {
                const selected = preferredOrientations.includes(opt.value);
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.chip, selected ? styles.chipSelected : null]}
                    onPress={() => toggleOrientation(opt.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* 7. Relationship Intentions Section */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Relationship Intentions</Text>
            <Text style={styles.sectionDesc}>What kind of connections are you seeking?</Text>
            <View style={styles.chipsRow}>
              {INTENT_OPTIONS.map((opt) => {
                const selected = preferredIntents.includes(opt.value);
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.chip, selected ? styles.chipSelected : null]}
                    onPress={() => toggleIntent(opt.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* 8. Strict Dealbreakers Section */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Mandatory Dealbreakers</Text>
            <Text style={styles.sectionDesc}>Hard exclusions applied strictly regardless of scarcity.</Text>

            <View style={[styles.switchRow, { borderBottomColor: colors.borderSubtle }]}>
              <View style={styles.switchTextCol}>
                <Text style={[styles.switchLabel, { color: colors.text }]}>🚭 Non-Smoker Only</Text>
                <Text style={[styles.switchSubLabel, { color: colors.textSubtle }]}>Strictly hide candidates who smoke.</Text>
              </View>
              <Switch
                value={nonSmokerOnly}
                onValueChange={setNonSmokerOnly}
                trackColor={{ false: colors.border, true: colors.ruby }}
                thumbColor={colors.text}
              />
            </View>

            <View style={[styles.switchRow, { borderBottomColor: colors.borderSubtle }]}>
              <View style={styles.switchTextCol}>
                <Text style={[styles.switchLabel, { color: colors.text }]}>📸 Photo Verified Only</Text>
                <Text style={[styles.switchSubLabel, { color: colors.textSubtle }]}>Only show profiles with verified selfie badge.</Text>
              </View>
              <Switch
                value={verifiedOnly || requireVerifiedDealbreaker}
                onValueChange={(val) => {
                  setVerifiedOnly(val);
                  setRequireVerifiedDealbreaker(val);
                }}
                trackColor={{ false: colors.border, true: colors.gold }}
                thumbColor={colors.text}
              />
            </View>

            <View style={[styles.switchRow, { borderBottomColor: colors.borderSubtle }]}>
              <View style={styles.switchTextCol}>
                <Text style={[styles.switchLabel, { color: colors.text }]}>💍 Monogamous Only</Text>
                <Text style={[styles.switchSubLabel, { color: colors.textSubtle }]}>Exclude non-monogamous and ENM relationship structures.</Text>
              </View>
              <Switch
                value={requireMonogamous}
                onValueChange={setRequireMonogamous}
                trackColor={{ false: colors.border, true: colors.gold }}
                thumbColor={colors.text}
              />
            </View>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>

        {/* Footer Apply Button */}
        <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.borderSubtle }]}>
          <TouchableOpacity
            style={[styles.applyBtn, { backgroundColor: colors.gold }]}
            onPress={handleApply}
            disabled={isSaving}
            activeOpacity={0.8}
            testID="apply-filters-button"
          >
            {isSaving ? (
              <ActivityIndicator color={colors.background} size="small" />
            ) : (
              <Text style={styles.applyBtnText}>Apply Discovery Filters</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  closeBtnText: {
    fontSize: 18,
    color: colors.textSubtle,
  },
  resetBtn: {
    padding: spacing.xs,
  },
  resetBtnText: {
    fontSize: 14,
    color: colors.gold,
    fontWeight: '600',
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  sectionCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sectionDesc: {
    fontSize: 12,
    color: colors.textSubtle,
    marginBottom: spacing.sm,
  },
  valueHighlight: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.gold,
  },
  rangeInputsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  inputWrapper: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 11,
    color: colors.textSubtle,
    marginBottom: 4,
    fontWeight: '500',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    height: 42,
  },
  textInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 0,
  },
  inputSuffix: {
    color: colors.textSubtle,
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 4,
  },
  rangeDash: {
    color: colors.textSubtle,
    fontSize: 16,
    fontWeight: '700',
    alignSelf: 'center',
    paddingHorizontal: spacing.sm,
    marginTop: 18,
  },
  conversionHint: {
    fontSize: 11,
    color: colors.gold,
    marginTop: 3,
    fontWeight: '500',
  },
  singleInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  compactChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 2,
  },
  compactChip: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.cardElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  compactChipSelected: {
    backgroundColor: colors.goldMuted,
    borderColor: colors.gold,
  },
  compactChipText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  compactChipTextSelected: {
    color: colors.gold,
    fontWeight: '700',
  },
  dualFtInRow: {
    flexDirection: 'row',
    gap: 6,
  },
  unitToggleRow: {
    flexDirection: 'row',
    backgroundColor: colors.cardElevated,
    borderRadius: borderRadius.sm,
    padding: 2,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  unitPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm - 2,
  },
  unitPillActive: {
    backgroundColor: colors.gold,
  },
  unitPillText: {
    fontSize: 12,
    color: colors.textSubtle,
    fontWeight: '600',
  },
  unitPillTextActive: {
    color: colors.background,
    fontWeight: '700',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.cardElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  chipSelected: {
    backgroundColor: colors.goldMuted,
    borderColor: colors.gold,
  },
  chipText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: colors.gold,
    fontWeight: '700',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  switchTextCol: {
    flex: 1,
    marginRight: spacing.md,
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  switchSubLabel: {
    fontSize: 11,
    color: colors.textSubtle,
    marginTop: 2,
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  applyBtn: {
    backgroundColor: colors.gold,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyBtnText: {
    color: '#090A0E',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
