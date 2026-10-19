import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';

// --- Test Suite: Mobile My Favourites Private Bookmarking ---

test('My Favourites: Types and Data Models Contract', async () => {
  const typesFilePath = resolve(process.cwd(), 'src/types/index.ts');
  const typesContent = await fs.readFile(typesFilePath, 'utf-8');

  // Verify FavouriteProfileCard structure
  assert.ok(typesContent.includes('export interface FavouriteProfileCard'), 'Must export FavouriteProfileCard');
  assert.ok(typesContent.includes('user_id: string;'), 'FavouriteProfileCard must contain user_id');
  assert.ok(typesContent.includes('display_name: string;'), 'FavouriteProfileCard must contain display_name');
  assert.ok(typesContent.includes('age: number;'), 'FavouriteProfileCard must contain age');
  assert.ok(typesContent.includes('bio: string;'), 'FavouriteProfileCard must contain bio');
  assert.ok(typesContent.includes('photo_url?: string;'), 'FavouriteProfileCard must contain photo_url');
  assert.ok(typesContent.includes('added_at: string;'), 'FavouriteProfileCard must contain added_at');

  // Verify Response contracts
  assert.ok(typesContent.includes('export interface ListFavouritesResponse'), 'Must export ListFavouritesResponse');
  assert.ok(typesContent.includes('favourites: FavouriteProfileCard[];'), 'ListFavouritesResponse must contain favourites array');
  assert.ok(typesContent.includes('export interface AddFavouriteResponse'), 'Must export AddFavouriteResponse');
  assert.ok(typesContent.includes('export interface RemoveFavouriteResponse'), 'Must export RemoveFavouriteResponse');
});

test('My Favourites: Discovery Service API Methods', async () => {
  const serviceFilePath = resolve(process.cwd(), 'src/services/discovery/discoveryService.ts');
  const serviceContent = await fs.readFile(serviceFilePath, 'utf-8');

  // Verify getFavourites, addFavourite, removeFavourite are exported
  assert.ok(serviceContent.includes('async getFavourites(): Promise<ListFavouritesResponse>'), 'Must implement getFavourites');
  assert.ok(serviceContent.includes("api.get<ListFavouritesResponse>('/api/v1/discovery/favourites')"), 'getFavourites must call GET /api/v1/discovery/favourites');

  assert.ok(serviceContent.includes('async addFavourite(targetUserId: string): Promise<AddFavouriteResponse>'), 'Must implement addFavourite');
  assert.ok(serviceContent.includes("api.post<AddFavouriteResponse>('/api/v1/discovery/favourites'"), 'addFavourite must call POST /api/v1/discovery/favourites');

  assert.ok(serviceContent.includes('async removeFavourite(targetUserId: string): Promise<RemoveFavouriteResponse>'), 'Must implement removeFavourite');
  assert.ok(serviceContent.includes("api.delete<RemoveFavouriteResponse>(`/api/v1/discovery/favourites/${targetUserId}`)"), 'removeFavourite must call DELETE /api/v1/discovery/favourites/{id}');
});

test('My Favourites: DiscoveryCard Bookmark Toggle in Single, Double, and Modal Layouts', async () => {
  const cardFilePath = resolve(process.cwd(), 'src/components/DiscoveryCard.tsx');
  const cardContent = await fs.readFile(cardFilePath, 'utf-8');

  // Verify Props contract
  assert.ok(cardContent.includes('isFavourite?: boolean;'), 'DiscoveryCardProps must support isFavourite');
  assert.ok(cardContent.includes('onToggleFavourite?: () => void;'), 'DiscoveryCardProps must support onToggleFavourite');

  // Verify Single card badge row favourite button
  assert.ok(
    cardContent.includes('testID={`discovery-favourite-btn-${candidate.user_id || candidate.id}`}'),
    'Must render favourite button with testID in card'
  );

  // Verify Double card badge row favourite button
  assert.ok(
    cardContent.includes('styles.doubleFavouriteBtn'),
    'Must render double card favourite button'
  );

  // Verify Profile Details modal header favourite button
  assert.ok(
    cardContent.includes('testID={`modal-favourite-btn-${candidate.user_id || candidate.id}`}'),
    'Must render favourite button in modal header'
  );

  // Verify stopPropagation prevents swipe or card tap triggering
  assert.ok(
    cardContent.includes('e?.stopPropagation?.()'),
    'Bookmark toggle must stop propagation to avoid swipe or modal open triggers'
  );
});

