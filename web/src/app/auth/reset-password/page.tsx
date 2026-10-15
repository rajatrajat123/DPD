'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  validatePasswordPolicy,
  checkPasswordRequirements,
  PASSWORD_MAX_LENGTH,
} from '@/lib/validation/password';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [token, setToken] = useState<string>('');

  useEffect(() => {
    const rawToken = searchParams.get('token');
    if (rawToken && !token) {
      setToken(rawToken);
      // Promptly strip sensitive recovery token from browser URL bar and history
      if (typeof window !== 'undefined' && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  }, [searchParams, token]);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const pwRequirements = checkPasswordRequirements(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError('Invalid or missing password recovery token.');
      return;
    }

    const pwValidation = validatePasswordPolicy(password);
    if (!pwValidation.valid) {
      setError(pwValidation.error || 'Password does not meet required criteria.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Failed to update password.');
      }

      setSuccess(true);
      setTimeout(() => router.push('/auth/login'), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error resetting password.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div style={{ textAlign: 'center' }}>
        <p style={{ color: 'var(--aura-oxblood-light)', marginBottom: '1.5rem' }}>
          Invalid or expired password reset link. Please request a new recovery link.
        </p>
        <Link href="/auth/forgot-password" className="btn-secondary">
          Request New Link
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '1rem', color: '#4ade80' }}>✓</div>
        <h3 style={{ marginBottom: '0.5rem' }}>Password Updated</h3>
        <p style={{ color: 'var(--aura-taupe)', marginBottom: '1.5rem' }}>
          Your password has been changed securely. Redirecting to sign in...
        </p>
        <Link href="/auth/login" className="btn-gold">
          Sign In Now
        </Link>
      </div>
    );
  }

  return (
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
          <label htmlFor="newPassword" className="form-label" style={{ margin: 0 }}>
            New Password
          </label>
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
            {showPassword ? 'Hide Password' : 'Show Password'}
          </button>
        </div>
        <input
          id="newPassword"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Min 8 characters (with digit & symbol)"
          className="form-input"
          maxLength={PASSWORD_MAX_LENGTH}
          required
        />

        {/* Real-time Requirement Checklist */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.3rem',
            marginTop: '0.5rem',
            fontSize: '0.78rem',
            color: 'var(--aura-taupe)',
          }}
        >
          <span style={{ color: pwRequirements.hasMinLength && pwRequirements.hasValidMax ? '#4ade80' : 'var(--aura-taupe)' }}>
            {pwRequirements.hasMinLength && pwRequirements.hasValidMax ? '✓' : '•'} 8–128 characters
          </span>
          <span style={{ color: pwRequirements.hasDigit ? '#4ade80' : 'var(--aura-taupe)' }}>
            {pwRequirements.hasDigit ? '✓' : '•'} At least one numeric digit (0–9)
          </span>
          <span style={{ color: pwRequirements.hasSpecial ? '#4ade80' : 'var(--aura-taupe)' }}>
            {pwRequirements.hasSpecial ? '✓' : '•'} At least one special character (!, @, #, $, _)
          </span>
        </div>
      </div>

      <div className="form-group" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
          <label htmlFor="confirmPassword" className="form-label" style={{ margin: 0 }}>
            Confirm New Password
          </label>
          <button
            type="button"
            onClick={() => setShowConfirmPassword((prev) => !prev)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--aura-gold)',
              fontSize: '0.8rem',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {showConfirmPassword ? 'Hide Password' : 'Show Password'}
          </button>
        </div>
        <input
          id="confirmPassword"
          type={showConfirmPassword ? 'text' : 'password'}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="••••••••••••"
          className="form-input"
          maxLength={PASSWORD_MAX_LENGTH}
          required
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="btn-gold"
        style={{ width: '100%', marginTop: '0.5rem', opacity: loading ? 0.7 : 1 }}
      >
        {loading ? 'Updating Password...' : 'Save New Password'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="section-container" style={{ maxWidth: '460px', margin: '4rem auto' }}>
      <div className="card" style={{ border: '1px solid var(--border-gold)', padding: '2.5rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <span className="badge-gold" style={{ marginBottom: '0.75rem' }}>
            ✦ Security
          </span>
          <h1 style={{ fontSize: '1.85rem', marginBottom: '0.5rem' }}>
            Create New Password
          </h1>
          <p style={{ color: 'var(--aura-taupe)', fontSize: '0.95rem' }}>
            Choose a strong password with 8–128 characters, a digit, and a special symbol.
          </p>
        </div>

        <Suspense fallback={<div style={{ textAlign: 'center', color: 'var(--aura-taupe)' }}>Loading reset form...</div>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
