'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  DiscoveryCandidate,
  SwipeDirection,
  SwipeResponse,
  MatchingSummaryResponse,
  FavouriteProfileCard,
  getDiscoveryFeed,
  getMatchingSummary,
  submitSwipe,
  blockUser,
  getFavourites,
  addFavourite,
  removeFavourite,
} from '@/lib/api/discovery';

export function DiscoveryDeck() {
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [swiping, setSwiping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Animation states for Super Like and standard cards
  const [animationPhase, setAnimationPhase] = useState<'idle' | 'lifting' | 'flying-up' | 'liking-right' | 'passing-left'>('idle');
  const [starPulse, setStarPulse] = useState(false);
  const [superLikeToast, setSuperLikeToast] = useState<string | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  // Check prefers-reduced-motion
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      setPrefersReducedMotion(mq.matches);
      const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mq.addEventListener('change', listener);
      return () => mq.removeEventListener('change', listener);
    }
  }, []);

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

  // Favourite profiles management state backed by authenticated API
  const [favourites, setFavourites] = useState<Record<string, FavouriteProfileCard>>({});
  const [showFavouritesModal, setShowFavouritesModal] = useState(false);
  const [lastSwipeDirection, setLastSwipeDirection] = useState<SwipeDirection | null>(null);

  // Load favourites from authenticated backend API on mount
  const loadFavourites = useCallback(async () => {
    try {
      const res = await getFavourites();
      const map: Record<string, FavouriteProfileCard> = {};
      if (res && res.favourites) {
        for (const fav of res.favourites) {
          map[fav.user_id] = fav;
        }
      }
      setFavourites(map);
    } catch {
      // Background non-blocking load
    }
  }, []);

  useEffect(() => {
    loadFavourites();
  }, [loadFavourites]);

  const toggleFavourite = async (candidate: DiscoveryCandidate) => {
    const isFav = Boolean(favourites[candidate.user_id]);
    const previous = { ...favourites };

    // Optimistic UI update
    if (isFav) {
      const next = { ...favourites };
      delete next[candidate.user_id];
      setFavourites(next);
      try {
        await removeFavourite(candidate.user_id);
      } catch (err: unknown) {
        // Rollback on API failure
        setFavourites(previous);
        setError(err instanceof Error ? err.message : 'Failed to remove from favourites');
      }
    } else {
      const newFav: FavouriteProfileCard = {
        user_id: candidate.user_id,
        display_name: candidate.display_name,
        age: candidate.age,
        bio: candidate.bio,
        photo_url: candidate.photos?.[0]?.card_url || candidate.photos?.[0]?.thumb_url || '',
        added_at: new Date().toISOString(),
      };
      setFavourites({ ...favourites, [candidate.user_id]: newFav });
      try {
        await addFavourite(candidate.user_id);
      } catch (err: unknown) {
        // Rollback on API failure
        setFavourites(previous);
        setError(err instanceof Error ? err.message : 'Failed to save to favourites');
      }
    }
  };

  const handleRemoveFavourite = async (userId: string) => {
    const previous = { ...favourites };
    const next = { ...favourites };
    delete next[userId];
    setFavourites(next);
    try {
      await removeFavourite(userId);
    } catch (err: unknown) {
      setFavourites(previous);
      setError(err instanceof Error ? err.message : 'Failed to remove favourite');
    }
  };

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
  const nextCandidate = candidates[currentIndex + 1];
  const isCurrentFavourite = Boolean(
    currentCandidate && (favourites[currentCandidate.user_id] || currentCandidate.is_favourite)
  );
  const favouriteList = Object.values(favourites);

  const handleSwipe = async (direction: SwipeDirection) => {
    if (!currentCandidate || swiping) return;

    setSwiping(true);
    setLastSwipeDirection(direction);
    setError(null);

    const startTime = Date.now();
    // Initial star and card feedback for Super Like
    if (direction === 'SUPER_SPARK') {
      setStarPulse(true);
      setTimeout(() => setStarPulse(false), 380);
      setAnimationPhase('lifting');
    }

    try {
      const res: SwipeResponse = await submitSwipe({
        target_user_id: currentCandidate.user_id,
        direction,
      });

      if (res.daily_swipes_remaining !== undefined) {
        setDailySwipes(res.daily_swipes_remaining);
      }

      // Ensure minimum in-flight duration so lifting is perceptible before exit starts
      if (direction === 'SUPER_SPARK' && !prefersReducedMotion) {
        const elapsed = Date.now() - startTime;
        if (elapsed < 280) {
          await new Promise((r) => setTimeout(r, 280 - elapsed));
        }
      }

      // Confirmed backend success: execute exit animation
      if (direction === 'SUPER_SPARK') {
        setAnimationPhase('flying-up');
      } else if (direction === 'LIKE') {
        setAnimationPhase('liking-right');
      } else {
        setAnimationPhase('passing-left');
      }

      const duration = prefersReducedMotion ? 100 : (direction === 'SUPER_SPARK' ? 420 : 320);
      await new Promise((r) => setTimeout(r, duration));

      if (res.matched) {
        setMatchedCandidate(currentCandidate);
        setMatchReward(res.unlimited_swipes_granted ? '🎉 24-Hour Unlimited Swipes Unlocked!' : null);
        setShowMatchModal(true);
      }

      if (direction === 'SUPER_SPARK') {
        setSuperLikeToast('Super Like sent ⭐');
        setTimeout(() => setSuperLikeToast(null), 3500);
      }

      // Advance to next candidate ONLY after confirmed backend success
      setCurrentIndex((prev) => prev + 1);
      setPhotoIndex(0);
      setAnimationPhase('idle');
    } catch (err: unknown) {
      // On backend failure: cancel exit animation and restore card to stable state without advancing
      setAnimationPhase('idle');
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
  const currentPhoto = photos[photoIndex] || photos[0] || null;

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
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <span>
          Member {currentIndex + 1} of {candidates.length}
        </span>
        {dailySwipes !== null && <span>⚡ {dailySwipes} free sparks left</span>}

        {/* Profile Utilities (Visually separate from bottom X, Star, Like actions) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          {/* Favourite Toggle Button */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleFavourite(currentCandidate);
            }}
            aria-label={isCurrentFavourite ? 'Remove profile from favourites' : 'Add profile to favourites'}
            data-testid="favourite-toggle-button"
            style={{
              background: 'none',
              border: 'none',
              color: isCurrentFavourite ? 'var(--aura-gold)' : 'var(--aura-taupe)',
              cursor: 'pointer',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0.15rem 0.35rem',
              borderRadius: '4px',
              transition: 'color 0.15s ease',
            }}
            title={isCurrentFavourite ? 'Remove from Favourites' : 'Save to Favourites'}
          >
            <span aria-hidden="true">{isCurrentFavourite ? '🔖' : '🏷️'}</span>
            <span>{isCurrentFavourite ? 'Favourited' : 'Favourite'}</span>
          </button>

          {/* Manage Favourites Modal Trigger */}
          {favouriteList.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowFavouritesModal(true);
              }}
              data-testid="manage-favourites-button"
              aria-label={`View ${favouriteList.length} saved favourite profiles`}
              style={{
                background: 'rgba(195, 161, 91, 0.12)',
                border: '1px solid var(--border-gold)',
                color: 'var(--aura-gold)',
                borderRadius: '4px',
                padding: '0.15rem 0.45rem',
                cursor: 'pointer',
                fontSize: '0.74rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
              title="Manage Favourite Profiles"
            >
              Saved ({favouriteList.length})
            </button>
          )}

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

      {/* Super Like Confirmation Toast */}
      {superLikeToast && (
        <div
          data-testid="super-like-confirmation"
          role="status"
          style={{
            position: 'absolute',
            top: '-2.75rem',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'linear-gradient(135deg, rgba(195, 161, 91, 0.95), rgba(216, 184, 117, 0.95))',
            color: 'var(--aura-black)',
            fontWeight: 700,
            fontSize: '0.88rem',
            padding: '0.45rem 1.1rem',
            borderRadius: '20px',
            boxShadow: '0 4px 16px rgba(195, 161, 91, 0.45)',
            zIndex: 30,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {superLikeToast}
        </div>
      )}

      {/* Card Deck Wrapper */}
      <div style={{ position: 'relative', width: '100%', minHeight: '580px' }}>
        {/* Next Candidate Card (Smooth entrance from behind) */}
        {nextCandidate && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: '16px',
              overflow: 'hidden',
              background: 'var(--aura-charcoal-deep)',
              border: '1px solid var(--border-gold)',
              minHeight: '580px',
              pointerEvents: 'none',
              transform: (animationPhase === 'flying-up' || animationPhase === 'liking-right' || animationPhase === 'passing-left')
                ? 'scale(1) translateY(0)'
                : 'scale(0.94) translateY(12px)',
              opacity: (animationPhase === 'flying-up' || animationPhase === 'liking-right' || animationPhase === 'passing-left')
                ? 1
                : 0.65,
              transition: prefersReducedMotion
                ? 'none'
                : 'transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 420ms ease',
              zIndex: 1,
            }}
          >
            {nextCandidate.photos?.[0]?.card_url ? (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundImage: `url(${nextCandidate.photos[0].card_url})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              />
            ) : (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--aura-charcoal)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-serif)',
                    fontSize: '4.5rem',
                    color: 'var(--aura-gold)',
                    fontWeight: 700,
                  }}
                >
                  {nextCandidate.display_name ? nextCandidate.display_name.charAt(0).toUpperCase() : 'A'}
                </span>
              </div>
            )}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'linear-gradient(to top, rgba(21, 21, 21, 0.98) 0%, rgba(21, 21, 21, 0.7) 45%, rgba(21, 21, 21, 0.15) 80%, rgba(21, 21, 21, 0.5) 100%)',
              }}
            />
          </div>
        )}

        {/* Main Candidate Card */}
        <div
          data-testid="discovery-candidate-card"
          style={{
            position: 'relative',
            borderRadius: '16px',
            overflow: 'hidden',
            background: 'var(--aura-charcoal-deep)',
            border: '1px solid var(--border-gold)',
            boxShadow: animationPhase === 'lifting'
              ? '0 30px 60px rgba(195, 161, 91, 0.45)'
              : '0 20px 40px rgba(0, 0, 0, 0.6)',
            minHeight: '580px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            zIndex: 2,
            transform: (() => {
              if (prefersReducedMotion) return 'none';
              if (animationPhase === 'lifting') return 'scale(1.08) translateY(-8px)';
              if (animationPhase === 'flying-up') return 'translateY(-130px) scale(0.92)';
              if (animationPhase === 'liking-right') return 'translateX(100px) rotate(6deg)';
              if (animationPhase === 'passing-left') return 'translateX(-100px) rotate(-6deg)';
              return 'scale(1) translateY(0)';
            })(),
            opacity: (animationPhase === 'flying-up' || animationPhase === 'liking-right' || animationPhase === 'passing-left') ? 0 : 1,
            transition: (() => {
              if (prefersReducedMotion) {
                return (animationPhase === 'flying-up' || animationPhase === 'liking-right' || animationPhase === 'passing-left')
                  ? 'opacity 250ms ease'
                  : 'none';
              }
              if (animationPhase === 'lifting') return 'transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 280ms ease';
              if (animationPhase === 'flying-up') return 'transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 400ms ease';
              if (animationPhase === 'liking-right' || animationPhase === 'passing-left') return 'transform 320ms ease-out, opacity 300ms ease-out';
              return 'transform 250ms ease-out, box-shadow 250ms ease-out, opacity 250ms ease-out';
            })(),
          }}
        >
        {/* Photo Background */}
        {currentPhoto?.card_url ? (
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
        ) : (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--aura-charcoal)',
              zIndex: 1,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: '5.5rem',
                color: 'var(--aura-gold)',
                fontWeight: 700,
              }}
            >
              {currentCandidate.display_name ? currentCandidate.display_name.charAt(0).toUpperCase() : 'A'}
            </span>
          </div>
        )}

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
          {/* Header Line: Name, Age, Verification, Super Like, Favourite, Compatibility */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.4rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '1.65rem', fontWeight: 700, margin: 0, fontFamily: 'var(--font-serif)' }}>
                {currentCandidate.display_name}, {currentCandidate.age}
              </h2>
              {currentCandidate.is_photo_verified && (
                <span className="badge-gold" title="Biometrically Verified Photo">
                  ✓ Verified
                </span>
              )}
              {(currentCandidate.has_super_liked || currentCandidate.is_super_like) && (
                <span
                  className="badge-gold"
                  title="This member sent you a Super Like!"
                  data-testid="super-like-badge"
                  style={{
                    background: 'linear-gradient(135deg, rgba(195, 161, 91, 0.35), rgba(195, 161, 91, 0.15))',
                    border: '1px solid var(--aura-gold)',
                    color: 'var(--aura-gold-light)',
                    fontWeight: 700,
                  }}
                >
                  ⭐ Super Like
                </span>
              )}
              {isCurrentFavourite && (
                <span
                  className="badge-taupe"
                  data-testid="favourite-badge"
                  style={{ color: 'var(--aura-gold)', borderColor: 'var(--border-gold)', fontSize: '0.72rem' }}
                  title="Saved in Favourites"
                >
                  🔖 Saved
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

        {/* Super Spark / Super Like Button */}
        <button
          onClick={() => handleSwipe('SUPER_SPARK')}
          disabled={swiping}
          aria-label="Super Like candidate"
          title="Super Like (⭐)"
          data-testid="super-like-button"
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            background: 'var(--aura-charcoal-deep)',
            border: starPulse ? '2px solid var(--aura-gold)' : '1px solid var(--border-gold)',
            color: 'var(--aura-gold)',
            fontSize: '1.35rem',
            cursor: swiping ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: starPulse ? 'scale(1.28) rotate(15deg)' : 'scale(1) rotate(0deg)',
            boxShadow: starPulse
              ? '0 0 24px rgba(195, 161, 91, 0.85), 0 0 45px rgba(195, 161, 91, 0.4)'
              : '0 4px 12px rgba(0, 0, 0, 0.4)',
            transition: 'all 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
          onMouseEnter={(e) => {
            if (!swiping && !starPulse) e.currentTarget.style.transform = 'scale(1.08)';
          }}
          onMouseLeave={(e) => {
            if (!swiping && !starPulse) e.currentTarget.style.transform = 'scale(1)';
          }}
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
        Keyboard shortcuts: <strong>←</strong> Pass &nbsp;|&nbsp; <strong>↑</strong> Super Like &nbsp;|&nbsp; <strong>→</strong> Like
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
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>
              {lastSwipeDirection === 'SUPER_SPARK' ? '⭐💖⭐' : '✨💖✨'}
            </div>
            <h2
              style={{
                fontSize: '1.9rem',
                fontWeight: 700,
                marginBottom: '0.5rem',
                fontFamily: 'var(--font-serif)',
                color: 'var(--aura-gold)',
              }}
            >
              {lastSwipeDirection === 'SUPER_SPARK' ? 'Super Like Match!' : 'It\'s a Mutual Match!'}
            </h2>
            <p style={{ color: 'var(--aura-parchment)', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
              {lastSwipeDirection === 'SUPER_SPARK' ? (
                <>You and <strong>{matchedCandidate.display_name}</strong> connected via <strong>Super Like</strong>!</>
              ) : (
                <>You and <strong>{matchedCandidate.display_name}</strong> both sparked mutual interest!</>
              )}
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

      {/* Manage Favourites Modal */}
      {showFavouritesModal && (
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
          onClick={() => setShowFavouritesModal(false)}
        >
          <div
            className="card"
            style={{
              maxWidth: '460px',
              width: '100%',
              padding: '1.75rem',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
            data-testid="favourites-modal"
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.3rem', margin: 0, fontFamily: 'var(--font-serif)', color: 'var(--aura-ivory)' }}>
                🔖 Favourite Profiles ({favouriteList.length})
              </h3>
              <button
                type="button"
                onClick={() => setShowFavouritesModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--aura-taupe)',
                  fontSize: '1.2rem',
                  cursor: 'pointer',
                  padding: '0.2rem',
                }}
                aria-label="Close favourites modal"
              >
                ✕
              </button>
            </div>

            <p style={{ color: 'var(--aura-taupe)', fontSize: '0.84rem', margin: '0 0 1rem 0' }}>
              Profiles you have bookmarked for easy reference.
            </p>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                maxHeight: '50vh',
                paddingRight: '0.25rem',
              }}
            >
              {favouriteList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--aura-taupe)' }}>
                  <p style={{ fontSize: '0.9rem' }}>No favourite profiles saved yet.</p>
                  <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                    Click &ldquo;Favourite&rdquo; on any profile card to save them here.
                  </p>
                </div>
              ) : (
                favouriteList.map((fav) => (
                  <div
                    key={fav.user_id}
                    data-testid={`favourite-item-${fav.user_id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.65rem 0.85rem',
                      background: 'var(--aura-charcoal-deep)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      gap: '0.75rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div
                        style={{
                          width: '44px',
                          height: '44px',
                          borderRadius: '50%',
                          overflow: 'hidden',
                          background: 'var(--aura-charcoal)',
                          flexShrink: 0,
                          border: '1px solid var(--border-gold)',
                        }}
                      >
                        {fav.photo_url ? (
                          <img
                            src={fav.photo_url}
                            alt={fav.display_name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--aura-gold)' }}>
                            ✦
                          </div>
                        )}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--aura-ivory)' }}>
                          {fav.display_name}, {fav.age}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--aura-taupe)' }}>
                          Saved {new Date(fav.added_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveFavourite(fav.user_id)}
                      data-testid={`remove-favourite-${fav.user_id}`}
                      style={{
                        background: 'none',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '4px',
                        color: 'var(--aura-taupe)',
                        padding: '0.25rem 0.55rem',
                        fontSize: '0.76rem',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = '#e07a7a';
                        e.currentTarget.style.borderColor = 'var(--aura-oxblood)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'var(--aura-taupe)';
                        e.currentTarget.style.borderColor = 'var(--border-subtle)';
                      }}
                      title="Remove from favourites"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>

            <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowFavouritesModal(false)}
                className="btn-secondary"
                style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem', cursor: 'pointer' }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
