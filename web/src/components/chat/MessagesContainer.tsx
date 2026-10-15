'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Conversation, getConversations } from '@/lib/api/chat';
import { ConversationList } from './ConversationList';
import { ChatRoom } from './ChatRoom';

export function MessagesContainer() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    try {
      const data = await getConversations();
      setConversations(data.conversations || []);
      // If none selected, default to first conversation on larger screens
      if (!selectedConv && data.conversations && data.conversations.length > 0) {
        if (typeof window !== 'undefined' && window.innerWidth >= 768) {
          setSelectedConv(data.conversations[0]);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selectedConv]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: selectedConv ? '340px 1fr' : '1fr',
        gap: '1rem',
        height: 'calc(100vh - 120px)',
        maxHeight: '800px',
        maxWidth: '1200px',
        margin: '0 auto',
      }}
    >
      {/* Left Pane: Conversation List */}
      <div
        style={{
          display: selectedConv && typeof window !== 'undefined' && window.innerWidth < 768 ? 'none' : 'block',
          height: '100%',
        }}
      >
        <ConversationList
          conversations={conversations}
          selectedId={selectedConv?.id}
          onSelect={(c) => setSelectedConv(c)}
          loading={loading}
        />
      </div>

      {/* Right Pane: Active Chat Room or Luxury Placeholder */}
      <div style={{ height: '100%' }}>
        {selectedConv ? (
          <ChatRoom
            conversation={selectedConv}
            onBack={() => setSelectedConv(null)}
            onConversationUpdated={fetchConversations}
          />
        ) : (
          <div
            style={{
              height: '100%',
              background: 'var(--aura-charcoal-deep)',
              borderRadius: '14px',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--aura-taupe)',
              padding: '2.5rem',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1.25rem' }}>💬</div>
            <h3 style={{ fontSize: '1.35rem', color: 'var(--aura-ivory)', fontFamily: 'var(--font-serif)', marginBottom: '0.6rem' }}>
              Your Private Conversations
            </h3>
            <p style={{ fontSize: '0.92rem', maxWidth: '380px', color: 'var(--aura-taupe)', lineHeight: 1.5 }}>
              Select a mutual connection from the left to start sending real-time messages, or explore new candidates in Discovery.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
