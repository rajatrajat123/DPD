import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  SafeAreaView,
  Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { colors, typography, spacing, borderRadius } from '../src/theme';
import { discoveryService } from '../src/services/discovery/discoveryService';
import { DiscoveryCandidate } from '../src/types';

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const performSearch = useCallback(async (searchTerm: string) => {
    setIsLoading(true);
    try {
      const res = await discoveryService.search(searchTerm, 30);
      setCandidates(res.candidates || []);
      setHasSearched(true);
    } catch {
      setCandidates([]);
      setHasSearched(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleQueryChange = (text: string) => {
    setQuery(text);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      performSearch(text.trim());
    }, 350);
  };

  const handleClear = () => {
    setQuery('');
    performSearch('');
  };

  useEffect(() => {
    // Initial fetch of public candidates
    performSearch('');
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [performSearch]);

  const renderCandidateCard = ({ item }: { item: DiscoveryCandidate }) => {
    const primaryPhotoUrl = item.photos?.[0]?.url || item.photos?.[0]?.thumb_url;

    return (
      <TouchableOpacity
        style={styles.card}
        testID={`search-card-${item.user_id}`}
        activeOpacity={0.85}
        onPress={() => {
          router.push({
            pathname: '/profile/[id]',
            params: { id: item.user_id },
          });
        }}
      >
        <View style={styles.cardHeader}>
          {primaryPhotoUrl ? (
            <Image source={{ uri: primaryPhotoUrl }} style={styles.avatarImage} />
          ) : (
            <View style={[styles.avatarImage, styles.avatarPlaceholder]}>
              <Text style={styles.avatarMonogram}>
                {item.display_name ? item.display_name.charAt(0).toUpperCase() : 'A'}
              </Text>
            </View>
          )}

          <View style={styles.cardHeaderText}>
            <View style={styles.nameRow}>
              <Text style={styles.displayName}>{item.display_name}, {item.age}</Text>
              {item.is_verified && (
                <View style={styles.verifiedBadge}>
                  <Text style={styles.verifiedBadgeText}>✓ Verified</Text>
                </View>
              )}
            </View>

            <Text style={styles.distanceText}>
              📍 ~{item.distance_bucket_km} km away
            </Text>
          </View>
        </View>

        {/* Bio */}
        {Boolean(item.bio) && (
          <Text style={styles.bioText} numberOfLines={3}>
            {item.bio}
          </Text>
        )}

        {/* Tag pills */}
        <View style={styles.tagWrap}>
          {item.gender_identities?.map((g) => (
            <View key={g} style={styles.tagPill}>
              <Text style={styles.tagPillText}>{g}</Text>
            </View>
          ))}
          {item.sexual_orientations?.map((s) => (
            <View key={s} style={[styles.tagPill, styles.orientationPill]}>
              <Text style={[styles.tagPillText, styles.orientationPillText]}>{s}</Text>
            </View>
          ))}
          {Boolean(item.relationship_structure) && (
            <View style={[styles.tagPill, styles.structurePill]}>
              <Text style={styles.structurePillText}>{item.relationship_structure}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Search Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
          testID="search-back-button"
        >
          <Text style={styles.backIcon}>◀</Text>
        </TouchableOpacity>

        <View style={styles.searchInputWrap}>
          <Text style={styles.inputSearchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, bio, or tags..."
            placeholderTextColor={colors.textSubtle}
            value={query}
            onChangeText={handleQueryChange}
            returnKeyType="search"
            onSubmitEditing={() => {
              Keyboard.dismiss();
              performSearch(query.trim());
            }}
            autoCorrect={false}
            testID="search-input"
          />
          {Boolean(query) && (
            <TouchableOpacity onPress={handleClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.clearIcon}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Results List */}
      {isLoading && !hasSearched ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={colors.gold} size="large" />
          <Text style={styles.loadingText}>Searching community profiles...</Text>
        </View>
      ) : candidates.length > 0 ? (
        <FlatList
          data={candidates}
          keyExtractor={(item) => item.user_id}
          renderItem={renderCandidateCard}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyIcon}>🔍</Text>
          <Text style={styles.emptyTitle}>
            {hasSearched && query.trim() !== '' ? 'No Profiles Found' : 'Explore Aura'}
          </Text>
          <Text style={styles.emptyDescription}>
            {hasSearched && query.trim() !== ''
              ? `No members found matching "${query}". Try searching by other names, identities, or interests.`
              : 'Type a name, identity, or keyword to discover members in your community.'}
          </Text>
        </View>
      )}
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
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backIcon: {
    fontSize: 14,
    color: colors.gold,
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    height: 42,
  },
  inputSearchIcon: {
    fontSize: 14,
    marginRight: spacing.xs,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    paddingVertical: 0,
  },
  clearIcon: {
    fontSize: 14,
    color: colors.textMuted,
    paddingLeft: spacing.xs,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  avatarImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginRight: spacing.md,
    backgroundColor: colors.cardElevated,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarMonogram: {
    ...typography.h2,
    color: colors.gold,
  },
  cardHeaderText: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  displayName: {
    ...typography.h3,
    color: colors.text,
    fontSize: 17,
  },
  verifiedBadge: {
    backgroundColor: colors.emeraldMuted,
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.emerald,
  },
  verifiedBadgeText: {
    ...typography.caption,
    color: colors.emerald,
    fontSize: 10,
    fontWeight: '700',
  },
  distanceText: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  bioText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagPill: {
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.25)',
  },
  tagPillText: {
    ...typography.caption,
    color: colors.gold,
    fontSize: 11,
  },
  orientationPill: {
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    borderColor: 'rgba(168, 85, 247, 0.25)',
  },
  orientationPillText: {
    color: '#c084fc',
  },
  structurePill: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderColor: 'rgba(59, 130, 246, 0.25)',
  },
  structurePillText: {
    ...typography.caption,
    color: '#60a5fa',
    fontSize: 11,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  emptyDescription: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 280,
  },
});
