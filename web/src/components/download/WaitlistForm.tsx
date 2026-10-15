'use client';

import React, { useState } from 'react';

export function WaitlistForm() {
  const [submitted, setSubmitted] = useState(false);
  const [email, setEmail] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div
        role="status"
        style={{
          background: 'var(--aura-gold-dim)',
          border: '1px solid var(--border-gold)',
          padding: '1rem',
          borderRadius: '8px',
          color: 'var(--aura-gold)',
          fontSize: '0.92rem',
          textAlign: 'center',
        }}
      >
        ✦ You are on the VIP mobile invitation list! You can explore the web platform immediately.
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Enter your email address"
        className="form-input"
        style={{ flex: '1 1 240px', maxWidth: '340px' }}
      />
      <button type="submit" className="btn-gold">
        Request Invitation
      </button>
    </form>
  );
}
