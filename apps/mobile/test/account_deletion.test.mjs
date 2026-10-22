import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Account Deletion Settings Flow & Subscription Notice Contract', async (t) => {
  const settingsCode = await fs.readFile(
    new URL('../app/(tabs)/settings.tsx', import.meta.url),
    'utf-8'
  );
  const authServiceCode = await fs.readFile(
    new URL('../src/services/auth/authService.ts', import.meta.url),
    'utf-8'
  );
  const authContextCode = await fs.readFile(
    new URL('../src/context/AuthContext.tsx', import.meta.url),
    'utf-8'
  );

  await t.test('authService and AuthContext expose deleteAccount', () => {
    assert.ok(authServiceCode.includes('deleteAccount(password'), 'authService must define deleteAccount');
    assert.ok(authServiceCode.includes('/api/v1/auth/delete-account'), 'authService must post to /api/v1/auth/delete-account');
    assert.ok(authContextCode.includes('deleteAccount:'), 'AuthContext must expose deleteAccount');
  });

  await t.test('settings screen renders discoverable delete account button and testIDs', () => {
    assert.ok(settingsCode.includes('testID="delete-account-open-btn"'), 'settings must have open delete button testID');
    assert.ok(settingsCode.includes('testID="delete-account-password-input"'), 'settings must have password input testID');
    assert.ok(settingsCode.includes('testID="delete-account-confirm-btn"'), 'settings must have confirm delete button testID');
  });

  await t.test('settings screen includes permanent warning and in-store subscription cancellation notice', () => {
    assert.ok(
      settingsCode.includes('This action is permanent and irreversible'),
      'settings must warn user that account deletion is permanent'
    );
    assert.ok(
      settingsCode.includes('Google Play or Apple App Store') && settingsCode.includes('does NOT automatically cancel subscriptions'),
      'settings must explicitly inform user that store subscriptions must be cancelled in-store'
    );
  });
});
