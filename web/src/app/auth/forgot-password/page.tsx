'use client';

import React, { useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!res.ok) {
        throw new Error('Failed to request password reset.');
      }

      setSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error sending password reset request.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="section-container" style={{ maxWidth: '460px', margin: '4rem auto' }}>
      <div className="card" style={{ border: '1px solid var(--border-gold)', padding: '2.5rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <span className="badge-gold" style={{ marginBottom: '0.75rem' }}>
            ✦ Account Recovery
          </span>
          <h1 style={{ fontSize: '1.85rem', marginBottom: '0.5rem' }}>
            Password Reset
          </h1>
          <p style={{ color: 'var(--aura-taupe)', fontSize: '0.95rem' }}>
            Enter your account email address and we will dispatch a secure recovery link.
          </p>
        </div>

        {submitted ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>✉️</div>
            <h3 style={{ marginBottom: '0.5rem' }}>Check Your Email</h3>
            <p style={{ color: 'var(--aura-taupe)', fontSize: '0.92rem', marginBottom: '1.5rem' }}>
              If an Aura account exists for <strong>{email}</strong>, you will receive instructions to reset your password shortly.
            </p>
            <Link href="/auth/login" className="btn-gold" style={{ display: 'inline-block' }}>
              Return to Sign In
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {error && (
              <div
                role="alert"
                style={{
                  padding: '0.85rem',
                  borderRadius: '6px',
                  background: 'var(--aura-oxblood-dim)',
                  border: '1px solid var(--aura-oxblood)',
                  color: 'var(--aura-ivory)',
                  fontSize: '0.9rem',
                }}
              >
                {error}
              </div>
            )}

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="email" className="form-label">
                Registered Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@domain.com"
                className="form-input"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-gold"
              style={{ width: '100%', marginTop: '0.5rem', opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Dispatching Link...' : 'Send Recovery Link'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.9rem' }}>
              <Link href="/auth/login" style={{ color: 'var(--aura-taupe)', textDecoration: 'none' }}>
                &larr; Return to Sign In
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
