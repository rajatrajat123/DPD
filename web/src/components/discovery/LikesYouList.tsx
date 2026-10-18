'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  IncomingLikeCard,
  LikesYouResponse,
  getLikesYou,
  revealLike,
} from '@/lib/api/discovery';

export function LikesYouList() {
  const [data, setData] = useState<LikesYouResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealingUserId, setRevealingUserId] = useState<string | null>(null);

  const loadLikes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await getLikesYou(30, 0);
      setData(resp);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load incoming likes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLikes();
  }, [loadLikes]);

  const handleReveal = async (targetUserId: string) => {
    setRevealingUserId(targetUserId);
    setError(null);
    try {
      const res = await revealLike(targetUserId);
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          revealed_count: prev.revealed_count + 1,
          unrevealed_count: Math.max(0, prev.unrevealed_count - 1),
          likes: prev.likes.map((like) => (like.user_id === targetUserId ? res.card : like)),
        };
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reveal profile');
    } finally {
      setRevealingUserId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--aura-taupe)' }}>
        <div
          style={{
            width: '40px',
            height: '40px',
            margin: '0 auto 1rem',
            borderRadius: '50%',
            border: '3px solid var(--border-gold)',
            borderTopColor: 'var(--aura-gold)',
            animation: 'spin 1s linear infinite',
          }}
        />
        <p>Loading members who like you...</p>
      </div>
    );
  }

  const likes = data?.likes || [];
  const total = data?.total_likes || 0;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      {/* Header and Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, fontFamily: 'var(--font-serif)', margin: '0 0 0.35rem 0', color: 'var(--aura-ivory)' }}>
            Likes You
          </h1>
          <p style={{ color: 'var(--aura-taupe)', fontSize: '0.9rem', margin: 0 }}>
            {total} {total === 1 ? 'member is interested in you' : 'members are interested in you'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Link
            href="/app/matches"
            className="btn-secondary"
            style={{ textDecoration: 'none', fontSize: '0.85rem', padding: '0.5rem 1rem' }}
          >
            Mutual Matches
          </Link>
          <Link
            href="/app/discovery"
            className="btn-gold"
            style={{ textDecoration: 'none', fontSize: '0.85rem', padding: '0.5rem 1rem' }}
          >
            ✨ Discovery Deck
          </Link>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: '0.75rem',
            background: 'var(--aura-oxblood-dim)',
            border: '1px solid var(--aura-oxblood)',
            borderRadius: '6px',
            color: 'var(--aura-ivory)',
            fontSize: '0.85rem',
            marginBottom: '1.25rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Empty State */}
      {likes.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3.5rem 1.5rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⭐</div>
          <h2 style={{ fontSize: '1.35rem', marginBottom: '0.5rem', fontFamily: 'var(--font-serif)', color: 'var(--aura-ivory)' }}>
            No Incoming Likes Yet
          </h2>
          <p style={{ color: 'var(--aura-taupe)', fontSize: '0.92rem', maxWidth: '420px', margin: '0 auto 1.75rem auto' }}>
            When someone likes or Super Likes your profile, they will appear here. Start swiping in Discovery to increase your visibility!
          </p>
          <Link href="/app/discovery" className="btn-gold" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Explore Discovery
          </Link>
        </div>
      ) : (
        /* Grid of Incoming Likes */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '1.25rem',
          }}
          data-testid="likes-you-grid"
        >
          {likes.map((like) => {
            const isSuperLike = like.is_super_like || like.interaction_type === 'SUPER_SPARK';
            const photoUrl =
              like.photos?.[0]?.card_url ||
              like.photos?.[0]?.thumb_url ||
              like.blurred_photo_url ||
              'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=640&h=800&fit=crop';

            return (
              <div
                key={like.user_id}
                data-testid={`incoming-like-${like.user_id}`}
                className="card"
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  borderRadius: '12px',
                  border: isSuperLike ? '2px solid var(--aura-gold)' : '1px solid var(--border-subtle)',
                  boxShadow: isSuperLike ? '0 4px 20px rgba(195, 161, 91, 0.25)' : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 0,
                  background: 'var(--aura-charcoal-deep)',
                }}
              >
                {/* Photo Header */}
                <div
                  style={{
                    height: '240px',
                    position: 'relative',
                    backgroundImage: `url(${photoUrl})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    filter: like.is_revealed ? 'none' : 'blur(12px)',
                    transform: like.is_revealed ? 'none' : 'scale(1.05)',
                  }}
                />

                {/* Badges Overlay */}
                <div
                  style={{
                    position: 'absolute',
                    top: '10px',
                    left: '10px',
                    right: '10px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    zIndex: 2,
                    pointerEvents: 'none',
                  }}
                >
                  {isSuperLike && (
                    <span
                      data-testid="incoming-super-like-badge"
                      style={{
                        background: 'linear-gradient(135deg, rgba(195, 161, 91, 0.95), rgba(216, 184, 117, 0.95))',
                        color: 'var(--aura-black)',
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        padding: '0.25rem 0.55rem',
                        borderRadius: '12px',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
                      }}
                    >
                      ⭐ Super Like
                    </span>
                  )}
                  {like.is_photo_verified && (
                    <span
                      className="badge-gold"
                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.45rem' }}
                    >
                      ✓ Verified
                    </span>
                  )}
                </div>

                {/* Card Info Content */}
                <div style={{ padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', zIndex: 3, background: 'var(--aura-charcoal-deep)' }}>
                  <div>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 600, margin: '0 0 0.35rem 0', color: 'var(--aura-ivory)', fontFamily: 'var(--font-serif)' }}>
                      {like.display_name}{like.is_revealed ? `, ${like.age}` : ''}
                    </h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--aura-taupe)', margin: '0 0 0.75rem 0' }}>
                      📍 ~{like.approximate_distance_km} km away
                    </p>
                    {like.bio && (
                      <p style={{ fontSize: '0.82rem', color: 'var(--aura-parchment)', margin: '0 0 0.75rem 0', lineHeight: 1.4, maxHeight: '3rem', overflow: 'hidden' }}>
                        {like.bio}
                      </p>
                    )}
                  </div>

                  {/* Action Button: Reveal or Like Back */}
                  <div style={{ marginTop: '0.5rem' }}>
                    {like.is_revealed ? (
                      <Link
                        href={`/app/discovery`}
                        className="btn-gold"
                        style={{
                          display: 'block',
                          textAlign: 'center',
                          textDecoration: 'none',
                          fontSize: '0.82rem',
                          padding: '0.45rem 0.75rem',
                          borderRadius: '6px',
                        }}
                      >
                        💖 View in Discovery
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleReveal(like.user_id)}
                        disabled={revealingUserId === like.user_id}
                        data-testid={`reveal-button-${like.user_id}`}
                        className="btn-secondary"
                        style={{
                          width: '100%',
                          fontSize: '0.82rem',
                          padding: '0.45rem 0.75rem',
                          cursor: revealingUserId === like.user_id ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {revealingUserId === like.user_id ? 'Revealing...' : '👁️ Reveal Profile'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
