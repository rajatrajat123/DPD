'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  MatchResponse,
  getMatches,
  unmatch,
  blockUser,
} from '@/lib/api/discovery';

export function MatchesList() {
  const [matches, setMatches] = useState<MatchResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresAgeVerification, setRequiresAgeVerification] = useState(false);
  const [verifyingAge, setVerifyingAge] = useState(false);

  // Unmatch confirmation modal state
  const [unmatchingMatch, setUnmatchingMatch] = useState<MatchResponse | null>(null);
  const [unmatchReason, setUnmatchReason] = useState('No longer interested');
  const [actionPending, setActionPending] = useState(false);

  const loadMatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMatches();
      setMatches(data.matches || []);
      setRequiresAgeVerification(false);
    } catch (err: any) {
      if (
        err?.status === 403 ||
        err?.code === 'AGE_VERIFICATION_REQUIRED' ||
        (typeof err?.message === 'string' &&
          (err.message.includes('403') ||
            err.message.toLowerCase().includes('age verification')))
      ) {
        setRequiresAgeVerification(true);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load matches');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleVerifyAge = async () => {
    setVerifyingAge(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/age-assurance/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        throw new Error('Could not initiate age verification session');
      }
      setRequiresAgeVerification(false);
      await loadMatches();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Age verification failed');
    } finally {
      setVerifyingAge(false);
    }
  };

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  const handleConfirmUnmatch = async () => {
    if (!unmatchingMatch) return;
    setActionPending(true);
    try {
      await unmatch(unmatchingMatch.id, unmatchReason);
      setMatches((prev) => prev.filter((m) => m.id !== unmatchingMatch.id));
      setUnmatchingMatch(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to unmatch');
    } finally {
      setActionPending(false);
    }
  };

  const handleBlockFromMatches = async (targetUserId: string, matchId: string) => {
    setActionPending(true);
    try {
      await blockUser(targetUserId, 'Block initiated from matches list');
      setMatches((prev) => prev.filter((m) => m.id !== matchId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to block match');
    } finally {
      setActionPending(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--aura-taupe)' }}>
        <p>Loading your verified matches...</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.75rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, fontFamily: 'var(--font-serif)', margin: '0 0 0.35rem 0' }}>
            Your Mutual Matches
          </h1>
          <p style={{ color: 'var(--aura-taupe)', fontSize: '0.9rem', margin: 0 }}>
            {matches.length} {matches.length === 1 ? 'mutual connection' : 'mutual connections'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Link
            href="/app/likes"
            className="btn-secondary"
            style={{ textDecoration: 'none', fontSize: '0.88rem', padding: '0.55rem 1.1rem' }}
          >
            ⭐ Likes You
          </Link>
          <Link
            href="/app/discovery"
            className="btn-gold"
            style={{ textDecoration: 'none', fontSize: '0.88rem', padding: '0.55rem 1.1rem' }}
          >
            ✨ Explore Discovery
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
            marginBottom: '1rem',
          }}
        >
          {error}
        </div>
      )}

      {requiresAgeVerification ? (
        <div className="card" style={{ textAlign: 'center', padding: '3.5rem 1.5rem', border: '1px solid var(--border-gold)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🛡️</div>
          <h2 style={{ fontSize: '1.4rem', marginBottom: '0.5rem', fontFamily: 'var(--font-serif)' }}>
            Mandatory 18+ Age Assurance Required
          </h2>
          <p style={{ color: 'var(--aura-taupe)', fontSize: '0.92rem', maxWidth: '460px', margin: '0 auto 1.5rem auto', lineHeight: 1.5 }}>
            To view mutual connections and access community dating features, your adult status must be verified in accordance with Aura safety guidelines.
          </p>
          <button
            type="button"
            onClick={handleVerifyAge}
            disabled={verifyingAge}
            className="btn-gold"
            style={{ display: 'inline-block', padding: '0.75rem 1.75rem', fontSize: '0.95rem', cursor: 'pointer' }}
          >
            {verifyingAge ? 'Verifying Adult Status...' : '🛡️ Complete Age Verification (18+)'}
          </button>
        </div>
      ) : matches.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3.5rem 1.5rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>💬</div>
          <h2 style={{ fontSize: '1.35rem', marginBottom: '0.5rem', fontFamily: 'var(--font-serif)' }}>No Matches Yet</h2>
          <p style={{ color: 'var(--aura-taupe)', fontSize: '0.92rem', maxWidth: '420px', margin: '0 auto 1.75rem auto' }}>
            When someone you like returns your interest, their profile and private chat room will unlock here.
          </p>
          <Link
            href="/app/discovery"
            className="btn-gold"
            style={{ textDecoration: 'none', display: 'inline-block' }}
          >
            Start Discovering
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {matches.map((m) => {
            const profile = m.matched_profile;
            const photoUrl =
              profile?.photos?.[0]?.card_url ||
              profile?.photos?.[0]?.thumb_url ||
              profile?.avatar_url ||
              '';
            const displayName = profile?.display_name || 'Aura Member';
            const age = profile?.age;
            const distance = profile?.approximate_distance_km;
            const matchDate = new Date(m.matched_at).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            });

            return (
              <div
                key={m.id}
                className="card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '1.25rem 1.5rem',
                  gap: '1.25rem',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                  {/* Avatar */}
                  <div
                    style={{
                      width: '70px',
                      height: '70px',
                      borderRadius: '50%',
                      overflow: 'hidden',
                      flexShrink: 0,
                      border: '2px solid var(--border-gold)',
                      backgroundColor: 'var(--aura-charcoal)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {photoUrl ? (
                      <img
                        src={photoUrl}
                        alt={displayName}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <span
                        style={{
                          fontFamily: 'var(--font-serif)',
                          fontSize: '1.75rem',
                          color: 'var(--aura-gold)',
                          fontWeight: 700,
                        }}
                      >
                        {displayName ? displayName.charAt(0).toUpperCase() : 'A'}
                      </span>
                    )}
                  </div>

                  {/* Profile Details */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <h3 style={{ fontSize: '1.2rem', margin: 0, fontFamily: 'var(--font-serif)' }}>
                        {displayName}
                        {age ? `, ${age}` : ''}
                      </h3>
                      {profile?.is_photo_verified && (
                        <span className="badge-gold">
                          ✓ Verified
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', fontSize: '0.82rem', color: 'var(--aura-taupe)' }}>
                      {distance !== undefined && <span>📍 ~{distance} km</span>}
                      {profile?.pronouns && profile.pronouns.length > 0 && (
                        <span>• {profile.pronouns.join('/')}</span>
                      )}
                      <span>• Matched {matchDate}</span>
                    </div>

                    {profile?.bio && (
                      <p
                        style={{
                          fontSize: '0.85rem',
                          color: 'var(--aura-parchment)',
                          marginTop: '0.35rem',
                          maxWidth: '420px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          margin: '0.35rem 0 0 0',
                        }}
                      >
                        {profile.bio}
                      </p>
                    )}
                  </div>
                </div>

                {/* Match Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Link
                    href="/app/messages"
                    className="btn-gold"
                    style={{
                      textDecoration: 'none',
                      fontSize: '0.85rem',
                      padding: '0.5rem 1rem',
                      display: 'inline-block',
                    }}
                  >
                    💬 Message
                  </Link>

                  <button
                    onClick={() => setUnmatchingMatch(m)}
                    className="btn-secondary"
                    style={{
                      padding: '0.5rem 0.85rem',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                    }}
                  >
                    Unmatch
                  </button>

                  <button
                    onClick={() => handleBlockFromMatches(m.matched_user_id, m.id)}
                    disabled={actionPending}
                    title="Block Member Bilaterally"
                    style={{
                      background: 'none',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.95rem',
                      padding: '0.45rem 0.6rem',
                      color: 'var(--aura-taupe)',
                    }}
                  >
                    🛡️
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Unmatch Confirmation Modal */}
      {unmatchingMatch && (
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
            <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: 'var(--aura-ivory)' }}>
              Unmatch {unmatchingMatch.matched_profile?.display_name || 'Member'}?
            </h3>
            <p style={{ color: 'var(--aura-taupe)', fontSize: '0.86rem', lineHeight: 1.45, marginBottom: '1.25rem' }}>
              Unmatching will remove this person from your matches list and dissolve active conversations. This action cannot be undone.
            </p>

            <label htmlFor="unmatchReasonSelect" className="form-label">
              Reason for unmatching (Optional):
            </label>
            <select
              id="unmatchReasonSelect"
              value={unmatchReason}
              onChange={(e) => setUnmatchReason(e.target.value)}
              className="form-select"
              style={{ marginBottom: '1.5rem' }}
            >
              <option value="No longer interested">No longer interested</option>
              <option value="Incompatible values or relationship goals">Incompatible values or relationship goals</option>
              <option value="Met someone else">Met someone else</option>
              <option value="Inappropriate behavior">Inappropriate behavior</option>
              <option value="Prefer not to say">Prefer not to say</option>
            </select>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={handleConfirmUnmatch}
                disabled={actionPending}
                style={{
                  flex: 1,
                  background: 'var(--aura-oxblood)',
                  color: 'white',
                  border: 'none',
                  padding: '0.65rem',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: actionPending ? 'not-allowed' : 'pointer',
                  fontSize: '0.88rem',
                }}
              >
                {actionPending ? 'Unmatching...' : 'Confirm Unmatch'}
              </button>
              <button
                onClick={() => setUnmatchingMatch(null)}
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
