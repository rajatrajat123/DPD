'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get('redirect') || '/app/discovery';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter both your email address and password.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || data.message || 'Invalid email or password.');
      }

      router.push(redirectTarget);
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Authentication failed. Please verify your credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  const registerHref =
    redirectTarget && redirectTarget !== '/app/discovery'
      ? `/auth/register?redirect=${encodeURIComponent(redirectTarget)}`
      : '/auth/register';

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {error && (
        <div
          role="alert"
          style={{
            padding: '0.85rem 1rem',
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
          Email Address
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@domain.com"
          className="form-input"
          required
        />
      </div>

      <div className="form-group" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <label htmlFor="password" className="form-label" style={{ margin: 0 }}>
            Password
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--aura-gold)',
                fontSize: '0.8rem',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
            <span style={{ color: 'var(--aura-taupe)', fontSize: '0.75rem' }}>•</span>
            <Link
              href="/auth/forgot-password"
              style={{ fontSize: '0.82rem', color: 'var(--aura-gold)', textDecoration: 'none' }}
            >
              Forgot password?
            </Link>
          </div>
        </div>
        <input
          id="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••••••"
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
        {loading ? 'Authenticating...' : 'Sign In to Aura'}
      </button>

      <div style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--aura-taupe)' }}>
        New to Aura?{' '}
        <Link href={registerHref} style={{ color: 'var(--aura-gold)', fontWeight: 600, textDecoration: 'none' }}>
          Apply for Membership
        </Link>
      </div>
    </form>
  );
}