test('My Favourites: Strictly Private Bookmark Non-Interference', async () => {
  const cardFilePath = resolve(process.cwd(), 'src/components/DiscoveryCard.tsx');
  const cardContent = await fs.readFile(cardFilePath, 'utf-8');

  // Extract onToggleFavourite invocations in DiscoveryCard
  const toggleMatches = cardContent.match(/onToggleFavourite\(\)/g);
  assert.ok(toggleMatches && toggleMatches.length >= 2, 'Must invoke onToggleFavourite in DiscoveryCard');

  // Confirm onToggleFavourite does NOT call onLike, onPass, onSuperSpark
  assert.ok(!cardContent.includes('onToggleFavourite(); onLike()'), 'Toggle favourite must never trigger onLike');
  assert.ok(!cardContent.includes('onToggleFavourite(); onPass()'), 'Toggle favourite must never trigger onPass');
  assert.ok(!cardContent.includes('onToggleFavourite(); onSuperSpark()'), 'Toggle favourite must never trigger onSuperSpark');
});

test('My Favourites: Discovery Screen Integration & Synchronisation', async () => {
  const indexFilePath = resolve(process.cwd(), 'app/(tabs)/index.tsx');
  const indexContent = await fs.readFile(indexFilePath, 'utf-8');

  // 1. Verify favouriteUserIds state and loader
  assert.ok(indexContent.includes('const [favouriteUserIds, setFavouriteUserIds]'), 'Must declare favouriteUserIds state');
  assert.ok(indexContent.includes('discoveryService.getFavourites()'), 'Must fetch favourites from discoveryService');

  // 2. Verify handleToggleFavourite optimistic updates
  assert.ok(indexContent.includes('const handleToggleFavourite = useCallback'), 'Must define handleToggleFavourite handler');
  assert.ok(indexContent.includes('discoveryService.addFavourite'), 'Must call discoveryService.addFavourite');
  assert.ok(indexContent.includes('discoveryService.removeFavourite'), 'Must call discoveryService.removeFavourite');

  // 3. Verify screen refocus synchronisation
  assert.ok(indexContent.includes('loadFavourites();'), 'Must sync favourites on mount and refocus');

  // 4. Verify props passed to DiscoveryCard in double grid
  assert.ok(
    indexContent.includes('isFavourite={favouriteUserIds.has(item.user_id || item.id)}'),
    'Must pass isFavourite to double grid DiscoveryCard'
  );
  assert.ok(
    indexContent.includes('onToggleFavourite={() => handleToggleFavourite(item)}'),
    'Must pass onToggleFavourite to double grid DiscoveryCard'
  );

  // 5. Verify props passed to DiscoveryCard in single card deck
  assert.ok(
    indexContent.includes('isFavourite={favouriteUserIds.has(activeCandidate.user_id || activeCandidate.id)}'),
    'Must pass isFavourite to single card DiscoveryCard'
  );
  assert.ok(
    indexContent.includes('onToggleFavourite={() => handleToggleFavourite(activeCandidate)}'),
    'Must pass onToggleFavourite to single card DiscoveryCard'
  );
});

test('My Favourites: Profile Screen Section, Real Backend Loading, Empty/Error States & Removal', async () => {
  const profileFilePath = resolve(process.cwd(), 'app/(tabs)/profile.tsx');
  const profileContent = await fs.readFile(profileFilePath, 'utf-8');

  // 1. Verify Section F container and Accordion header
  assert.ok(profileContent.includes('testID="section-my-favourites"'), 'Must define section-my-favourites');
  assert.ok(profileContent.includes('testID="accordion-header-favourites"'), 'Must define accordion-header-favourites');
  assert.ok(profileContent.includes('My Favourites'), 'Must include My Favourites title');

  // 2. Verify Loading, Error and Empty states
  assert.ok(profileContent.includes('testID="favourites-loading-state"'), 'Must render favourites-loading-state');
  assert.ok(profileContent.includes('testID="favourites-error-state"'), 'Must render favourites-error-state');
  assert.ok(profileContent.includes('testID="favourites-retry-btn"'), 'Must provide favourites-retry-btn');
  assert.ok(profileContent.includes('testID="favourites-empty-state"'), 'Must render favourites-empty-state');
  assert.ok(profileContent.includes('No favourite profiles saved yet'), 'Must show honest empty state');

  // 3. Verify Populated List & Navigation
  assert.ok(profileContent.includes('testID="favourites-list"'), 'Must render favourites-list');
  assert.ok(profileContent.includes('testID={`favourite-card-${fav.user_id}`}'), 'Must render favourite-card with testID');
  assert.ok(
    profileContent.includes("pathname: '/profile/[id]'") && profileContent.includes('params: { id: fav.user_id }'),
    'Tapping favourite profile must navigate to /profile/[id]'
  );

  // 4. Verify Direct Removal
  assert.ok(profileContent.includes('testID={`remove-favourite-${fav.user_id}`}'), 'Must render remove-favourite button with testID');
  assert.ok(profileContent.includes('handleRemoveFavourite(fav.user_id)'), 'Must call handleRemoveFavourite');
  assert.ok(profileContent.includes('discoveryService.removeFavourite(targetUserId)'), 'Must call backend removeFavourite endpoint');
});

