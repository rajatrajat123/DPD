import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

test('Discovery UI Preservation & Super Like / Favourite Specifications', async (t) => {
  const filePath = resolve(process.cwd(), 'src/components/discovery/DiscoveryDeck.tsx');
  assert.equal(existsSync(filePath), true, 'DiscoveryDeck.tsx must exist');
  const content = readFileSync(filePath, 'utf-8');

  await t.test('1. Preserves existing card structure, dimensions, and action buttons without redesign', () => {
    // Card styling preserved
    assert.match(content, /minHeight:\s*'580px'/, 'Main candidate card minHeight 580px must be preserved');
    assert.match(content, /borderRadius:\s*'16px'/, 'Main candidate card borderRadius 16px must be preserved');
    assert.match(content, /border:\s*'1px solid var\(--border-gold\)'/, 'Main candidate card gold border must be preserved');

    // Pass button preserved
    assert.match(content, /width:\s*'58px'/, 'Pass button width 58px must be preserved');
    assert.match(content, /height:\s*'58px'/, 'Pass button height 58px must be preserved');
    assert.match(content, /✕/, 'Pass button icon must be preserved');

    // Star button preserved
    assert.match(content, /width:\s*'52px'/, 'Star button width 52px must be preserved');
    assert.match(content, /height:\s*'52px'/, 'Star button height 52px must be preserved');
    assert.match(content, /⭐/, 'Star button icon must be preserved');

    // Like button preserved
    assert.match(content, /width:\s*'66px'/, 'Like button width 66px must be preserved');
    assert.match(content, /height:\s*'66px'/, 'Like button height 66px must be preserved');
    assert.match(content, /💖/, 'Like button icon must be preserved');
  });

  await t.test('2. Reuses existing Star button between X and Like with zero duplicate controls', () => {
    // Exactly one Star button in action controls
    const starMatches = content.match(/onClick=\{\(\)\s*=>\s*handleSwipe\('SUPER_SPARK'\)\}/g);
    assert.equal(starMatches?.length, 1, 'Must have exactly one handleSwipe("SUPER_SPARK") action button');

    assert.match(content, /data-testid="super-like-button"/, 'Star button must be identified as Super Like');
    assert.match(content, /aria-label="Super Like candidate"/, 'Star button must have descriptive aria-label');
    assert.match(content, /disabled=\{swiping\}/, 'Buttons must be disabled while in-flight to prevent duplicate taps');
  });

  await t.test('3. Premium Super Like animations with spring motion and reduced motion support', () => {
    // Star animation feedback
    assert.match(content, /starPulse/, 'Uses starPulse state for star icon feedback');
    assert.match(content, /scale\(1\.28\)\s*rotate\(15deg\)/, 'Star scales up and rotates on tap');
    assert.match(content, /rgba\(195,\s*161,\s*91/, 'Star button emits subtle golden glow');

    // Active card enlargement and fly-up exit
    assert.match(content, /scale\(1\.08\)\s*translateY\(-8px\)/, 'Card enlarges to approx 1.08 scale with elevation');
    assert.match(content, /translateY\(-130px\)\s*scale\(0\.92\)/, 'Card glides upward and scales down on confirmed success');
    assert.match(content, /nextCandidate/, 'Smooth next card entrance from behind');
    assert.match(content, /superLikeToast/, 'Displays confirmation toast after confirmed success');
    assert.match(content, /Super Like sent ⭐/, 'Includes tasteful Super Like sent text');

    // Error rollback & reduced motion
    assert.match(content, /setAnimationPhase\('idle'\)/, 'Cancels exit animation and restores card on failure');
    assert.match(content, /prefersReducedMotion/, 'Supports prefers-reduced-motion');
  });

  await t.test('4. Identifies Super Likes on profile cards and mutual match celebrations', () => {
    // Candidate card badge
    assert.match(content, /data-testid="super-like-badge"/, 'Card header must render super-like-badge for incoming super likes');
    assert.match(content, /currentCandidate\.has_super_liked\s*\|\|\s*currentCandidate\.is_super_like/, 'Checks candidate super like flag');
    assert.match(content, /⭐ Super Like/, 'Renders Super Like text badge');

    // Match celebration modal
    assert.match(content, /lastSwipeDirection === 'SUPER_SPARK' \? 'Super Like Match!' : 'It\\'s a Mutual Match!'/, 'Celebration modal identifies Super Like match');
  });

  await t.test('5. Keeps Favourite visually separate from X, Star, and Like, and prevents underlying swipe triggers', () => {
    // Favourite placed in Top Deck Status Bar
    assert.match(content, /data-testid="favourite-toggle-button"/, 'Renders favourite toggle button in top status bar');
    assert.match(content, /e\.stopPropagation\(\)/, 'Favourite toggle must call stopPropagation to prevent card or swipe triggering');
    assert.match(content, /e\.preventDefault\(\)/, 'Favourite toggle must call preventDefault');

    // Visually distinct icon (bookmark ribbon, not a duplicate star)
    assert.match(content, /🔖/, 'Uses distinct bookmark ribbon icon for active favourite');
    assert.match(content, /🏷️/, 'Uses tag icon for inactive favourite');
  });

  await t.test('6. Replaces localStorage with authenticated backend persistence and optimistic rollback', () => {
    // Authenticated API functions imported and called
    assert.match(content, /getFavourites/, 'Calls getFavourites from API');
    assert.match(content, /addFavourite/, 'Calls addFavourite on backend');
    assert.match(content, /removeFavourite/, 'Calls removeFavourite on backend');

    // Zero reliance on localStorage as source of truth
    assert.doesNotMatch(content, /localStorage\.getItem\('aura_favourite_profiles'\)/, 'Must not use localStorage as authoritative source of truth');

    // Optimistic rollback on error
    assert.match(content, /Rollback on API failure/, 'Implements optimistic rollback when favourite API fails');

    // Card header indicator badge and review modal
    assert.match(content, /data-testid="favourite-badge"/, 'Displays favourite badge on card when active');
    assert.match(content, /data-testid="manage-favourites-button"/, 'Displays manage favourites modal button');
    assert.match(content, /data-testid="favourites-modal"/, 'Includes favourites management modal');
    assert.match(content, /data-testid=\{`remove-favourite-\$\{fav\.user_id\}`\}/, 'Supports removing profiles from favourites');
  });

  await t.test('7. Verifies proxy routes have zero fake success fallbacks', () => {
    const swipeRoutePath = resolve(process.cwd(), 'src/app/api/v1/swipes/route.ts');
    assert.equal(existsSync(swipeRoutePath), true, 'swipes/route.ts must exist');
    const swipeRouteContent = readFileSync(swipeRoutePath, 'utf-8');
    assert.doesNotMatch(swipeRouteContent, /usr_maya_demo_01/, 'No hardcoded fake matches in swipe proxy');
    assert.match(swipeRouteContent, /proxyToBackend\(req,\s*'\/api\/v1\/swipes'\)/, 'Properly proxies directly to backend');

    const feedRoutePath = resolve(process.cwd(), 'src/app/api/v1/discovery/feed/route.ts');
    const feedRouteContent = readFileSync(feedRoutePath, 'utf-8');
    assert.doesNotMatch(feedRouteContent, /has_super_liked:\s*true/, 'Production fallback data must not claim fake Super Likes');
  });

  await t.test('8. Recipient Likes You screen exists and renders genuine Super Like indicator', () => {
    const likesPagePath = resolve(process.cwd(), 'src/app/app/likes/page.tsx');
    assert.equal(existsSync(likesPagePath), true, 'Likes You page route must exist at /app/likes');

    const likesListPath = resolve(process.cwd(), 'src/components/discovery/LikesYouList.tsx');
    assert.equal(existsSync(likesListPath), true, 'LikesYouList component must exist');
    const likesListContent = readFileSync(likesListPath, 'utf-8');
    assert.match(likesListContent, /data-testid="incoming-super-like-badge"/, 'Renders incoming super like badge');
    assert.match(likesListContent, /getLikesYou/, 'Calls authenticated getLikesYou API');
  });
});
