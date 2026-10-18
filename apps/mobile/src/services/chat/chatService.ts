import { api } from '../api/client';
import { config } from '../../config/env';
import { secureStorage } from '../storage/secureStore';
import { Match, Conversation, Message, MessageRequest } from '../../types';
import { buildMediaUrl } from '../media/mediaUploader';

export type ConnectionStatus = 'CONNECTED' | 'CONNECTING' | 'RECONNECTING' | 'DISCONNECTED';

export interface DeliveredReceipt {
  message_id: string;
  client_message_id?: string;
  delivered_at: string;
}

export interface ReadReceipt {
  conversation_id: string;
  reader_user_id: string;
  read_at: string;
}

export type MessageListener = (message: Message) => void;
export type DeliveryListener = (receipt: DeliveredReceipt) => void;
export type ReadReceiptListener = (receipt: ReadReceipt) => void;
export type TypingListener = (data: { conversation_id: string; user_id: string; is_typing: boolean }) => void;
export type ConnectionListener = (status: ConnectionStatus) => void;

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function normalizeMessage(raw: any): Message {
  if (!raw) {
    return {
      id: generateUUID(),
      conversation_id: '',
      sender_user_id: '',
      body: '',
      created_at: new Date().toISOString(),
    };
  }

  const isRead = Boolean(raw.read_at);
  const isDelivered = Boolean(raw.delivered_at);
  let status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' = 'SENT';
  if (isRead) status = 'READ';
  else if (isDelivered) status = 'DELIVERED';
  else if (raw.status) status = raw.status;

  const senderId = raw.sender_user_id || raw.sender_id || '';
  const textBody = raw.body !== undefined ? raw.body : (raw.content || '');

  return {
    id: raw.id || raw.client_message_id || generateUUID(),
    conversation_id: raw.conversation_id || '',
    sender_user_id: senderId,
    sender_id: senderId,
    client_message_id: raw.client_message_id,
    body: textBody,
    content: textBody,
    message_type: raw.message_type || (raw.media_asset_id ? 'IMAGE' : 'TEXT'),
    media_asset_id: raw.media_asset_id,
    media_url: raw.media_url,
    audio_duration_ms: raw.audio_duration_ms || raw.duration_ms,
    delivered_at: raw.delivered_at || null,
    read_at: raw.read_at || null,
    status,
    created_at: raw.created_at || new Date().toISOString(),
  };
}

export function normalizeMatch(raw: any): Match {
  const targetProf = raw.matched_profile || raw.target_profile || {};
  const targetId = raw.matched_user_id || raw.target_user_id || targetProf.user_id || '';
  const photos = Array.isArray(targetProf.photos) ? targetProf.photos : [];
  const rawAvatar = targetProf.avatar_url || photos[0]?.card_url || photos[0]?.thumb_url || photos[0]?.url || '';
  const avatarUrl = rawAvatar ? buildMediaUrl(rawAvatar) : undefined;

  return {
    id: raw.id,
    user_id: raw.user_id || '',
    target_user_id: targetId,
    target_profile: {
      user_id: targetId,
      display_name: targetProf.display_name || 'Member',
      avatar_url: avatarUrl,
      is_verified: Boolean(targetProf.is_photo_verified || targetProf.is_verified),
      gender_identities: targetProf.gender_identities,
      bio: targetProf.bio,
      age: targetProf.age,
      relationship_structure: targetProf.relationship_structure,
    },
    matched_at: raw.matched_at || new Date().toISOString(),
  };
}

export function normalizeConversation(raw: any, currentUserId?: string): Conversation {
  const partner = raw.partner || {};
  const partnerId =
    partner.user_id ||
    (raw.participant_low_id === currentUserId ? raw.participant_high_id : raw.participant_low_id) ||
    raw.participant_id ||
    '';
  const partnerName = partner.display_name || raw.participant_name || 'Member';
  const rawAvatar = partner.avatar_url || raw.participant_avatar || '';
  const partnerAvatar = rawAvatar ? buildMediaUrl(rawAvatar) : undefined;
  const lastMsg = raw.last_message;

  return {
    id: raw.id || raw.match_id || '',
    match_id: raw.match_id || raw.id || '',
    participant_id: partnerId,
    participant_name: partnerName,
    participant_avatar: partnerAvatar,
    participant_verified: Boolean(partner.is_photo_verified || raw.participant_verified),
    last_message: lastMsg
      ? {
          id: lastMsg.id || '',
          sender_id: lastMsg.sender_user_id || lastMsg.sender_id || '',
          content: lastMsg.body !== undefined ? lastMsg.body : lastMsg.content || '',
          created_at: lastMsg.created_at || new Date().toISOString(),
          read: Boolean(lastMsg.is_read || lastMsg.read),
        }
      : undefined,
    unread_count: Math.max(0, Number(raw.unread_count) || 0),
    updated_at: raw.last_message_at || raw.created_at || new Date().toISOString(),
  };
}

