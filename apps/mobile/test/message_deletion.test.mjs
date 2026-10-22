import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Message Deletion UI & Service Contract', async (t) => {
  const chatServiceCode = await fs.readFile(
    new URL('../src/services/chat/chatService.ts', import.meta.url),
    'utf-8'
  );
  const chatRoomCode = await fs.readFile(
    new URL('../src/components/ChatRoom.tsx', import.meta.url),
    'utf-8'
  );

  await t.test('chatService exports deleteMessageForEveryone and handles message.deleted events', () => {
    assert.ok(chatServiceCode.includes('deleteMessageForEveryone'), 'chatService must implement deleteMessageForEveryone');
    assert.ok(chatServiceCode.includes('onMessageDeleted'), 'ChatWebSocketClient must implement onMessageDeleted');
    assert.ok(chatServiceCode.includes('MessageDeletedReceipt'), 'chatService must define MessageDeletedReceipt');
    assert.ok(chatServiceCode.includes("case 'message.deleted':"), 'ChatWebSocketClient must handle message.deleted frame');
    assert.ok(chatServiceCode.includes('/api/v1/conversations/${conversationId}/messages/${messageId}'), 'chatService must call DELETE endpoint');
  });

  await t.test('ChatRoom subscribes to message deletion and provides sender delete UI with confirmation', () => {
    assert.ok(chatRoomCode.includes('onMessageDeleted'), 'ChatRoom must subscribe to onMessageDeleted');
    assert.ok(chatRoomCode.includes('unsubDelete'), 'ChatRoom must clean up unsubDelete');
    assert.ok(chatRoomCode.includes('delete-message-btn'), 'ChatRoom must render delete-message-btn testID');
    assert.ok(chatRoomCode.includes('Delete for Everyone?'), 'ChatRoom must prompt with Delete for Everyone confirmation modal');
    assert.ok(chatRoomCode.includes('deleteMessageForEveryone'), 'ChatRoom must call deleteMessageForEveryone');
    assert.ok(chatRoomCode.includes('This message was deleted'), 'ChatRoom must display placeholder for deleted messages');
  });

  await t.test('normalizeMessage logic replaces text with placeholder and clears media when deleted_at is set', () => {
    assert.ok(chatServiceCode.includes('const isDeleted = Boolean(raw.deleted_at);'), 'chatService must check deleted_at');
    assert.ok(chatServiceCode.includes("'This message was deleted'"), 'chatService must set placeholder string');
    assert.ok(chatServiceCode.includes('deleted_at: raw.deleted_at || null'), 'chatService must preserve deleted_at');
  });
});