test('My Favourites: Profile Detail Screen Bookmark Toggle', async () => {
  const detailFilePath = resolve(process.cwd(), 'app/profile/[id].tsx');
  const detailContent = await fs.readFile(detailFilePath, 'utf-8');

  // Verify favourite button in ProfileDetailScreen
  assert.ok(detailContent.includes('testID="profile-favourite-toggle"'), 'Must render profile-favourite-toggle in header');
  assert.ok(detailContent.includes('handleToggleFavourite'), 'Must bind handleToggleFavourite handler');
  assert.ok(detailContent.includes('discoveryService.addFavourite(id)'), 'Must call discoveryService.addFavourite');
  assert.ok(detailContent.includes('discoveryService.removeFavourite(id)'), 'Must call discoveryService.removeFavourite');
});

test('My Favourites: Dedicated Screen Architecture & Navigation Contract', async () => {
  // 1. Verify route registered in root Stack layout
  const layoutFilePath = resolve(process.cwd(), 'app/_layout.tsx');
  const layoutContent = await fs.readFile(layoutFilePath, 'utf-8');
  assert.ok(
    layoutContent.includes('<Stack.Screen name="favourites" options={{ headerShown: false }} />'),
    'Must register favourites screen in root Stack layout'
  );

  // 2. Verify Profile screen header navigates to dedicated /favourites screen
  const profileFilePath = resolve(process.cwd(), 'app/(tabs)/profile.tsx');
  const profileContent = await fs.readFile(profileFilePath, 'utf-8');
  assert.ok(
    profileContent.includes("router.push('/favourites' as any)"),
    'Tapping My Favourites accordion header must navigate to /favourites'
  );

  // 3. Verify Dedicated Screen file exists and exports MyFavouritesScreen default component
  const screenFilePath = resolve(process.cwd(), 'app/favourites.tsx');
  const screenContent = await fs.readFile(screenFilePath, 'utf-8');
  assert.ok(screenContent.includes('export default function MyFavouritesScreen()'), 'Must export MyFavouritesScreen');

  // 4. Verify Header controls (Back, Saved count, Column toggles, Filter toggle)
  assert.ok(screenContent.includes('testID="favourites-back-btn"'), 'Must render favourites-back-btn');
  assert.ok(screenContent.includes('testID="col-toggle-1"'), 'Must provide 1-column layout toggle');
  assert.ok(screenContent.includes('testID="col-toggle-2"'), 'Must provide 2-column layout toggle');
  assert.ok(screenContent.includes('testID="col-toggle-3"'), 'Must provide 3-column layout toggle');
  assert.ok(screenContent.includes('testID="filter-toggle-btn"'), 'Must render filter-toggle-btn');

  // 5. Verify Search and Filter Chips
  assert.ok(screenContent.includes('testID="favourites-search-input"'), 'Must render search bar');
  assert.ok(screenContent.includes('testID="filter-recently-active"'), 'Must support Recently Active filter');
  assert.ok(screenContent.includes('testID="filter-hide-messaged"'), 'Must support Hide Messaged filter');
  assert.ok(screenContent.includes('testID="filter-new-members"'), 'Must support New Members filter');
  assert.ok(screenContent.includes('testID="filter-near-me"'), 'Must support Near Me filter');
  assert.ok(screenContent.includes('testID="filter-verified-photos"'), 'Must support Verified Photos filter');
  assert.ok(screenContent.includes('testID="filter-reset-all"'), 'Must provide Reset All filters chip');

  // 6. Verify Grid Cards, Badges, Online Indicator and Actions
  assert.ok(screenContent.includes('testID={`favourite-grid-item-${item.user_id}`}'), 'Must render grid card item with testID');
  assert.ok(screenContent.includes('testID={`favourite-card-touch-${item.user_id}`}'), 'Must render card touchable');
  assert.ok(screenContent.includes("pathname: '/profile/[id]'"), 'Tapping card must navigate to profile details');
  assert.ok(screenContent.includes('testID={`remove-fav-btn-${item.user_id}`}'), 'Must render remove favourite action on card');
  assert.ok(screenContent.includes('testID={`like-fav-btn-${item.user_id}`}'), 'Must render like action on card');
  assert.ok(screenContent.includes('testID={`verified-badge-${item.user_id}`}'), 'Must render verification badge for verified photos');

  // 7. Verify Loading, Empty, Error and Refresh states
  assert.ok(screenContent.includes('testID="favourites-loading-state"'), 'Must handle loading state');
  assert.ok(screenContent.includes('testID="favourites-error-state"'), 'Must handle error state');
  assert.ok(screenContent.includes('testID="favourites-retry-btn"'), 'Must provide retry button');
  assert.ok(screenContent.includes('testID="favourites-empty-state"'), 'Must handle empty state');
  assert.ok(screenContent.includes('testID="favourites-no-matches-state"'), 'Must handle no search/filter matches state');
  assert.ok(screenContent.includes('RefreshControl'), 'Must support pull-to-refresh');
});