export function normalizeMessageRequest(raw: any): MessageRequest {
  const sender = raw.sender || {};
  const senderId = raw.sender_user_id || raw.sender_id || sender.user_id || '';
  const senderName = raw.sender_name || sender.display_name || 'Member';
  const rawAvatar = raw.sender_avatar || sender.avatar_url || '';
  const avatarUrl = rawAvatar ? buildMediaUrl(rawAvatar) : undefined;

  return {
    id: raw.id,
    sender_user_id: senderId,
    recipient_user_id: raw.recipient_user_id,
    body: raw.body || '',
    status: raw.status || 'PENDING',
    created_at: raw.created_at || new Date().toISOString(),
    responded_at: raw.responded_at,
    sender_id: senderId,
    sender_name: senderName,
    sender_age: raw.sender_age ?? sender.age,
    sender_avatar: avatarUrl,
    sender_is_verified: Boolean(raw.sender_is_verified || sender.is_photo_verified),
    sender: {
      user_id: senderId,
      display_name: senderName,
      age: raw.sender_age ?? sender.age ?? 0,
      avatar_url: avatarUrl,
      is_photo_verified: Boolean(raw.sender_is_verified || sender.is_photo_verified),
    },
  };
}

/**
 * Authoritatively counts unread incoming messages from a message history list.
 * Strictly excludes messages sent by the current user and messages already marked as read.
 */
export function countUnreadIncomingMessages(messages: Message[], currentUserId?: string): number {
  if (!Array.isArray(messages)) return 0;
  return messages.filter((m) => {
    const isMe =
      (currentUserId && (m.sender_user_id === currentUserId || m.sender_id === currentUserId)) ||
      m.sender_user_id === 'me' ||
      m.sender_id === 'me';
    if (isMe) return false;
    const isRead = Boolean(m.read_at) || m.status === 'READ';
    return !isRead;
  }).length;
}

/**
 * Calculates total unread incoming messages across conversations without double-counting.
 */
export function calculateTotalUnreadCount(conversations: Conversation[]): number {
  if (!Array.isArray(conversations)) return 0;
  return conversations.reduce((sum, c) => sum + (c.unread_count > 0 ? c.unread_count : 0), 0);
}

class ChatWebSocketClient {
  private socket: WebSocket | null = null;
  private status: ConnectionStatus = 'DISCONNECTED';
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;

  private messageListeners: Set<MessageListener> = new Set();
  private deliveryListeners: Set<DeliveryListener> = new Set();
  private readListeners: Set<ReadReceiptListener> = new Set();
  private typingListeners: Set<TypingListener> = new Set();
  private connectionListeners: Set<ConnectionListener> = new Set();

  public get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  public async connect(): Promise<void> {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const token = await secureStorage.getAccessToken();
    if (!token) {
      this.setStatus('DISCONNECTED');
      return;
    }

    this.setStatus(this.reconnectAttempts > 0 ? 'RECONNECTING' : 'CONNECTING');

    const wsUrl = `${config.wsUrl}?token=${encodeURIComponent(token)}`;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        this.setStatus('CONNECTED');
        this.reconnectAttempts = 0;
        this.startHeartbeat();
      };

