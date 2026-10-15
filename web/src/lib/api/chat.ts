/**
 * Real-Time Chat & Persistent Messaging API Client
 * Connects consumer frontend to the Aura Messaging Engine.
 */

export type MessageType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'SYSTEM';

export interface Message {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  client_message_id: string;
  body: string;
  message_type: MessageType;
  media_asset_id?: string;
  delivered_at?: string;
  read_at?: string;
  deleted_at?: string;
  created_at: string;
}

export interface ConversationPartner {
  user_id: string;
  display_name: string;
  age: number;
  avatar_url?: string;
  is_photo_verified: boolean;
  is_online: boolean;
}

export interface MessageSummary {
  id: string;
  sender_user_id: string;
  body: string;
  message_type: MessageType;
  created_at: string;
  is_read: boolean;
}

export interface Conversation {
  id: string;
  match_id: string;
  participant_low_id: string;
  participant_high_id: string;
  last_message_at?: string;
  created_at: string;
  partner?: ConversationPartner;
  last_message?: MessageSummary;
  unread_count: number;
}

export interface SendMessageRequest {
  client_message_id: string;
  body: string;
  message_type?: MessageType;
  media_asset_id?: string;
}

export interface MessagesPageResponse {
  messages: Message[];
  next_cursor?: string;
  has_more: boolean;
}

export interface ConversationsListResponse {
  count: number;
  conversations: Conversation[];
}

/**
 * Fetch all active match conversation threads for the current user.
 */
export async function getConversations(): Promise<ConversationsListResponse> {
  const res = await fetch('/api/v1/conversations', {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to fetch conversations (${res.status})`);
  }

  return res.json();
}

/**
 * Fetch cursor-paginated messages for a conversation.
 */
export async function getConversationMessages(
  conversationId: string,
  beforeId?: string,
  limit: number = 50
): Promise<MessagesPageResponse> {
  const params = new URLSearchParams({ limit: limit.toString() });
  if (beforeId) params.set('before_id', beforeId);

  const res = await fetch(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to fetch messages (${res.status})`);
  }

  return res.json();
}

/**
 * Send a message via durable REST endpoint.
 */
export async function sendChatMessage(
  conversationId: string,
  req: SendMessageRequest
): Promise<Message> {
  const res = await fetch(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to send message (${res.status})`);
  }

  return res.json();
}

/**
 * Mark all incoming messages in a conversation as read.
 */
export async function markConversationRead(conversationId: string): Promise<void> {
  await fetch(`/api/v1/conversations/${encodeURIComponent(conversationId)}/read`, {
    method: 'POST',
    headers: { 'Accept': 'application/json' },
  });
}

/**
 * Register push token with the server.
 */
export async function registerPushToken(
  token: string,
  platform: 'WEB' | 'IOS' | 'ANDROID',
  deviceId?: string
): Promise<void> {
  await fetch('/api/v1/notifications/push-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ token, platform, device_id: deviceId }),
  });
}
