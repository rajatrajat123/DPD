import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Passport-Based Age Verification Mobile Screen & Integration Contracts', async (t) => {
  const verifyAgeCode = await fs.readFile(
    new URL('../app/(auth)/verify-age.tsx', import.meta.url),
    'utf-8'
  );
  const authServiceCode = await fs.readFile(
    new URL('../src/services/auth/authService.ts', import.meta.url),
    'utf-8'
  );

  await t.test('zero Aura document storage invariant', () => {
    // Must never upload passport photos or raw selfie documents to Aura media endpoints
    assert.ok(
      !verifyAgeCode.includes('/api/v1/media/upload'),
      'verify-age screen must not upload identity documents to Aura media storage'
    );
    assert.ok(
      !verifyAgeCode.includes('uploadPhoto'),
      'verify-age screen must not call media upload helpers'
    );
    assert.ok(
      verifyAgeCode.includes('Zero document storage: Aura never receives, processes, or stores your passport photo or ID images'),
      'screen must display clear zero-retention privacy assurance to user'
    );
  });

  await t.test('hosted vendor web session integration via expo-web-browser', () => {
    assert.ok(
      verifyAgeCode.includes("from 'expo-web-browser'"),
      'must import expo-web-browser for hosted Persona verification'
    );
    assert.ok(
      verifyAgeCode.includes('WebBrowser.openAuthSessionAsync'),
      'must use WebBrowser.openAuthSessionAsync for secure in-app auth session'
    );
    assert.ok(
      verifyAgeCode.includes('Linking.createURL'),
      'must register custom redirect scheme via expo-linking'
    );
  });

  await t.test('authoritative status verification invariant (never trusts client redirect alone)', () => {
    // When returning from browser, client MUST call backend authoritative status endpoint
    assert.ok(
      authServiceCode.includes('getAgeAssuranceStatus()'),
      'authService must have getAgeAssuranceStatus endpoint'
    );
    assert.ok(
      verifyAgeCode.includes('authService.getAgeAssuranceStatus()'),
      'screen must call backend getAgeAssuranceStatus on browser return'
    );
    assert.ok(
      verifyAgeCode.includes('pollAuthoritativeStatus'),
      'screen must verify status authoritatively with polling/backoff'
    );
  });

  await t.test('provides required testIDs for automated testing and QA', () => {
    const requiredTestIDs = [
      'start-verification-button',
      'return-to-app-button',
      'check-status-button',
      'enter-aura-button',
      'retry-verification-button',
    ];
    for (const testID of requiredTestIDs) {
      assert.ok(
        verifyAgeCode.includes(`testID="${testID}"`),
        `verify-age screen must render testID="${testID}"`
      );
    }
  });

  await t.test('handles cancellation and browser dismissal gracefully', () => {
    assert.ok(
      verifyAgeCode.includes("browserRes.type === 'cancel'") && verifyAgeCode.includes("browserRes.type === 'dismiss'"),
      'must handle browser dismiss/cancel events cleanly'
    );
    assert.ok(
      verifyAgeCode.includes('Verification was cancelled or closed'),
      'must provide clear guidance when user cancels session'
    );
  });

  await t.test('highlights government-issued passport support and manual review support', () => {
    assert.ok(
      verifyAgeCode.includes('PASSPORT & GOVERNMENT ID') || verifyAgeCode.includes('passport or government ID'),
      'screen must clearly instruct user to have passport or government ID ready'
    );
    assert.ok(
      verifyAgeCode.includes('MANUAL_REVIEW'),
      'screen must support manual review status'
    );
    assert.ok(
      verifyAgeCode.includes('REJECTED'),
      'screen must support rejected status'
    );
  });
});