      this.socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data);
          this.handleIncomingFrame(frame);
        } catch {
          // Ignore malformed frame
        }
      };

      this.socket.onerror = () => {
        // WebSocket error triggers onclose
      };

      this.socket.onclose = () => {
        this.stopHeartbeat();
        this.setStatus('DISCONNECTED');
        this.scheduleReconnect();
      };
    } catch {
      this.setStatus('DISCONNECTED');
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.setStatus('DISCONNECTED');
  }

  public sendMessage(
    conversationId: string,
    content: string,
    clientMessageId?: string,
    mediaAssetId?: string,
    messageType?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'VOICE_NOTE',
    durationMs?: number
  ): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false; // Fall back to REST
    }

    const resolvedType = messageType || (mediaAssetId ? 'IMAGE' : 'TEXT');
    const frame: any = {
      action: 'message.send',
      conversation_id: conversationId,
      client_message_id: clientMessageId || generateUUID(),
      body: content,
      message_type: resolvedType,
      media_asset_id: mediaAssetId,
    };
    if (durationMs && durationMs > 0) {
      frame.duration_ms = durationMs;
      frame.audio_duration_ms = durationMs;
    }

    this.socket.send(JSON.stringify(frame));
    return true;
  }

  public sendTyping(conversationId: string, isTyping: boolean): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const frame = {
      action: isTyping ? 'typing.start' : 'typing.stop',
      conversation_id: conversationId,
    };
    this.socket.send(JSON.stringify(frame));
  }

  public sendReadReceipt(conversationId: string, messageId?: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const frame = {
      action: 'message.read',
      conversation_id: conversationId,
      message_id: messageId,
    };
    this.socket.send(JSON.stringify(frame));
  }

  public onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  public onDelivery(listener: DeliveryListener): () => void {
    this.deliveryListeners.add(listener);
    return () => this.deliveryListeners.delete(listener);
  }

  public onReadReceipt(listener: ReadReceiptListener): () => void {
    this.readListeners.add(listener);
    return () => this.readListeners.delete(listener);
  }

  public onTyping(listener: TypingListener): () => void {
    this.typingListeners.add(listener);
    return () => this.typingListeners.delete(listener);
  }

  public onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    listener(this.status);
    return () => this.connectionListeners.delete(listener);
  }

  private handleIncomingFrame(frame: any): void {
    const eventType = frame.type || frame.action;
    const payload = frame.payload || frame.data || {};

    switch (eventType) {
      case 'message.new': {
        const msg = normalizeMessage(payload);
        this.messageListeners.forEach((fn) => fn(msg));
        break;
      }
      case 'message.delivered': {
        const receipt: DeliveredReceipt = {
          message_id: payload.message_id,
          client_message_id: payload.client_message_id,
          delivered_at: payload.delivered_at || new Date().toISOString(),
        };
        this.deliveryListeners.forEach((fn) => fn(receipt));
        break;
      }
      case 'message.read': {
        const receipt: ReadReceipt = {
          conversation_id: payload.conversation_id,
          reader_user_id: payload.reader_user_id,
          read_at: payload.read_at || new Date().toISOString(),
        };
        this.readListeners.forEach((fn) => fn(receipt));
        break;
      }
      case 'typing.indicator':
      case 'typing.start':
      case 'typing.stop': {
        const isTyping = eventType === 'typing.stop' ? false : Boolean(payload.is_typing ?? true);
        this.typingListeners.forEach((fn) =>
          fn({
            conversation_id: String(payload.conversation_id),
            user_id: String(payload.user_id),
            is_typing: isTyping,
          })
        );
        break;
      }
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.connectionListeners.forEach((fn) => fn(status));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 15000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ action: 'ping' }));
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

export const chatWebSocket = new ChatWebSocketClient();

// In-memory unread management state
let currentAuthUserId: string | null = null;
let activeConversationId: string | null = null;
const conversationUnreadCounts = new Map<string, number>();
const matchToConvMap = new Map<string, string>();
const unreadListeners = new Set<(total: number, conversationId?: string) => void>();
const seenMessageIds = new Set<string>();

function notifyUnread(changedConvId?: string) {
  const processedIds = new Set<string>();
  let total = 0;
  for (const [id, count] of conversationUnreadCounts.entries()) {
    const canonicalId = matchToConvMap.get(id) || id;
    if (!processedIds.has(canonicalId)) {
      processedIds.add(canonicalId);
      if (count > 0) total += count;
    }
  }
  unreadListeners.forEach((fn) => fn(total, changedConvId));
}

