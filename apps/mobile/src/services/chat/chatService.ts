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
    message_type: raw.message_type || 'TEXT',
    media_asset_id: raw.media_asset_id,
    media_url: raw.media_url,
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
    unread_count: raw.unread_count || 0,
    updated_at: raw.last_message_at || raw.created_at || new Date().toISOString(),
  };
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

  public sendMessage(conversationId: string, content: string, clientMessageId?: string, mediaAssetId?: string): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false; // Fall back to REST
    }

    const frame = {
      action: 'message.send',
      conversation_id: conversationId,
      client_message_id: clientMessageId || generateUUID(),
      body: content,
      message_type: 'TEXT',
      media_asset_id: mediaAssetId,
    };

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
  async getConversations(): Promise<Conversation[]> {
    const res = await api.get<{ conversations: any[] }>('/api/v1/conversations');
    return (res.conversations || []).map((c) => normalizeConversation(c));
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
  async sendMessage(conversationId: string, content: string, currentUserId = 'me', mediaAssetId?: string): Promise<Message> {
    const clientMessageId = generateUUID();
    const wsSent = chatWebSocket.sendMessage(conversationId, content, clientMessageId, mediaAssetId);

    const optimistic: Message = {
      id: clientMessageId,
      client_message_id: clientMessageId,
      conversation_id: conversationId,
      sender_user_id: currentUserId,
      sender_id: currentUserId,
      body: content,
      content,
      message_type: 'TEXT',
      media_asset_id: mediaAssetId,
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
      media_asset_id: mediaAssetId,
    });
    return normalizeMessage(res);
  },

  /**
   * Fetches incoming pending message requests
   */
  async getMessageRequests(): Promise<MessageRequest[]> {
    const res = await api.get<{ requests: MessageRequest[] }>('/api/v1/message-requests');
    return res.requests || [];
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
};
