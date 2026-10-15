'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  validatePasswordPolicy,
  checkPasswordRequirements,
  PASSWORD_MAX_LENGTH,
} from '@/lib/validation/password';

interface RegisterFormProps {
  initialRedirect?: string;
  initialTier?: string;
}

export function RegisterForm({ initialRedirect, initialTier }: RegisterFormProps) {
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [selectedPronouns, setSelectedPronouns] = useState<string[]>(['they/them']);
  const [selectedGenders, setSelectedGenders] = useState<string[]>(['non-binary']);
  const [selectedOrientations, setSelectedOrientations] = useState<string[]>(['queer']);
  const [selectedIntents, setSelectedIntents] = useState<string[]>(['serious dating']);
  const [relationshipStructure, setRelationshipStructure] = useState('MONOGAMOUS');
  const [agreeAge, setAgreeAge] = useState(false);

  const targetDestination =
    initialRedirect ||
    (initialTier === 'plus'
      ? '/membership?plan=AURA_PLUS'
      : initialTier === 'elite'
      ? '/membership?plan=AURA_ELITE'
      : '');

  const PRONOUN_OPTIONS = ['they/them', 'she/her', 'he/him', 'ze/zir'];
  const GENDER_OPTIONS = [
    'non-binary',
    'transgender woman',
    'transgender man',
    'cisgender woman',
    'cisgender man',
    'genderfluid',
    'agender',
    'two-spirit',
    'genderqueer',
  ];
  const ORIENTATION_OPTIONS = ['queer', 'gay', 'lesbian', 'bisexual', 'pansexual', 'asexual', 'demisexual'];
  const INTENT_OPTIONS = [
    'serious dating',
    'long-term partner',
    'casual dating',
    'queer platonic',
    'community / friends',
  ];
  const STRUCTURE_OPTIONS = [
    { value: 'MONOGAMOUS', label: 'Monogamous' },
    { value: 'ENM', label: 'Ethically Non-Monogamous (ENM)' },
    { value: 'POLYAMOROUS', label: 'Polyamorous' },
    { value: 'OPEN', label: 'Open Relationship' },
    { value: 'EXPLORING', label: 'Exploring Dynamics' },
  ];

  const toggleOption = (list: string[], setList: (val: string[]) => void, item: string) => {
    if (list.includes(item)) {
      if (list.length > 1) {
        setList(list.filter((x) => x !== item));
      }
    } else {
      setList([...list, item]);
    }
  };

  const pwRequirements = checkPasswordRequirements(password);

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (step === 1) {
      if (!email || !password || !displayName || !birthdate) {
        setError('Please complete all required fields.');
        return;
      }

      const pwResult = validatePasswordPolicy(password);
      if (!pwResult.valid) {
        setError(pwResult.error || 'Password does not meet required criteria.');
        return;
      }

      // Check 18+
      const bDate = new Date(birthdate);
      const today = new Date();
      let age = today.getFullYear() - bDate.getFullYear();
      const m = today.getMonth() - bDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < bDate.getDate())) {
        age--;
      }
      if (age < 18) {
        setError('Aura is strictly for adults aged 18 and older.');
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      if (!agreeAge) {
        setError('You must confirm that you are at least 18 years old to join Aura.');
        return;
      }
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          display_name: displayName.trim(),
          birthdate,
          gender_identities: selectedGenders,
          sexual_orientations: selectedOrientations,
          pronouns: selectedPronouns,
          relationship_intents: selectedIntents,
          relationship_structure: relationshipStructure,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || data.message || 'Registration failed.');
      }

      // Preserve intended subscription or deep-link destination through onboarding
      const nextUrl = targetDestination
        ? `/onboarding?redirect=${encodeURIComponent(targetDestination)}`
        : '/onboarding';

      router.push(nextUrl);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const loginHref = targetDestination
    ? `/auth/login?redirect=${encodeURIComponent(targetDestination)}`
    : '/auth/login';

  return (
    <div className="section-container" style={{ maxWidth: '580px', margin: '3.5rem auto' }}>
      <div className="card" style={{ border: '1px solid var(--border-gold)', padding: '2.5rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <span className="badge-gold" style={{ marginBottom: '0.75rem' }}>
            ✦ Step {step} of 2
          </span>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
            {step === 1 ? 'Apply for Aura Membership' : 'Your Identity & Intent'}
          </h1>
          <p style={{ color: 'var(--aura-taupe)', fontSize: '0.95rem' }}>
            {step === 1
              ? 'An elevated, discrete space for authentic queer dating.'
              : 'Choose your pronouns and identities. You maintain full granular visibility control.'}
          </p>
          {initialTier && (
            <div style={{ marginTop: '0.75rem' }}>
              <span className="badge-oxblood" style={{ fontSize: '0.75rem' }}>
                Selected Tier: {initialTier.toUpperCase()}
              </span>
            </div>
          )}
        </div>

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
              marginBottom: '1.5rem',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleNext}>
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="displayName" className="form-label">
                  Display Name
                </label>
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your preferred name"
                  className="form-input"
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="email" className="form-label">
                  Email Address
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

              <div className="form-group" style={{ marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <label htmlFor="password" className="form-label" style={{ margin: 0 }}>
                    Password
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
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 characters (with digit & symbol)"
                  className="form-input"
                  maxLength={PASSWORD_MAX_LENGTH}
                  required
                />

                {/* Password Policy Requirements Checklist */}
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
                <label htmlFor="birthdate" className="form-label">
                  Date of Birth (Must be 18+)
                </label>
                <input
                  id="birthdate"
                  type="date"
                  value={birthdate}
                  onChange={(e) => setBirthdate(e.target.value)}
                  className="form-input"
                  required
                />
                <span style={{ fontSize: '0.8rem', color: 'var(--aura-taupe)', marginTop: '0.25rem', display: 'block' }}>
                  Aura is an adults-only sanctuary. Your exact birthdate is never publicly displayed.
                </span>
              </div>

              <button type="submit" className="btn-gold" style={{ width: '100%', marginTop: '0.5rem' }}>
                Continue to Identity &amp; Preferences &rarr;
              </button>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Pronouns */}
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem' }}>
                  Pronouns
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {PRONOUN_OPTIONS.map((p) => {
                    const selected = selectedPronouns.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => toggleOption(selectedPronouns, setSelectedPronouns, p)}
                        style={{
                          background: selected ? 'var(--aura-gold)' : 'var(--aura-charcoal-deep)',
                          color: selected ? 'var(--aura-black)' : 'var(--aura-parchment)',
                          border: selected ? '1px solid var(--aura-gold)' : '1px solid var(--border-subtle)',
                          padding: '0.45rem 1rem',
                          borderRadius: '20px',
                          fontSize: '0.85rem',
                          fontWeight: selected ? 600 : 400,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Gender Identities */}
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem' }}>
                  Gender Identity
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {GENDER_OPTIONS.map((g) => {
                    const selected = selectedGenders.includes(g);
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => toggleOption(selectedGenders, setSelectedGenders, g)}
                        style={{
                          background: selected ? 'var(--aura-gold)' : 'var(--aura-charcoal-deep)',
                          color: selected ? 'var(--aura-black)' : 'var(--aura-parchment)',
                          border: selected ? '1px solid var(--aura-gold)' : '1px solid var(--border-subtle)',
                          padding: '0.45rem 1rem',
                          borderRadius: '20px',
                          fontSize: '0.85rem',
                          fontWeight: selected ? 600 : 400,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Sexual Orientations */}
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem' }}>
                  Sexual Orientation
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {ORIENTATION_OPTIONS.map((o) => {
                    const selected = selectedOrientations.includes(o);
                    return (
                      <button
                        key={o}
                        type="button"
                        onClick={() => toggleOption(selectedOrientations, setSelectedOrientations, o)}
                        style={{
                          background: selected ? 'var(--aura-gold)' : 'var(--aura-charcoal-deep)',
                          color: selected ? 'var(--aura-black)' : 'var(--aura-parchment)',
                          border: selected ? '1px solid var(--aura-gold)' : '1px solid var(--border-subtle)',
                          padding: '0.45rem 1rem',
                          borderRadius: '20px',
                          fontSize: '0.85rem',
                          fontWeight: selected ? 600 : 400,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                      >
                        {o}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Relationship Intents */}
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem' }}>
                  Relationship Intent
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {INTENT_OPTIONS.map((i) => {
                    const selected = selectedIntents.includes(i);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleOption(selectedIntents, setSelectedIntents, i)}
                        style={{
                          background: selected ? 'var(--aura-gold)' : 'var(--aura-charcoal-deep)',
                          color: selected ? 'var(--aura-black)' : 'var(--aura-parchment)',
                          border: selected ? '1px solid var(--aura-gold)' : '1px solid var(--border-subtle)',
                          padding: '0.45rem 1rem',
                          borderRadius: '20px',
                          fontSize: '0.85rem',
                          fontWeight: selected ? 600 : 400,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                      >
                        {i}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Relationship Structure */}
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem' }}>
                  Relationship Dynamic / Structure
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {STRUCTURE_OPTIONS.map((st) => {
                    const selected = relationshipStructure === st.value;
                    return (
                      <button
                        key={st.value}
                        type="button"
                        onClick={() => setRelationshipStructure(st.value)}
                        style={{
                          background: selected ? 'var(--aura-gold)' : 'var(--aura-charcoal-deep)',
                          color: selected ? 'var(--aura-black)' : 'var(--aura-parchment)',
                          border: selected ? '1px solid var(--aura-gold)' : '1px solid var(--border-subtle)',
                          padding: '0.45rem 1rem',
                          borderRadius: '20px',
                          fontSize: '0.85rem',
                          fontWeight: selected ? 600 : 400,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                      >
                        {st.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Adults-only confirmation */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  padding: '1rem',
                  background: 'var(--aura-charcoal)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <input
                  id="agreeAge"
                  type="checkbox"
                  checked={agreeAge}
                  onChange={(e) => setAgreeAge(e.target.checked)}
                  style={{ marginTop: '0.2rem', cursor: 'pointer' }}
                  required
                />
                <label htmlFor="agreeAge" style={{ fontSize: '0.85rem', color: 'var(--aura-parchment)', cursor: 'pointer' }}>
                  I solemnly confirm that I am at least 18 years old and agree to uphold Aura&apos;s Community Standards of authenticity, discretion, and mutual respect.
                </label>
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="btn-ghost"
                  style={{ flex: 1 }}
                >
                  &larr; Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-gold"
                  style={{ flex: 2, opacity: loading ? 0.7 : 1 }}
                >
                  {loading ? 'Submitting Application...' : 'Apply for Membership'}
                </button>
              </div>
            </div>
          )}
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.9rem', color: 'var(--aura-taupe)' }}>
          Already have an account?{' '}
          <Link href={loginHref} style={{ color: 'var(--aura-gold)', fontWeight: 600, textDecoration: 'none' }}>
            Sign In Here
          </Link>
        </div>
      </div>
    </div>
  );
}