export const chatService = {
  /**
   * Fetches active mutual matches
   */
  async getMatches(): Promise<Match[]> {
    const res = await api.get<{ matches: any[] }>('/api/v1/matches');
    return (res.matches || []).map(normalizeMatch);
  },

  /**
   * Removes a mutual match
   */
  async unmatch(matchId: string): Promise<boolean> {
    await api.delete(`/api/v1/matches/${matchId}`);
    return true;
  },

  /**
   * Fetches active conversation threads with unread indicators
   */
  async getConversations(currentUserId?: string): Promise<Conversation[]> {
    if (currentUserId) {
      currentAuthUserId = currentUserId;
    }
    const res = await api.get<{ conversations: any[] }>('/api/v1/conversations');
    const convs = (res.conversations || []).map((c) => normalizeConversation(c, currentAuthUserId || currentUserId));

    // Update in-memory unread counts from authoritative server state
    conversationUnreadCounts.clear();
    matchToConvMap.clear();

    for (const c of convs) {
      const count = Math.max(0, Number(c.unread_count) || 0);
      conversationUnreadCounts.set(c.id, count);
      if (c.match_id) {
        matchToConvMap.set(c.match_id, c.id);
        if (c.match_id !== c.id) {
          conversationUnreadCounts.set(c.match_id, count);
        }
      }
    }

    notifyUnread();
    return convs;
  },

  /**
   * Fetches message history with cursor pagination
   */
  async getMessages(conversationId: string, beforeId?: string, limit = 50): Promise<Message[]> {
    const res = await api.get<{ messages: any[] }>(`/api/v1/conversations/${conversationId}/messages`, {
      before_id: beforeId,
      limit,
    });
    return (res.messages || []).map(normalizeMessage);
  },

  /**
   * Sends a message via WebSocket, with automatic transparent REST fallback
   */
  async sendMessage(
    conversationId: string,
    content: string,
    currentUserId = 'me',
    mediaAssetId?: string,
    messageType?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'VOICE_NOTE',
    customClientMessageId?: string,
    durationMs?: number
  ): Promise<Message> {
    const clientMessageId = customClientMessageId || generateUUID();
    const resolvedType = messageType || (mediaAssetId ? 'IMAGE' : 'TEXT');
    const wsSent = chatWebSocket.sendMessage(conversationId, content, clientMessageId, mediaAssetId, resolvedType, durationMs);

    const optimistic: Message = {
      id: clientMessageId,
      client_message_id: clientMessageId,
      conversation_id: conversationId,
      sender_user_id: currentUserId,
      sender_id: currentUserId,
      body: content,
      content,
      message_type: resolvedType,
      media_asset_id: mediaAssetId,
      audio_duration_ms: durationMs,
      status: 'SENT',
      created_at: new Date().toISOString(),
    };

    if (wsSent) {
      return optimistic;
    }

    // REST fallback
    const res = await api.post<any>(`/api/v1/conversations/${conversationId}/messages`, {
      client_message_id: clientMessageId,
      body: content,
      message_type: resolvedType,
      media_asset_id: mediaAssetId,
      duration_ms: durationMs,
      audio_duration_ms: durationMs,
    });
    return normalizeMessage({
      ...res,
      audio_duration_ms: durationMs || res.audio_duration_ms,
    });
  },

  /**
   * Fetches incoming pending message requests
   */
  async getMessageRequests(): Promise<MessageRequest[]> {
    const res = await api.get<{ requests: any[] }>('/api/v1/message-requests');
    return (res.requests || []).map(normalizeMessageRequest);
  },

  /**
   * Accepts a message request, establishing a match & conversation
   */
  async acceptMessageRequest(requestId: string): Promise<{ success: boolean; conversation_id?: string; match_id?: string }> {
    return api.post<{ success: boolean; conversation_id?: string; match_id?: string }>(`/api/v1/message-requests/${requestId}/accept`);
  },

  /**
   * Declines a message request
   */
  async declineMessageRequest(requestId: string): Promise<{ success: boolean }> {
    return api.post<{ success: boolean }>(`/api/v1/message-requests/${requestId}/decline`);
  },

  /**
   * Blocks the sender of a message request
   */
  async blockMessageRequest(requestId: string): Promise<{ success: boolean }> {
    return api.post<{ success: boolean }>(`/api/v1/message-requests/${requestId}/block`);
  },

  /**
   * Sets current authenticated user ID for outgoing message detection
   */
  setCurrentUserId(userId: string | null): void {
    currentAuthUserId = userId;
  },

  /**
   * Sets the currently open/active chat room.
   * Incoming messages for this conversation are immediately marked as read and do not increment unread badge.
   */
  setActiveConversation(conversationId: string | null): void {
    activeConversationId = conversationId;
    if (conversationId) {
      const resolvedId = matchToConvMap.get(conversationId) || conversationId;
      conversationUnreadCounts.set(resolvedId, 0);
      conversationUnreadCounts.set(conversationId, 0);
      notifyUnread(resolvedId);
    }
  },

  /**
   * Returns current active conversation ID
   */
  getActiveConversation(): string | null {
    return activeConversationId;
  },

  /**
   * Marks a conversation's incoming messages as read, clearing unread badge and informing the server
   */
  async markConversationAsRead(conversationId: string): Promise<boolean> {
    if (!conversationId) return false;

    const resolvedId = matchToConvMap.get(conversationId) || conversationId;

    // Immediately update local in-memory unread state for instant UI responsiveness
    conversationUnreadCounts.set(resolvedId, 0);
    conversationUnreadCounts.set(conversationId, 0);
    notifyUnread(resolvedId);

    // 1. Send WebSocket read receipt
    chatWebSocket.sendReadReceipt(resolvedId);

    // 2. Call REST mark-read endpoint for persistent database update & REST fallback
    try {
      await api.post(`/api/v1/conversations/${encodeURIComponent(resolvedId)}/read`);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Returns the unread incoming message count for a specific conversation
   */
  getConversationUnreadCount(conversationId: string): number {
    const resolvedId = matchToConvMap.get(conversationId) || conversationId;
    return conversationUnreadCounts.get(resolvedId) ?? conversationUnreadCounts.get(conversationId) ?? 0;
  },

  /**
   * Returns the sum of unread incoming messages across unique conversations
   */
  getTotalUnreadCount(): number {
    const processedIds = new Set<string>();
    let total = 0;

    for (const [id, count] of conversationUnreadCounts.entries()) {
      const canonicalId = matchToConvMap.get(id) || id;
      if (!processedIds.has(canonicalId)) {
        processedIds.add(canonicalId);
        if (count > 0) total += count;
      }
    }
    return total;
  },

  /**
   * Subscribes to unread count updates across conversations
   */
  onUnreadCountChange(listener: (totalUnread: number, conversationId?: string) => void): () => void {
    unreadListeners.add(listener);
    // Notify listener with current total immediately
    listener(this.getTotalUnreadCount());
    return () => {
      unreadListeners.delete(listener);
    };
  },

  /**
   * Processes an incoming message event to increment unread counts if applicable:
   * 1. Never counts messages sent by the current user
   * 2. Ignores messages already marked as read
   * 3. Ignores duplicate events (by message ID)
   * 4. If conversation is currently open, marks as read immediately without incrementing badge
   * 5. Otherwise increments the conversation unread count by 1
   */
  handleIncomingMessageUnread(msg: Message, currentUserId?: string): boolean {
    if (!msg || !msg.conversation_id) return false;

    const myId = currentUserId || currentAuthUserId;

    // 1. Never count messages sent by current user as unread
    const isMe =
      (myId && (msg.sender_user_id === myId || msg.sender_id === myId)) ||
      msg.sender_user_id === 'me' ||
      msg.sender_id === 'me';
    if (isMe) return false;

    // 2. Do not increment for messages already marked as read
    const isRead = Boolean(msg.read_at) || msg.status === 'READ';
    if (isRead) return false;

    // 3. Do not increment for duplicate message events
    const msgId = msg.id || msg.client_message_id;
    if (msgId) {
      if (seenMessageIds.has(msgId)) return false;
      seenMessageIds.add(msgId);
    }

    // 4. If user is currently looking at this conversation, mark as read immediately without incrementing
    const resolvedId = matchToConvMap.get(msg.conversation_id) || msg.conversation_id;
    if (activeConversationId === resolvedId || activeConversationId === msg.conversation_id) {
      chatWebSocket.sendReadReceipt(resolvedId, msg.id);
      return false;
    }

    // 5. Increment conversation unread count by 1
    const current = this.getConversationUnreadCount(resolvedId);
    conversationUnreadCounts.set(resolvedId, current + 1);
    conversationUnreadCounts.set(msg.conversation_id, current + 1);
    notifyUnread(resolvedId);
    return true;
  },

  /**
   * Re-syncs unread counts from server
   */
  async refreshUnreadCount(): Promise<number> {
    try {
      await this.getConversations();
    } catch {
      // Offline fallback
    }
    return this.getTotalUnreadCount();
  },

  /**
   * Resets local unread tracking state (e.g. for testing or logout)
   */
  resetUnreadState(): void {
    conversationUnreadCounts.clear();
    matchToConvMap.clear();
    seenMessageIds.clear();
    activeConversationId = null;
    notifyUnread();
  },
};

// Real-time unread synchronization: listen to WebSocket message events
chatWebSocket.onMessage((msg) => {
  chatService.handleIncomingMessageUnread(msg);
});
