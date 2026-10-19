import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  FlatList,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { colors, typography, spacing, borderRadius, fontFamily } from '../src/theme';
import { discoveryService } from '../src/services/discovery/discoveryService';
import { FavouriteProfileCard } from '../src/types';

type ColumnCount = 1 | 2 | 3;

interface FilterState {
  recentlyActive: boolean;
  hideMessaged: boolean;
  newMembers: boolean;
  nearMe: boolean;
  verifiedPhotos: boolean;
}

export default function MyFavouritesScreen() {
  const router = useRouter();

  const [favourites, setFavourites] = useState<FavouriteProfileCard[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Layout & Controls
  const [columns, setColumns] = useState<ColumnCount>(3);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showFilters, setShowFilters] = useState<boolean>(true);
  const [likedUserIds, setLikedUserIds] = useState<Set<string>>(new Set());
  const [processingLikeId, setProcessingLikeId] = useState<string | null>(null);
  const [processingRemoveId, setProcessingRemoveId] = useState<string | null>(null);

  const [filters, setFilters] = useState<FilterState>({
    recentlyActive: false,
    hideMessaged: false,
    newMembers: false,
    nearMe: false,
    verifiedPhotos: false,
  });

  const loadFavourites = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else if (favourites.length === 0) {
      setIsLoading(true);
    }
    setErrorMessage(null);

    try {
      const res = await discoveryService.getFavourites();
      setFavourites(res.favourites || []);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Could not load your favourite profiles.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [favourites.length]);

  // Sync when screen gains focus
  useFocusEffect(
    useCallback(() => {
      loadFavourites();
    }, [loadFavourites])
  );

  const toggleFilter = (key: keyof FilterState) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const clearAllFilters = () => {
    setFilters({
      recentlyActive: false,
      hideMessaged: false,
      newMembers: false,
      nearMe: false,
      verifiedPhotos: false,
    });
    setSearchQuery('');
  };

  const activeFilterCount = useMemo(() => {
    return Object.values(filters).filter(Boolean).length;
  }, [filters]);

  // Helper: Format relative time
  const getRelativeTime = (isoString?: string | null): string => {
    if (!isoString) return 'Recently';
    const now = new Date();
    const then = new Date(isoString);
    const diffMs = now.getTime() - then.getTime();
    if (diffMs < 0 || isNaN(diffMs)) return 'Recently';

    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${Math.max(1, diffSec)}s ago`;

    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;

    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return 'Recently';
  };

  // Helper: Check if active recently (within 24 hours) or online (within 10 minutes)
  const isOnline = (isoString?: string | null): boolean => {
    if (!isoString) return false;
    const diffMs = Date.now() - new Date(isoString).getTime();
    return diffMs >= 0 && diffMs < 10 * 60 * 1000; // 10 minutes
  };

  const isRecentlyActive = (isoString?: string | null): boolean => {
    if (!isoString) return false;
    const diffMs = Date.now() - new Date(isoString).getTime();
    return diffMs >= 0 && diffMs < 24 * 60 * 60 * 1000; // 24 hours
  };

  const isNewMember = (isoString?: string | null): boolean => {
    if (!isoString) return false;
    const diffMs = Date.now() - new Date(isoString).getTime();
    return diffMs >= 0 && diffMs < 14 * 24 * 60 * 60 * 1000; // 14 days
  };

  const formatGender = (genders?: string[]): string => {
    if (!genders || genders.length === 0) return '';
    const g = genders[0].toLowerCase();
    if (g.includes('cisgender woman') || g === 'woman') return 'F';
    if (g.includes('cisgender man') || g === 'man') return 'M';
    if (g.includes('transgender woman')) return 'Trans F';
    if (g.includes('transgender man')) return 'Trans M';
    if (g.includes('non-binary') || g === 'nb') return 'NB';
    if (g.includes('genderfluid')) return 'Fluid';
    return g.charAt(0).toUpperCase();
  };

  // Action: Remove from favourites
  const handleRemove = async (fav: FavouriteProfileCard) => {
    if (processingRemoveId === fav.user_id) return;
    setProcessingRemoveId(fav.user_id);

    // Optimistic UI update
    const previous = [...favourites];
    setFavourites((prev) => prev.filter((item) => item.user_id !== fav.user_id));

    try {
      await discoveryService.removeFavourite(fav.user_id);
    } catch {
      // Revert on failure
      setFavourites(previous);
      Alert.alert('Remove Failed', `Could not remove ${fav.display_name} from favourites.`);
    } finally {
      setProcessingRemoveId(null);
    }
  };

  // Action: Like profile
  const handleLike = async (fav: FavouriteProfileCard) => {
    if (processingLikeId === fav.user_id || likedUserIds.has(fav.user_id)) return;
    setProcessingLikeId(fav.user_id);

    try {
      await discoveryService.swipe(fav.user_id, 'LIKE' as any);
      setLikedUserIds((prev) => new Set(prev).add(fav.user_id));
    } catch (err: any) {
      Alert.alert('Action Alert', err?.message || 'Could not register like.');
    } finally {
      setProcessingLikeId(null);
    }
  };

  // Filter and search logic
  const filteredFavourites = useMemo(() => {
    return favourites.filter((item) => {
      // 1. Text search by display_name or bio
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchesName = item.display_name?.toLowerCase().includes(query);
        const matchesBio = item.bio?.toLowerCase().includes(query);
        const matchesCity = item.city_name?.toLowerCase().includes(query);
        if (!matchesName && !matchesBio && !matchesCity) return false;
      }

      // 2. Recently active filter
      if (filters.recentlyActive && !isRecentlyActive(item.last_active_at)) {
        return false;
      }

      // 3. Hide messaged filter
      if (filters.hideMessaged && item.has_conversation) {
        return false;
      }

      // 4. New members filter
      if (filters.newMembers && !isNewMember(item.user_created_at)) {
        return false;
      }

      // 5. Near me: only profiles with a known distance of 50km or less.
      if (filters.nearMe) {
        if (typeof item.distance_km !== 'number' || item.distance_km > 50) {
          return false;
        }
      }

      // 6. Verified photos filter
      if (filters.verifiedPhotos && !item.is_photo_verified) {
        return false;
      }

      return true;
    });
  }, [favourites, searchQuery, filters]);

  // Card dimensions based on selected columns
  const screenWidth = Dimensions.get('window').width;
  const paddingHorizontal = 10;
  const gap = 8;
  const cardWidth = Math.floor(
    (screenWidth - paddingHorizontal * 2 - (columns - 1) * gap) / columns
  );

  const renderCard = ({ item }: { item: FavouriteProfileCard }) => {
    const isUserOnline = isOnline(item.last_active_at);
    const isUserNew = isNewMember(item.user_created_at);
    const genderTag = formatGender(item.gender_identities);
    const isLiked = likedUserIds.has(item.user_id);
    const isProcessingLike = processingLikeId === item.user_id;
    const isProcessingRemove = processingRemoveId === item.user_id;

    // Subtitle parts: e.g. "26 • F • Bangkok • 2 km"
    const subtitleParts: string[] = [];
    if (item.age > 0) subtitleParts.push(`${item.age}`);
    if (genderTag) subtitleParts.push(genderTag);
    if (item.city_name) {
      subtitleParts.push(item.city_name);
    } else if (typeof item.distance_km === 'number') {
      subtitleParts.push(`${item.distance_km} km`);
    }

    const activityText = isUserOnline
      ? 'Active now'
      : item.last_active_at
      ? getRelativeTime(item.last_active_at)
      : 'Saved profile';

    return (
      <View
        style={[styles.cardContainer, { width: cardWidth }]}
        testID={`favourite-grid-item-${item.user_id}`}
      >
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() =>
            router.push({
              pathname: '/profile/[id]',
              params: { id: item.user_id },
            })
          }
          style={styles.cardTouchable}
          testID={`favourite-card-touch-${item.user_id}`}
          accessibilityRole="button"
          accessibilityLabel={`View profile of ${item.display_name}`}
        >
          {/* Photo Container */}
          <View style={[styles.photoWrap, { height: cardWidth }]}>
            {item.photo_url ? (
              <Image source={{ uri: item.photo_url }} style={styles.photo} resizeMode="cover" />
            ) : (
              <View style={[styles.photo, styles.photoPlaceholder]}>
                <Text style={styles.placeholderMonogram}>
                  {item.display_name ? item.display_name.charAt(0).toUpperCase() : 'A'}
                </Text>
              </View>
            )}

            {/* Verified Badge: Top-Left */}
            {item.is_photo_verified && (
              <View style={styles.verifiedBadge} testID={`verified-badge-${item.user_id}`}>
                <Text style={styles.verifiedIcon}>✓</Text>
              </View>
            )}

            {/* NEW Member Badge: Bottom-Right */}
            {isUserNew && (
              <View style={styles.newBadge}>
                <Text style={styles.newBadgeText}>NEW</Text>
              </View>
            )}
          </View>

          {/* Card Info */}
          <View style={styles.infoWrap}>
            {/* Online Indicator & Name */}
            <View style={styles.nameRow}>
              <View
                style={[
                  styles.onlineDot,
                  { backgroundColor: isUserOnline ? colors.emerald : colors.textSubtle },
                ]}
              />
              <Text style={styles.displayName} numberOfLines={1}>
                {item.display_name}
              </Text>
            </View>

            {/* Subtitle Line 1: Age • Gender • Location */}
            {subtitleParts.length > 0 && (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitleParts.join(' • ')}
              </Text>
            )}

            {/* Subtitle Line 2: Activity Timestamp */}
            <Text
              style={[
                styles.activityTime,
                isUserOnline && { color: colors.emerald, fontWeight: '600' },
              ]}
              numberOfLines={1}
            >
              {activityText}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Card Action Buttons (Distinguishable & Accessible) */}
        <View style={styles.actionsRow}>
          {/* Remove Favourite Button */}
          <TouchableOpacity
            style={[styles.actionBtn, styles.removeBtn]}
            onPress={(e) => {
              e.stopPropagation();
              handleRemove(item);
            }}
            disabled={isProcessingRemove}
            activeOpacity={0.7}
            testID={`remove-fav-btn-${item.user_id}`}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.display_name} from favourites`}
          >
            {isProcessingRemove ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : (
              <Text style={styles.removeBtnIcon}>✕</Text>
            )}
          </TouchableOpacity>

          {/* Like / Spark Action Button */}
          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.likeBtn,
              isLiked && styles.likeBtnActive,
            ]}
            onPress={(e) => {
              e.stopPropagation();
              handleLike(item);
            }}
            disabled={isProcessingLike || isLiked}
            activeOpacity={0.7}
            testID={`like-fav-btn-${item.user_id}`}
            accessibilityRole="button"
            accessibilityLabel={isLiked ? `Liked ${item.display_name}` : `Like ${item.display_name}`}
          >
            {isProcessingLike ? (
              <ActivityIndicator size="small" color={colors.ruby} />
            ) : (
              <Text style={[styles.likeBtnIcon, isLiked && { color: colors.gold }]}>
                {isLiked ? '★' : '♥'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeContainer} edges={['top', 'bottom']}>
      {/* 1. Screen Header */}
      <View style={styles.topHeader}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            activeOpacity={0.7}
            testID="favourites-back-btn"
            accessibilityRole="button"
            accessibilityLabel="Back to profile"
          >
            <Text style={styles.backButtonIcon}>‹</Text>
          </TouchableOpacity>
          <View style={styles.titleColumn}>
            <Text style={styles.headerTitle}>MY FAVOURITES</Text>
            <Text style={styles.headerSubtitle}>
              {favourites.length} {favourites.length === 1 ? 'saved profile' : 'saved profiles'}
            </Text>
          </View>
        </View>

        {/* Right Tools: Column Layout Toggle & Filter Toggle */}
        <View style={styles.headerTools}>
          {/* Column Toggle (1, 2, 3 cols) */}
          <View style={styles.columnToggleGroup}>
            <TouchableOpacity
              style={[styles.colBtn, columns === 1 && styles.colBtnActive]}
              onPress={() => setColumns(1)}
              activeOpacity={0.7}
              testID="col-toggle-1"
              accessibilityLabel="1 column layout"
            >
              <Text style={[styles.colBtnText, columns === 1 && styles.colBtnTextActive]}>▮</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.colBtn, columns === 2 && styles.colBtnActive]}
              onPress={() => setColumns(2)}
              activeOpacity={0.7}
              testID="col-toggle-2"
              accessibilityLabel="2 columns layout"
            >
              <Text style={[styles.colBtnText, columns === 2 && styles.colBtnTextActive]}>❚❚</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.colBtn, columns === 3 && styles.colBtnActive]}
              onPress={() => setColumns(3)}
              activeOpacity={0.7}
              testID="col-toggle-3"
              accessibilityLabel="3 columns layout"
            >
              <Text style={[styles.colBtnText, columns === 3 && styles.colBtnTextActive]}>⋮⋮⋮</Text>
            </TouchableOpacity>
          </View>

          {/* Filter Toggle Button */}
          <TouchableOpacity
            style={[
              styles.filterIconBtn,
              (showFilters || activeFilterCount > 0) && styles.filterIconBtnActive,
            ]}
            onPress={() => setShowFilters(!showFilters)}
            activeOpacity={0.7}
            testID="filter-toggle-btn"
            accessibilityRole="button"
            accessibilityLabel="Toggle filter bar"
          >
            <Text
              style={[
                styles.filterIconText,
                (showFilters || activeFilterCount > 0) && { color: colors.gold },
              ]}
            >
              ▼
            </Text>
            {activeFilterCount > 0 && (
              <View style={styles.filterCountBadge}>
                <Text style={styles.filterCountText}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. Search Bar */}
      <View style={styles.searchBarContainer}>
        <View style={styles.searchInner}>
          <Text style={styles.searchLens}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by username or bio..."
            placeholderTextColor={colors.textSubtle}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            testID="favourites-search-input"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              style={styles.searchClearBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.searchClearText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 3. Filter Chips Row */}
      {showFilters && (
        <View style={styles.filtersWrapper}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersScrollContent}
          >
            {/* Recently Active */}
            <TouchableOpacity
              style={[styles.filterChip, filters.recentlyActive && styles.filterChipActive]}
              onPress={() => toggleFilter('recentlyActive')}
              activeOpacity={0.7}
              testID="filter-recently-active"
            >
              <Text
                style={[styles.filterChipText, filters.recentlyActive && styles.filterChipTextActive]}
              >
                ● Recently Active
              </Text>
            </TouchableOpacity>

            {/* Hide Messaged */}
            <TouchableOpacity
              style={[styles.filterChip, filters.hideMessaged && styles.filterChipActive]}
              onPress={() => toggleFilter('hideMessaged')}
              activeOpacity={0.7}
              testID="filter-hide-messaged"
            >
              <Text
                style={[styles.filterChipText, filters.hideMessaged && styles.filterChipTextActive]}
              >
                Hide Messaged
              </Text>
            </TouchableOpacity>

            {/* New Members */}
            <TouchableOpacity
              style={[styles.filterChip, filters.newMembers && styles.filterChipActive]}
              onPress={() => toggleFilter('newMembers')}
              activeOpacity={0.7}
              testID="filter-new-members"
            >
              <Text
                style={[styles.filterChipText, filters.newMembers && styles.filterChipTextActive]}
              >
                ✨ New Members
              </Text>
            </TouchableOpacity>

            {/* Near Me */}
            <TouchableOpacity
              style={[styles.filterChip, filters.nearMe && styles.filterChipActive]}
              onPress={() => toggleFilter('nearMe')}
              activeOpacity={0.7}
              testID="filter-near-me"
            >
              <Text style={[styles.filterChipText, filters.nearMe && styles.filterChipTextActive]}>
                📍 Near Me
              </Text>
            </TouchableOpacity>

            {/* Verified Photos */}
            <TouchableOpacity
              style={[styles.filterChip, filters.verifiedPhotos && styles.filterChipActive]}
              onPress={() => toggleFilter('verifiedPhotos')}
              activeOpacity={0.7}
              testID="filter-verified-photos"
            >
              <Text
                style={[styles.filterChipText, filters.verifiedPhotos && styles.filterChipTextActive]}
              >
                ✓ Verified Photos
              </Text>
            </TouchableOpacity>

            {/* Reset All Filters Chip */}
            {activeFilterCount > 0 && (
              <TouchableOpacity
                style={styles.filterResetChip}
                onPress={clearAllFilters}
                activeOpacity={0.7}
                testID="filter-reset-all"
              >
                <Text style={styles.filterResetText}>Reset ✕</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      )}

      {/* 4. Body Content / Grid / States */}
      <View style={styles.body}>
        {isLoading && favourites.length === 0 ? (
          <View style={styles.centerState} testID="favourites-loading-state">
            <ActivityIndicator size="large" color={colors.gold} />
            <Text style={styles.stateTitle}>Loading Favourites</Text>
            <Text style={styles.stateSubtitle}>Retrieving your private bookmarked profiles...</Text>
          </View>
        ) : errorMessage && favourites.length === 0 ? (
          <View style={styles.centerState} testID="favourites-error-state">
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.stateTitle}>Unable to Load</Text>
            <Text style={styles.stateSubtitle}>{errorMessage}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => loadFavourites()}
              activeOpacity={0.8}
              testID="favourites-retry-btn"
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : favourites.length === 0 ? (
          <View style={styles.centerState} testID="favourites-empty-state">
            <Text style={styles.emptyIcon}>🔖</Text>
            <Text style={styles.stateTitle}>No Favourite Profiles Yet</Text>
            <Text style={styles.stateSubtitle}>
              Tap the bookmark icon on any Discovery card to save profiles here for quick private access.
            </Text>
            <TouchableOpacity
              style={styles.exploreBtn}
              onPress={() => router.replace('/(tabs)')}
              activeOpacity={0.8}
            >
              <Text style={styles.exploreBtnText}>Explore Discovery Feed</Text>
            </TouchableOpacity>
          </View>
        ) : filteredFavourites.length === 0 ? (
          <View style={styles.centerState} testID="favourites-no-matches-state">
            <Text style={styles.emptyIcon}>🔎</Text>
            <Text style={styles.stateTitle}>No Matches Found</Text>
            <Text style={styles.stateSubtitle}>
              None of your saved favourites match the selected search or filter criteria.
            </Text>
            <TouchableOpacity
              style={styles.clearFiltersBtn}
              onPress={clearAllFilters}
              activeOpacity={0.8}
            >
              <Text style={styles.clearFiltersBtnText}>Clear All Filters</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            key={`grid-${columns}`}
            data={filteredFavourites}
            keyExtractor={(item) => item.user_id}
            renderItem={renderCard}
            numColumns={columns}
            contentContainerStyle={[
              styles.gridContent,
              { paddingHorizontal: paddingHorizontal },
            ]}
            columnWrapperStyle={columns > 1 ? { gap: gap } : undefined}
            ItemSeparatorComponent={() => <View style={{ height: gap }} />}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={() => loadFavourites(true)}
                tintColor={colors.gold}
                colors={[colors.gold]}
              />
            }
            testID="favourites-grid-list"
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  backButtonIcon: {
    fontSize: 28,
    color: colors.gold,
    lineHeight: 30,
    marginTop: -2,
    fontWeight: '300',
  },
  titleColumn: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: colors.text,
    fontFamily: fontFamily.serif,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.gold,
    marginTop: 2,
    fontWeight: '500',
  },
  headerTools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  columnToggleGroup: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 2,
  },
  colBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  colBtnActive: {
    backgroundColor: 'rgba(212, 175, 55, 0.2)',
  },
  colBtnText: {
    fontSize: 13,
    color: colors.textSubtle,
  },
  colBtnTextActive: {
    color: colors.gold,
    fontWeight: '700',
  },
  filterIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  filterIconBtnActive: {
    borderColor: colors.gold,
    backgroundColor: 'rgba(212, 175, 55, 0.15)',
  },
  filterIconText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  filterCountBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: colors.gold,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  filterCountText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textInverse,
  },
  searchBarContainer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  searchInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    height: 40,
  },
  searchLens: {
    fontSize: 14,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    paddingVertical: 0,
  },
  searchClearBtn: {
    padding: 4,
  },
  searchClearText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  filtersWrapper: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  filtersScrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: 'rgba(212, 175, 55, 0.2)',
    borderColor: colors.gold,
  },
  filterChipText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: colors.gold,
    fontWeight: '700',
  },
  filterResetChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: colors.ruby,
  },
  filterResetText: {
    fontSize: 12,
    color: colors.ruby,
    fontWeight: '700',
  },
  body: {
    flex: 1,
    marginTop: 8,
  },
  gridContent: {
    paddingBottom: 24,
  },
  cardContainer: {
    backgroundColor: colors.backgroundElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
  },
  cardTouchable: {
    width: '100%',
  },
  photoWrap: {
    width: '100%',
    backgroundColor: colors.cardMuted,
    position: 'relative',
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E222F',
  },
  placeholderMonogram: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.gold,
    fontFamily: fontFamily.serif,
  },
  verifiedBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  verifiedIcon: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
  newBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: '#0284C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  newBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  infoWrap: {
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  displayName: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  subtitle: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
  },
  activityTime: {
    fontSize: 9,
    color: colors.textSubtle,
    marginTop: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 8,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.04)',
  },
  actionBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  removeBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
  },
  removeBtnIcon: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  likeBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  likeBtnActive: {
    backgroundColor: 'rgba(212, 175, 55, 0.2)',
    borderColor: colors.gold,
  },
  likeBtnIcon: {
    color: colors.ruby,
    fontSize: 13,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    marginTop: 60,
  },
  stateTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginTop: 16,
    textAlign: 'center',
    fontFamily: fontFamily.serif,
  },
  stateSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
  },
  emptyIcon: {
    fontSize: 48,
  },
  errorIcon: {
    fontSize: 42,
  },
  exploreBtn: {
    marginTop: 20,
    backgroundColor: colors.gold,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  exploreBtnText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 13,
  },
  clearFiltersBtn: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: colors.gold,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 18,
  },
  clearFiltersBtnText: {
    color: colors.gold,
    fontWeight: '600',
    fontSize: 13,
  },
  retryButton: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: colors.gold,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  retryButtonText: {
    color: colors.gold,
    fontWeight: '700',
    fontSize: 13,
  },
});
