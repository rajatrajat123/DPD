'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Conversation,
  Message,
  getConversationMessages,
  sendChatMessage,
  markConversationRead,
} from '@/lib/api/chat';
import { unmatch, blockUser } from '@/lib/api/discovery';

interface ChatRoomProps {
  conversation: Conversation;
  onBack?: () => void;
  onConversationUpdated?: () => void;
}

export function ChatRoom({
  conversation,
  onBack,
  onConversationUpdated,
}: ChatRoomProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const typingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const partner = conversation.partner;
  const partnerName = partner?.display_name || 'Match';
  const partnerPhoto = partner?.avatar_url || '';
  const [photoError, setPhotoError] = useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 1. Fetch historical messages & mark read
  const loadMessages = useCallback(async () => {
    try {
      const page = await getConversationMessages(conversation.id);
      setMessages(page.messages || []);
      await markConversationRead(conversation.id);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setTimeout(scrollToBottom, 100);
    }
  }, [conversation.id]);

  useEffect(() => {
    setLoading(true);
    loadMessages();
  }, [loadMessages]);

  // 2. Establish Real-Time WebSocket Connection with fallback
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/v1/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'message.new') {
            const newMsg: Message = data.payload;
            if (newMsg.conversation_id === conversation.id) {
              setMessages((prev) => {
                // Deduplicate by id or client_message_id
                if (prev.some((m) => m.id === newMsg.id || m.client_message_id === newMsg.client_message_id)) {
                  return prev;
                }
                return [...prev, newMsg];
              });
              markConversationRead(conversation.id);
              scrollToBottom();
            }
          } else if (data.type === 'typing.indicator') {
            if (data.payload?.conversation_id === conversation.id) {
              setPartnerTyping(Boolean(data.payload?.is_typing));
            }
          } else if (data.type === 'message.read') {
            if (data.payload?.conversation_id === conversation.id) {
              setMessages((prev) =>
                prev.map((m) => ({ ...m, read_at: m.read_at || new Date().toISOString() }))
              );
            }
          } else if (data.type === 'message.delivered') {
            if (data.payload?.message_id) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === data.payload.message_id
                    ? { ...m, delivered_at: data.payload.delivered_at }
                    : m
                )
              );
            }
          }
        } catch {
          // ignore malformed frame
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
      };

      ws.onerror = () => {
        setWsConnected(false);
      };
    } catch {
      setWsConnected(false);
    }

    // Fallback polling every 3 seconds if WebSocket is disconnected
    const pollInterval = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        getConversationMessages(conversation.id)
          .then((page) => {
            if (page.messages) {
              setMessages(page.messages);
            }
          })
          .catch(() => {});
      }
    }, 3000);

    return () => {
      clearInterval(pollInterval);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [conversation.id]);

  // 3. Handle sending a message
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    const clientMsgId = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    try {
      // If WebSocket is open, send via WebSocket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            action: 'message.send',
            conversation_id: conversation.id,
            client_message_id: clientMsgId,
            body: trimmed,
          })
        );
      }

      // Always call durable REST endpoint for guaranteed persistence & response
      const savedMsg = await sendChatMessage(conversation.id, {
        client_message_id: clientMsgId,
        body: trimmed,
      });

      setMessages((prev) => {
        if (prev.some((m) => m.id === savedMsg.id || m.client_message_id === clientMsgId)) {
          return prev;
        }
        return [...prev, savedMsg];
      });

      setText('');
      scrollToBottom();
      if (onConversationUpdated) onConversationUpdated();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  // 4. Typing indicator debounce
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'typing.start',
          conversation_id: conversation.id,
        })
      );

      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              action: 'typing.stop',
              conversation_id: conversation.id,
            })
          );
        }
      }, 2000);
    }
  };

  const handleUnmatch = async () => {
    if (!confirm(`Are you sure you want to unmatch ${partnerName}?`)) return;
    try {
      await unmatch(conversation.match_id);
      if (onBack) onBack();
    } catch {
      alert('Failed to unmatch');
    }
  };

  const handleBlock = async () => {
    if (!confirm(`Are you sure you want to block ${partnerName}? This is permanent and bilateral.`)) return;
    try {
      await blockUser(partner?.user_id || '', 'Initiated from chat room safety controls');
      if (onBack) onBack();
    } catch {
      alert('Failed to block user');
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--aura-charcoal-deep)',
        borderRadius: '14px',
        border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
      }}
    >
      {/* Chat Header */}
      <div
        style={{
          padding: '0.85rem 1.25rem',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(21, 21, 21, 0.75)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          {onBack && (
            <button
              onClick={onBack}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--aura-taupe)',
                cursor: 'pointer',
                fontSize: '1.25rem',
                padding: '0.2rem',
              }}
              title="Back to conversation list"
            >
              ←
            </button>
          )}

          <div style={{ position: 'relative', width: '42px', height: '42px', flexShrink: 0 }}>
            {partnerPhoto && !photoError ? (
              <img
                src={partnerPhoto}
                alt={partnerName}
                onError={() => setPhotoError(true)}
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '1px solid var(--border-gold)',
                }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: '50%',
                  backgroundColor: 'var(--aura-charcoal)',
                  border: '1px solid var(--border-gold)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--aura-gold)',
                  fontWeight: 700,
                  fontSize: '1.1rem',
                  fontFamily: 'var(--font-serif)',
                }}
              >
                {partnerName ? partnerName.charAt(0).toUpperCase() : 'M'}
              </div>
            )}
            {partner?.is_online && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '0',
                  right: '0',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: '#10b981',
                  border: '2px solid var(--aura-charcoal-deep)',
                }}
              />
            )}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span style={{ fontWeight: 700, fontSize: '1rem', fontFamily: 'var(--font-serif)', color: 'var(--aura-ivory)' }}>
                {partnerName}
                {partner?.age ? `, ${partner.age}` : ''}
              </span>
              {partner?.is_photo_verified && (
                <span className="badge-gold" style={{ fontSize: '0.62rem', padding: '0.1rem 0.35rem' }}>
                  ✓
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--aura-taupe)' }}>
              {partnerTyping ? (
                <span style={{ color: 'var(--aura-gold)', fontWeight: 600 }}>typing...</span>
              ) : partner?.is_online ? (
                <span style={{ color: '#34d399' }}>● Online</span>
              ) : (
                <span>Offline</span>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {!wsConnected && (
            <span
              style={{
                fontSize: '0.7rem',
                color: 'var(--aura-gold)',
                background: 'var(--aura-gold-dim)',
                border: '1px solid var(--border-gold)',
                padding: '0.15rem 0.5rem',
                borderRadius: '4px',
              }}
              title="Real-time REST synchronization fallback"
            >
              🔄 Polling
            </span>
          )}

          <button
            onClick={() => setShowSafetyModal(!showSafetyModal)}
            className="btn-secondary"
            style={{
              padding: '0.35rem 0.7rem',
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
            title="Safety Options"
          >
            🛡️ Safety
          </button>
        </div>
      </div>

      {/* Safety Dropdown Menu */}
      {showSafetyModal && (
        <div
          style={{
            padding: '0.75rem 1.25rem',
            background: 'var(--aura-charcoal)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
          }}
        >
          <button
            onClick={handleUnmatch}
            className="btn-secondary"
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
          >
            Unmatch
          </button>
          <button
            onClick={handleBlock}
            style={{
              background: 'var(--aura-oxblood)',
              border: 'none',
              color: 'white',
              borderRadius: '6px',
              padding: '0.35rem 0.75rem',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Block &amp; Report
          </button>
        </div>
      )}

      {/* Message Stream */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--aura-taupe)', padding: '2rem' }}>
            Loading encrypted conversation...
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--aura-taupe)', margin: 'auto', padding: '2rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>👋</div>
            <p style={{ fontSize: '0.92rem', color: 'var(--aura-parchment)' }}>
              Send an intentional message to break the ice with {partnerName}!
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isMe = m.sender_user_id !== partner?.user_id;
            const timeStr = new Date(m.created_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={m.id || m.client_message_id}
                style={{
                  display: 'flex',
                  justifyContent: isMe ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '75%',
                    padding: '0.75rem 1rem',
                    borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: isMe
                      ? 'linear-gradient(135deg, var(--aura-gold), #b3914a)'
                      : 'var(--aura-charcoal)',
                    color: isMe ? 'var(--aura-black)' : 'var(--aura-ivory)',
                    border: isMe ? 'none' : '1px solid var(--border-subtle)',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
                  }}
                >
                  <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.45, wordBreak: 'break-word', fontWeight: isMe ? 500 : 400 }}>
                    {m.body}
                  </p>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      gap: '0.35rem',
                      marginTop: '0.25rem',
                      fontSize: '0.68rem',
                      color: isMe ? 'rgba(21, 21, 21, 0.75)' : 'var(--aura-taupe)',
                    }}
                  >
                    <span>{timeStr}</span>
                    {isMe && (
                      <span>
                        {m.read_at ? '✓✓' : m.delivered_at ? '✓✓' : '✓'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Composer */}
      <form
        onSubmit={handleSend}
        style={{
          padding: '0.85rem 1rem',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          gap: '0.75rem',
          background: 'rgba(21, 21, 21, 0.75)',
        }}
      >
        <input
          type="text"
          value={text}
          onChange={handleInputChange}
          placeholder={`Message ${partnerName}...`}
          className="form-input"
          style={{
            flex: 1,
            borderRadius: '24px',
            padding: '0.65rem 1.15rem',
            fontSize: '0.9rem',
          }}
          disabled={sending}
        />

        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="btn-gold"
          style={{
            borderRadius: '24px',
            padding: '0.65rem 1.4rem',
            fontSize: '0.88rem',
            cursor: sending || !text.trim() ? 'not-allowed' : 'pointer',
            opacity: sending || !text.trim() ? 0.5 : 1,
          }}
        >
          {sending ? '...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
