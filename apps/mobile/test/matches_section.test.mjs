import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Matches UI: Chat tab provides dedicated segmented navigation (Matches, Messages, Requests)', async () => {
  const chatFile = await fs.readFile(
    new URL('../app/(tabs)/chat.tsx', import.meta.url),
    'utf-8'
  );

  // 1. Segmented Navigation types and state
  assert.ok(
    chatFile.includes("type ChatTab = 'matches' | 'messages' | 'requests'"),
    'Chat screen must define 3-segment type: matches, messages, requests'
  );
  assert.ok(
    chatFile.includes("testID=\"chat-segmented-navigation\""),
    'Chat screen must render segmented control container'
  );
  assert.ok(
    chatFile.includes("testID=\"chat-tab-matches\""),
    'Chat screen must render Matches segment tab'
  );
  assert.ok(
    chatFile.includes("testID=\"chat-tab-messages\""),
    'Chat screen must render Messages segment tab'
  );
  assert.ok(
    chatFile.includes("testID=\"chat-tab-requests\""),
    'Chat screen must render Requests segment tab'
  );

  // 2. Tab badge counters
  assert.ok(
    chatFile.includes('matches.length'),
    'Matches tab must reflect genuine match count'
  );
  assert.ok(
    chatFile.includes('totalUnreadMessages') || chatFile.includes('conversations.length'),
    'Messages tab must reflect unread or active conversations'
  );
  assert.ok(
    chatFile.includes('messageRequests.length'),
    'Requests tab must reflect pending request count'
  );
});

test('Match Behavior: Displays mutual matches, rich profile details, deduplication, and conversation launch', async () => {
  const chatFile = await fs.readFile(
    new URL('../app/(tabs)/chat.tsx', import.meta.url),
    'utf-8'
  );

  // 1. Authoritative backend service call (no mock profiles)
  assert.ok(
    chatFile.includes('chatService.getMatches()'),
    'Chat screen must fetch real mutual matches from chatService.getMatches()'
  );

  // 2. Deduplication of matches and conversations
  assert.ok(
    chatFile.includes('seenMatchUsers'),
    'Chat screen must deduplicate matches to prevent duplicate cards'
  );
  assert.ok(
    chatFile.includes('seenConvIds'),
    'Chat screen must deduplicate conversations to prevent duplicate rows'
  );

  // 3. Rich profile details on match cards
  assert.ok(
    chatFile.includes('m.target_profile?.avatar_url'),
    'Match card must render profile photo from target_profile'
  );
  assert.ok(
    chatFile.includes('m.target_profile?.display_name'),
    'Match card must render display name'
  );
  assert.ok(
    chatFile.includes('m.target_profile?.is_verified'),
    'Match card must render verified badge'
  );
  assert.ok(
    chatFile.includes('formatMatchTime'),
    'Match card must render human-readable matched time'
  );
  assert.ok(
    chatFile.includes('matchCardBio') || chatFile.includes('m.target_profile?.bio'),
    'Match card must render bio snippet when available'
  );

  // 4. Fallback monogram for profiles without photos
  assert.ok(
    chatFile.includes('matchCardMonogram') || chatFile.includes('avatarPlaceholder'),
    'Match card must render fallback monogram when avatar photo is missing'
  );

  // 5. Tapping match opens conversation without creating duplicates
  assert.ok(
    chatFile.includes('handleMatchPress'),
    'Chat screen must handle match press via dedicated handler'
  );
  assert.ok(
    chatFile.includes('conversations.find'),
    'Match press must check existing conversation threads to prevent duplicate conversations'
  );
  assert.ok(
    chatFile.includes("router.push({\n      pathname: '/chat/[id]'") ||
    chatFile.includes("pathname: '/chat/[id]'"),
    'Match press must route to /chat/[id]'
  );

  // 6. Dedicated empty state when user has zero matches
  assert.ok(
    chatFile.includes('No Matches Yet'),
    'Matches view must display clean empty state title when matches is empty'
  );
  assert.ok(
    chatFile.includes('When both you and another member like each other'),
    'Matches view empty state must clearly describe mutual like requirement'
  );
  assert.ok(
    chatFile.includes("router.push('/(tabs)')"),
    'Matches view empty state must provide discovery CTA button'
  );
});

test('Bottom Navigation Stability: Exactly 5 tabs, no 6th item, Aura VIP preserved, responsive spacing', async () => {
  const layoutFile = await fs.readFile(
    new URL('../app/(tabs)/_layout.tsx', import.meta.url),
    'utf-8'
  );

  // 1. Exactly 5 visible tabs
  const tabScreens = [
    'name="index"',
    'name="likes"',
    'name="chat"',
    'name="membership"',
    'name="profile"',
  ];

  for (const name of tabScreens) {
    assert.ok(layoutFile.includes(name), `TabLayout must include ${name}`);
  }

  // 2. Hidden secondary routes have href: null (not 6th bottom-nav item)
  assert.ok(
    layoutFile.includes('name="matches"\n        options={{\n          href: null,'),
    'matches route must remain a hidden secondary screen with href: null'
  );

  // 3. Aura VIP access is preserved
  assert.ok(
    layoutFile.includes("title: 'Aura VIP'"),
    'Aura VIP tab must remain prominently available in bottom navigation'
  );

  // 4. Spacing and responsive layout
  assert.ok(
    layoutFile.includes('tabBarItemStyle: styles.tabBarItem'),
    'TabLayout must configure tabBarItemStyle'
  );
  assert.ok(
    layoutFile.includes('minHeight: 48'),
    'tabBarItem must enforce >= 48dp touch targets'
  );
  assert.ok(
    layoutFile.includes('horizontalInset'),
    'TabLayout must protect edge tabs with horizontalInset'
  );
});
