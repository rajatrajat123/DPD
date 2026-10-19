import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Discovery Search: discoveryService enforces >= 2 characters guard before API request', async () => {
  const serviceFile = await fs.readFile(
    new URL('../src/services/discovery/discoveryService.ts', import.meta.url),
    'utf-8'
  );

  assert.ok(
    serviceFile.includes('async search(query: string, limit = 20)'),
    'discoveryService must retain async search(query: string, limit = 20) signature'
  );
  assert.ok(
    serviceFile.includes("'/api/v1/discovery/search'"),
    'discoveryService must call /api/v1/discovery/search'
  );
  assert.ok(
    serviceFile.includes('trimmed.length < 2'),
    'discoveryService must guard against queries shorter than 2 characters'
  );
  assert.ok(
    serviceFile.includes('candidates: []'),
    'discoveryService must return empty candidate list for short queries'
  );
});

test('Discovery Search: search.tsx replaces deprecated SafeAreaView with react-native-safe-area-context', async () => {
  const searchFile = await fs.readFile(
    new URL('../app/search.tsx', import.meta.url),
    'utf-8'
  );

  assert.ok(
    searchFile.includes("from 'react-native-safe-area-context'"),
    'search.tsx must import SafeAreaView from react-native-safe-area-context'
  );
  assert.ok(
    !searchFile.includes("SafeAreaView,") || !searchFile.includes("from 'react-native'"),
    'search.tsx must not import SafeAreaView from react-native'
  );
  assert.ok(
    searchFile.includes("edges={['top', 'bottom']}"),
    'search.tsx SafeAreaView must declare top and bottom edges'
  );
});

test('Discovery Search: search.tsx does not execute empty search on mount or clear', async () => {
  const searchFile = await fs.readFile(
    new URL('../app/search.tsx', import.meta.url),
    'utf-8'
  );

  // Initial mount must not run performSearch('')
  assert.ok(
    !searchFile.includes("performSearch('');") && !searchFile.includes('performSearch("")'),
    'search.tsx must never call performSearch with empty string'
  );

  // handleClear must dismiss keyboard and reset state without querying
  assert.ok(
    searchFile.includes('Keyboard.dismiss()'),
    'handleClear must dismiss the keyboard'
  );
  assert.ok(
    searchFile.includes('searchSeqRef.current++') || searchFile.includes('++searchSeqRef.current'),
    'search.tsx must track request sequence to cancel out-of-order race conditions'
  );
});

test('Discovery Search: search.tsx provides distinct UI states (loading, error with retry, results, no-results, short query, explore prompt)', async () => {
  const searchFile = await fs.readFile(
    new URL('../app/search.tsx', import.meta.url),
    'utf-8'
  );

  assert.ok(searchFile.includes('Search Unavailable'), 'search.tsx must render search error title');
  assert.ok(searchFile.includes('Retry Search'), 'search.tsx must provide retry search button');
  assert.ok(searchFile.includes('No Profiles Found'), 'search.tsx must render no results title');
  assert.ok(searchFile.includes('Keep Typing'), 'search.tsx must prompt user when query is less than 2 characters');
  assert.ok(searchFile.includes('Please enter at least 2 characters'), 'search.tsx must explain query minimum length');
  assert.ok(searchFile.includes('Explore Aura'), 'search.tsx must show initial Explore Aura prompt on empty state');
});
