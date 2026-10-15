'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  DiscoveryCandidate,
  SwipeDirection,
  SwipeResponse,
  MatchingSummaryResponse,
  getDiscoveryFeed,
  getMatchingSummary,
  submitSwipe,
  blockUser,
} from '@/lib/api/discovery';

export function DiscoveryDeck() {
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [swiping, setSwiping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Matching nearby summary with small-number privacy floor
  const [matchingSummary, setMatchingSummary] = useState<MatchingSummaryResponse | null>(null);
  const [emptyStateReason, setEmptyStateReason] = useState<string | null>(null);

  // Match celebration state
  const [matchedCandidate, setMatchedCandidate] = useState<DiscoveryCandidate | null>(null);
  const [matchReward, setMatchReward] = useState<string | null>(null);
  const [showMatchModal, setShowMatchModal] = useState(false);

  // Block & Report modal state
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockReason, setBlockReason] = useState('Inappropriate behavior or profile');

  // Daily swipes tracker
  const [dailySwipes, setDailySwipes] = useState<number | null>(null);

  // Fetch feed and summary on mount
  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [feedData, summaryData] = await Promise.all([
        getDiscoveryFeed(20),
        getMatchingSummary().catch(() => null),
      ]);
      setCandidates(feedData.candidates || []);
      setEmptyStateReason(feedData.empty_state_reason || null);
      if (summaryData) {
        setMatchingSummary(summaryData);
      }
      setCurrentIndex(0);
      setPhotoIndex(0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load discovery feed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const currentCandidate = candidates[currentIndex];

  const handleSwipe = async (direction: SwipeDirection) => {
    if (!currentCandidate || swiping) return;

    setSwiping(true);
    try {
      const res: SwipeResponse = await submitSwipe({
        target_user_id: currentCandidate.user_id,
        direction,
      });

      if (res.daily_swipes_remaining !== undefined) {
        setDailySwipes(res.daily_swipes_remaining);
      }

      if (res.matched) {
        setMatchedCandidate(currentCandidate);
        setMatchReward(res.unlimited_swipes_granted ? '🎉 24-Hour Unlimited Swipes Unlocked!' : null);
        setShowMatchModal(true);
      }

      // Move to next candidate
      setCurrentIndex((prev) => prev + 1);
      setPhotoIndex(0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error submitting swipe');
    } finally {
      setSwiping(false);
    }
  };

  const handleBlock = async () => {
    if (!currentCandidate) return;
    try {
      await blockUser(currentCandidate.user_id, blockReason);
      setShowBlockModal(false);
      // Remove candidate immediately
      setCurrentIndex((prev) => prev + 1);
      setPhotoIndex(0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to block user');
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showMatchModal || showBlockModal || !currentCandidate || swiping) return;
      if (e.key === 'ArrowLeft') {
        handleSwipe('PASS');
      } else if (e.key === 'ArrowRight') {
        handleSwipe('LIKE');
      } else if (e.key === 'ArrowUp') {
        handleSwipe('SUPER_SPARK');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showMatchModal, showBlockModal, currentCandidate, swiping]);

  if (loading) {
    return (
      <div style={{ maxWidth: '440px', margin: '3rem auto', textAlign: 'center' }}>
        <div
          style={{
            height: '560px',
            borderRadius: '16px',
            background: 'var(--aura-charcoal)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: '1.25rem',
          }}
        >
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              border: '3px solid var(--border-gold)',
              borderTopColor: 'var(--aura-gold)',
              animation: 'spin 1s linear infinite',
            }}
          />
          <p style={{ color: 'var(--aura-taupe)', fontSize: '0.92rem' }}>
            Curating verified queer members matching your dealbreakers...
          </p>
        </div>
      </div>
    );
  }

  // All candidates reviewed or dealbreakers filtered out all candidates
  if (!currentCandidate || currentIndex >= candidates.length) {
    const isDealbreakerExcluded = emptyStateReason === 'DEALBREAKERS_EXCLUDED_ALL';

    return (
      <div style={{ maxWidth: '480px', margin: '3rem auto', textAlign: 'center' }}>
        <div className="card" style={{ padding: '3rem 2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>
            {isDealbreakerExcluded ? '⚖️' : '✨'}
          </div>
          <h2 style={{ fontSize: '1.4rem', marginBottom: '0.75rem', color: isDealbreakerExcluded ? 'var(--aura-gold)' : 'var(--aura-ivory)' }}>
            {isDealbreakerExcluded ? 'Dealbreaker Integrity Active' : "You're All Caught Up!"}
          </h2>
          <p style={{ color: 'var(--aura-parchment)', fontSize: '0.92rem', lineHeight: 1.5, marginBottom: '2rem' }}>
            {isDealbreakerExcluded
              ? 'Your strict dealbreakers (such as non-smoker requirements or age boundaries) filtered out available profiles nearby. Aura guarantees zero silent broadening—your boundaries are always respected.'
              : 'There are no more candidates matching your filters right now. Expand your distance or check back soon as new verified members join!'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center' }}>
            <Link
              href="/app/profile"
              className="btn-gold"
              style={{ textDecoration: 'none', display: 'inline-block', width: '100%', maxWidth: '280px', textAlign: 'center' }}
            >
              Adjust Discovery Filters
            </Link>
            <button
              onClick={loadFeed}
              className="btn-secondary"
              style={{ width: '100%', maxWidth: '280px', cursor: 'pointer' }}
            >
              Check Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const photos = currentCandidate.photos || [];
  const currentPhoto = photos[photoIndex] || {
    card_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=640&h=800&fit=crop',
  };

  return (
    <div style={{ maxWidth: '440px', margin: '0.5rem auto 2rem auto', position: 'relative' }}>
      {/* Live Matching Summary with Privacy Floor Floor Protection */}
      {matchingSummary && (
        <div
          style={{
            background: 'var(--aura-charcoal-deep)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '0.55rem 0.85rem',
            marginBottom: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.82rem',
            color: 'var(--aura-parchment)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <span style={{ color: 'var(--aura-gold)' }}>✦</span>
            <span>{matchingSummary.display_text}</span>
          </div>
          {matchingSummary.privacy_floor_applied && (
            <span
              style={{
                fontSize: '0.7rem',
                color: 'var(--aura-taupe)',
                background: 'rgba(255, 255, 255, 0.05)',
                padding: '0.15rem 0.4rem',
                borderRadius: '4px',
                border: '1px solid var(--border-subtle)',
              }}
              title="Exact member counts under 5 are never revealed to prevent geographic deanonymization"
            >
              🛡️ Privacy Floor
            </span>
          )}
        </div>
      )}

      {/* Top Deck Status Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
          fontSize: '0.82rem',
          color: 'var(--aura-taupe)',
        }}
      >
        <span>
          Member {currentIndex + 1} of {candidates.length}
        </span>
        {dailySwipes !== null && <span>⚡ {dailySwipes} free sparks left</span>}
        <button
          onClick={() => setShowBlockModal(true)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--aura-taupe)',
            cursor: 'pointer',
            fontSize: '0.8rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
          }}
          title="Safety & Blocking"
        >
          🛡️ Report / Block
        </button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: '0.65rem',
            background: 'var(--aura-oxblood-dim)',
            border: '1px solid var(--aura-oxblood)',
            borderRadius: '6px',
            color: 'var(--aura-ivory)',
            fontSize: '0.82rem',
            marginBottom: '0.75rem',
            textAlign: 'center',
          }}
        >
          {error}
        </div>
      )}

      {/* Main Candidate Card */}
      <div
        style={{
          position: 'relative',
          borderRadius: '16px',
          overflow: 'hidden',
          background: 'var(--aura-charcoal-deep)',
          border: '1px solid var(--border-gold)',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
          minHeight: '580px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
        }}
      >
        {/* Photo Background */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: `url(${currentPhoto.card_url})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            zIndex: 1,
          }}
        />

        {/* Photo Navigation Touch Areas */}
        {photos.length > 1 && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: '180px',
              zIndex: 3,
              display: 'flex',
            }}
          >
            <div
              style={{ flex: 1, cursor: 'w-resize' }}
              onClick={() => setPhotoIndex((p) => Math.max(0, p - 1))}
              title="Previous photo"
            />
            <div
              style={{ flex: 1, cursor: 'e-resize' }}
              onClick={() => setPhotoIndex((p) => Math.min(photos.length - 1, p + 1))}
              title="Next photo"
            />
          </div>
        )}

        {/* Photo Indicators / Progress Dots */}
        {photos.length > 1 && (
          <div
            style={{
              position: 'absolute',
              top: '12px',
              left: '16px',
              right: '16px',
              display: 'flex',
              gap: '6px',
              zIndex: 4,
            }}
          >
            {photos.map((_, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: '4px',
                  borderRadius: '2px',
                  background: i === photoIndex ? 'var(--aura-gold)' : 'rgba(255, 255, 255, 0.35)',
                  transition: 'background 0.2s',
                }}
              />
            ))}
          </div>
        )}

        {/* Gradient Overlay for Readability */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'linear-gradient(to top, rgba(21, 21, 21, 0.98) 0%, rgba(21, 21, 21, 0.7) 45%, rgba(21, 21, 21, 0.15) 80%, rgba(21, 21, 21, 0.5) 100%)',
            zIndex: 2,
          }}
        />

        {/* Card Profile Info Content */}
        <div style={{ position: 'relative', zIndex: 4, padding: '1.5rem', color: 'var(--aura-ivory)' }}>
          {/* Header Line: Name, Age, Verification, Compatibility */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <h2 style={{ fontSize: '1.65rem', fontWeight: 700, margin: 0, fontFamily: 'var(--font-serif)' }}>
                {currentCandidate.display_name}, {currentCandidate.age}
              </h2>
              {currentCandidate.is_photo_verified && (
                <span className="badge-gold" title="Biometrically Verified Photo">
                  ✓ Verified
                </span>
              )}
            </div>

            {currentCandidate.compatibility_score > 0 && (
              <span className="badge-gold">
                {Math.round(currentCandidate.compatibility_score)}% Match
              </span>
            )}
          </div>

          {/* Privacy-Preserving Fuzzed Distance & Pronouns */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '0.75rem' }}>
            <span
              style={{
                fontSize: '0.78rem',
                color: 'var(--aura-parchment)',
                background: 'rgba(255, 255, 255, 0.12)',
                padding: '0.2rem 0.5rem',
                borderRadius: '6px',
              }}
            >
              📍 ~{currentCandidate.approximate_distance_km} km away
            </span>
            {currentCandidate.pronouns && currentCandidate.pronouns.length > 0 && (
              <span
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--aura-parchment)',
                  background: 'rgba(255, 255, 255, 0.12)',
                  padding: '0.2rem 0.5rem',
                  borderRadius: '6px',
                }}
              >
                {currentCandidate.pronouns.join('/')}
              </span>
            )}
            {currentCandidate.relationship_structure && (
              <span
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--aura-gold)',
                  background: 'var(--aura-charcoal-deep)',
                  border: '1px solid var(--border-gold)',
                  padding: '0.2rem 0.5rem',
                  borderRadius: '6px',
                }}
              >
                🔗 {currentCandidate.relationship_structure}
              </span>
            )}
          </div>

          {/* Identities & Orientations Badges */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.75rem' }}>
            {currentCandidate.gender_identities?.map((g) => (
              <span key={g} className="badge-taupe">
                {g}
              </span>
            ))}
            {currentCandidate.sexual_orientations?.map((s) => (
              <span key={s} className="badge-taupe">
                {s}
              </span>
            ))}
            {currentCandidate.relationship_intents?.map((intent) => (
              <span
                key={intent}
                style={{
                  fontSize: '0.72rem',
                  background: 'var(--aura-gold-dim)',
                  border: '1px solid var(--border-gold)',
                  padding: '0.15rem 0.45rem',
                  borderRadius: '4px',
                  color: 'var(--aura-gold)',
                }}
              >
                🎯 {intent}
              </span>
            ))}
          </div>

          {/* Bio Text */}
          {currentCandidate.bio && (
            <p
              style={{
                fontSize: '0.88rem',
                lineHeight: 1.45,
                color: 'var(--aura-parchment)',
                marginBottom: '0.5rem',
                maxHeight: '4.5rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {currentCandidate.bio}
            </p>
          )}
        </div>
      </div>

      {/* Swipe Action Controls */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '1.25rem',
          marginTop: '1.25rem',
        }}
      >
        {/* Pass Button */}
        <button
          onClick={() => handleSwipe('PASS')}
          disabled={swiping}
          aria-label="Pass candidate"
          style={{
            width: '58px',
            height: '58px',
            borderRadius: '50%',
            background: 'var(--aura-charcoal-deep)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--aura-taupe)',
            fontSize: '1.35rem',
            cursor: swiping ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s ease',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--aura-oxblood)';
            e.currentTarget.style.color = '#e07a7a';
            e.currentTarget.style.transform = 'scale(1.06)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-subtle)';
            e.currentTarget.style.color = 'var(--aura-taupe)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          ✕
        </button>

        {/* Super Spark Button */}
        <button
          onClick={() => handleSwipe('SUPER_SPARK')}
          disabled={swiping}
          aria-label="Super spark candidate"
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            background: 'var(--aura-charcoal-deep)',
            border: '1px solid var(--border-gold)',
            color: 'var(--aura-gold)',
            fontSize: '1.35rem',
            cursor: swiping ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s ease',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.08)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          ⭐
        </button>

        {/* Like Button */}
        <button
          onClick={() => handleSwipe('LIKE')}
          disabled={swiping}
          aria-label="Like candidate"
          style={{
            width: '66px',
            height: '66px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--aura-gold), #d8b875)',
            border: 'none',
            color: 'var(--aura-black)',
            fontSize: '1.75rem',
            cursor: swiping ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            boxShadow: '0 6px 20px rgba(195, 161, 91, 0.35)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.06)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          💖
        </button>
      </div>

      {/* Keyboard Shortcut Indicator */}
      <div
        style={{
          textAlign: 'center',
          marginTop: '1rem',
          fontSize: '0.75rem',
          color: 'var(--aura-taupe)',
        }}
      >
        Keyboard shortcuts: <strong>←</strong> Pass &nbsp;|&nbsp; <strong>↑</strong> Super Spark &nbsp;|&nbsp; <strong>→</strong> Like
      </div>

      {/* Mutual Match Celebration Modal */}
      {showMatchModal && matchedCandidate && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.88)',
            backdropFilter: 'blur(10px)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: '400px',
              width: '100%',
              textAlign: 'center',
              border: '2px solid var(--aura-gold)',
              boxShadow: '0 0 50px rgba(195, 161, 91, 0.4)',
              position: 'relative',
              padding: '2.5rem 1.75rem',
            }}
          >
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>✨💖✨</div>
            <h2
              style={{
                fontSize: '1.9rem',
                fontWeight: 700,
                marginBottom: '0.5rem',
                fontFamily: 'var(--font-serif)',
                color: 'var(--aura-gold)',
              }}
            >
              It&apos;s a Mutual Match!
            </h2>
            <p style={{ color: 'var(--aura-parchment)', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
              You and <strong>{matchedCandidate.display_name}</strong> both sparked mutual interest!
            </p>

            {/* Matched Avatar */}
            <div
              style={{
                width: '120px',
                height: '120px',
                borderRadius: '50%',
                margin: '0 auto 1.5rem',
                overflow: 'hidden',
                border: '3px solid var(--aura-gold)',
                boxShadow: '0 8px 24px rgba(195, 161, 91, 0.3)',
              }}
            >
              <img
                src={matchedCandidate.photos?.[0]?.card_url || ''}
                alt={matchedCandidate.display_name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>

            {/* Unlimited Swipes Reward Banner */}
            {matchReward && (
              <div
                style={{
                  background: 'var(--aura-gold-dim)',
                  border: '1px solid var(--border-gold)',
                  color: 'var(--aura-gold)',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  marginBottom: '1.5rem',
                }}
              >
                {matchReward}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <Link
                href="/app/matches"
                className="btn-gold"
                style={{ display: 'block', textDecoration: 'none', textAlign: 'center' }}
              >
                Open Matches &amp; Chat
              </Link>
              <button
                onClick={() => setShowMatchModal(false)}
                className="btn-secondary"
                style={{ cursor: 'pointer' }}
              >
                Keep Exploring
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Safety & Blocking Modal */}
      {showBlockModal && currentCandidate && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(8px)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
          }}
        >
          <div className="card" style={{ maxWidth: '420px', width: '100%', padding: '1.75rem' }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: '#f87171' }}>
              Block &amp; Report {currentCandidate.display_name}?
            </h3>
            <p style={{ color: 'var(--aura-taupe)', fontSize: '0.86rem', lineHeight: 1.45, marginBottom: '1.25rem' }}>
              Blocking is bilateral and irreversible. They will never see your profile, and you will not see theirs in discovery or matches.
            </p>

            <label htmlFor="blockReasonSelect" className="form-label">
              Reason for reporting:
            </label>
            <select
              id="blockReasonSelect"
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              className="form-select"
              style={{ marginBottom: '1.5rem' }}
            >
              <option value="Inappropriate behavior or profile">Inappropriate behavior or profile</option>
              <option value="Suspected underage account (18+ policy)">Suspected underage account (18+ policy)</option>
              <option value="Harassment, hate speech or biphobia/transphobia">Harassment, hate speech or hate symbols</option>
              <option value="Spam, bot, or commercial solicitation">Spam, bot, or commercial solicitation</option>
              <option value="Photo impersonation / fake profile">Photo impersonation / fake profile</option>
            </select>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={handleBlock}
                style={{
                  flex: 1,
                  background: 'var(--aura-oxblood)',
                  color: 'white',
                  border: 'none',
                  padding: '0.65rem',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '0.88rem',
                }}
              >
                Confirm Block
              </button>
              <button
                onClick={() => setShowBlockModal(false)}
                className="btn-secondary"
                style={{ flex: 1, fontSize: '0.88rem' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
