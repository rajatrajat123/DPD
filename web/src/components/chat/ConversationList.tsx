'use client';

import React, { useState } from 'react';
import { Conversation } from '@/lib/api/chat';

interface ConversationListProps {
  conversations: Conversation[];
  selectedId?: string;
  onSelect: (conv: Conversation) => void;
  loading?: boolean;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  loading,
}: ConversationListProps) {
  const [search, setSearch] = useState('');

  const filtered = conversations.filter((c) => {
    const name = c.partner?.display_name?.toLowerCase() || '';
    return name.includes(search.toLowerCase());
  });

  if (loading) {
    return (
      <div style={{ padding: '2rem 1.5rem', textAlign: 'center', color: 'var(--aura-taupe)' }}>
        Loading conversations...
      </div>
    );
  }

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
      {/* Header & Search */}
      <div style={{ padding: '1.25rem 1rem', borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-serif)', color: 'var(--aura-ivory)', marginBottom: '0.75rem' }}>
          Messages
        </h2>
        <input
          type="text"
          placeholder="Search matches..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="form-input"
          style={{ padding: '0.5rem 0.85rem', fontSize: '0.85rem' }}
        />
      </div>

      {/* List items */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--aura-taupe)', fontSize: '0.86rem' }}>
            {search ? 'No matches found' : 'No conversations yet. Connect with members in Discovery to start chatting!'}
          </div>
        ) : (
          filtered.map((c) => {
            const isSelected = c.id === selectedId;
            const partner = c.partner;
            const photoUrl =
              partner?.avatar_url ||
              'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=160&h=160&fit=crop';
            const displayName = partner?.display_name || 'Match';
            const lastMsg = c.last_message;

            return (
              <div
                key={c.id}
                onClick={() => onSelect(c)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.85rem',
                  padding: '0.85rem 1rem',
                  cursor: 'pointer',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                  background: isSelected ? 'var(--aura-gold-dim)' : 'transparent',
                  borderLeft: isSelected ? '3px solid var(--aura-gold)' : '3px solid transparent',
                  transition: 'background 0.15s ease',
                }}
              >
                {/* Avatar with Online Badge */}
                <div style={{ position: 'relative', width: '48px', height: '48px', flexShrink: 0 }}>
                  <img
                    src={photoUrl}
                    alt={displayName}
                    style={{
                      width: '100%',
                      height: '100%',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: isSelected ? '2px solid var(--aura-gold)' : '1px solid var(--border-subtle)',
                    }}
                  />
                  {partner?.is_online && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '1px',
                        right: '1px',
                        width: '11px',
                        height: '11px',
                        borderRadius: '50%',
                        background: '#10b981',
                        border: '2px solid var(--aura-charcoal-deep)',
                      }}
                      title="Online now"
                    />
                  )}
                </div>

                {/* Details */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span
                        style={{
                          fontWeight: isSelected || c.unread_count > 0 ? 700 : 500,
                          fontSize: '0.92rem',
                          color: isSelected ? 'var(--aura-gold)' : 'var(--aura-ivory)',
                        }}
                      >
                        {displayName}
                      </span>
                      {partner?.is_photo_verified && (
                        <span style={{ fontSize: '0.65rem', color: 'var(--aura-gold)' }}>✓</span>
                      )}
                    </div>
                    {lastMsg && (
                      <span style={{ fontSize: '0.7rem', color: 'var(--aura-taupe)' }}>
                        {new Date(lastMsg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p
                      style={{
                        fontSize: '0.8rem',
                        color: c.unread_count > 0 ? 'var(--aura-ivory)' : 'var(--aura-taupe)',
                        fontWeight: c.unread_count > 0 ? 600 : 400,
                        margin: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '160px',
                      }}
                    >
                      {lastMsg ? lastMsg.body : 'Start a connection...'}
                    </p>

                    {c.unread_count > 0 && (
                      <span
                        className="badge-gold"
                        style={{
                          borderRadius: '9999px',
                          padding: '0.1rem 0.45rem',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                        }}
                      >
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
