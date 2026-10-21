'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface OnboardingPhoto {
  id: string;
  url: string;
  name?: string;
}

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get('redirect') || '/app/discovery';

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Profile details (supplied by the member, never pre-filled with demo data)
  const [bio, setBio] = useState('');
  const [smokingHabit, setSmokingHabit] = useState('NON_SMOKER');
  const [drinkingHabit, setDrinkingHabit] = useState('SOCIAL_DRINKER');

  // Step 2: Discovery preferences & dealbreakers
  const [minAge, setMinAge] = useState(21);
  const [maxAge, setMaxAge] = useState(42);
  const [maxDistanceKm, setMaxDistanceKm] = useState(50);
  const [preferredGenders, setPreferredGenders] = useState<string[]>([]);
  const [nonSmokerOnly, setNonSmokerOnly] = useState(true); // Hard lifestyle dealbreaker
  const [verifiedOnly, setVerifiedOnly] = useState(false); // Hard dealbreaker
  const [requireMonogamous, setRequireMonogamous] = useState(false);

  // Step 3: Privacy & Discretion Settings
  const [discreteMode, setDiscreteMode] = useState(false);
  const [travelerSafety, setTravelerSafety] = useState(true);

  // Step 4: Age assurance state
  const [ageSessionId, setAgeSessionId] = useState<string | null>(null);
  const [ageStatus, setAgeStatus] = useState<'UNSTARTED' | 'PENDING' | 'VERIFIED'>('UNSTARTED');

  // Step 5: Photo upload state (minimum 3 approved photos required)
  const [uploadedPhotos, setUploadedPhotos] = useState<OnboardingPhoto[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);

  const GENDER_OPTIONS = ['non-binary', 'transgender woman', 'transgender man', 'cisgender woman', 'cisgender man', 'genderfluid', 'agender', 'two-spirit', 'queer'];

  const togglePreferredGender = (gender: string) => {
    if (preferredGenders.includes(gender)) {
      if (preferredGenders.length > 1) {
        setPreferredGenders(preferredGenders.filter((g) => g !== gender));
      }
    } else {
      setPreferredGenders([...preferredGenders, gender]);
    }
  };

  // Step 4: Initiate Age Assurance
  //
  // The backend is the sole authority for age verification. The client never
  // marks a member as verified: it starts the session and then reads back the
  // authoritative status. A failed request leaves the member unverified.
  const initiateAgeAssurance = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/age-assurance/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setAgeStatus('PENDING');
        setError(
          (data && (data.message || data.error)) ||
            'Age assurance service is temporarily unavailable. Please try again.'
        );
        return;
      }

      setAgeSessionId(data?.session_id || null);

      const statusRes = await fetch('/api/v1/age-assurance/status');
      const statusData = await statusRes.json().catch(() => null);

      if (statusRes.ok && statusData?.status === 'VERIFIED') {
        setAgeStatus('VERIFIED');
      } else {
        setAgeStatus('PENDING');
      }
    } catch {
      setAgeStatus('PENDING');
      setError('Could not reach the age assurance gateway. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const loadExistingGallery = async () => {
    try {
      const res = await fetch('/api/v1/media/gallery/me');
      if (res.ok) {
        const data = await res.json();
        if (data.assets && Array.isArray(data.assets)) {
          setUploadedPhotos(
            data.assets.map((a: any) => ({
              id: a.id,
              url: a.derivatives?.[0]?.url || `/api/v1/media/${a.id}`,
              name: a.original_filename,
            }))
          );
        }
      }
    } catch {
      // non-blocking
    }
  };

  useEffect(() => {
    if (step === 5) {
      loadExistingGallery();
    }
  }, [step]);

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      setPhotoUploadError('File size exceeds 15MB limit.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPhotoUploadError('Only JPEG, PNG, and WebP images are permitted.');
      return;
    }

    setPhotoUploadError(null);
    setUploadingPhoto(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('purpose', 'PROFILE_GALLERY');
      formData.append('media_type', 'IMAGE');

      const directRes = await fetch('/api/v1/media/upload', {
        method: 'POST',
        body: formData,
      });

      if (!directRes.ok) {
        const errJson = await directRes.json().catch(() => null);
        if (errJson?.error?.code === 'MODERATION_REJECTED') {
          throw new Error('Photo was rejected by safety moderation. Please choose an appropriate photo.');
        }
        if (errJson?.error?.message) {
          throw new Error(errJson.error.message);
        }
        throw new Error('Upload failed. Please try a different photo.');
      }

      const directData = await directRes.json();
      const newPhoto: OnboardingPhoto = {
        id: directData.id,
        url: directData.derivatives?.[0]?.url || `/api/v1/media/${directData.id}`,
        name: file.name,
      };
      setUploadedPhotos((prev) => [...prev, newPhoto]);
    } catch (err: unknown) {
      setPhotoUploadError(err instanceof Error ? err.message : 'Photo upload failed.');
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const handleDeletePhoto = async (assetId: string) => {
    try {
      const res = await fetch(`/api/v1/media/${assetId}`, { method: 'DELETE' });
      if (res.ok) {
        setUploadedPhotos((prev) => prev.filter((p) => p.id !== assetId));
      } else {
        const errJson = await res.json().catch(() => null);
        setPhotoUploadError(errJson?.error?.message || 'Could not remove photo.');
      }
    } catch {
      setPhotoUploadError('Could not remove photo.');
    }
  };

  const handleComplete = async () => {
    if (uploadedPhotos.length < 3) {
      setError(`At least 3 approved profile photos are required before entering discovery. You currently have ${uploadedPhotos.length}.`);
      return;
    }
    setLoading(true);
    setError(null);

    try {
      // 1. Save profile updates
      await fetch('/api/v1/profiles/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bio,
          discrete_mode_enabled: discreteMode,
          smoking_habit: smokingHabit,
          drinking_habit: drinkingHabit,
        }),
      });

      // 2. Save dating preferences & hard dealbreakers
      await fetch('/api/v1/profiles/me/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          min_age: minAge,
          max_age: maxAge,
          max_distance_km: maxDistanceKm,
          preferred_genders: preferredGenders,
          verified_profiles_only: verifiedOnly,
          dealbreakers: {
            non_smoker_only: nonSmokerOnly,
            require_monogamous: requireMonogamous,
            require_verified: verifiedOnly,
          },
        }),
      });

      router.push(redirectTarget);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error finalizing profile. Proceeding to destination.');
      router.push(redirectTarget);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="section-container" style={{ maxWidth: '640px', margin: '3rem auto' }}>
      <div className="card" style={{ border: '1px solid var(--border-gold)', padding: '2.5rem 2rem' }}>
        {/* Progress Header */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span className="badge-gold">✦ Member Onboarding</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--aura-taupe)' }}>Step {step} of 5</span>
          </div>
          <div style={{ height: '4px', background: 'var(--border-subtle)', borderRadius: '2px', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${(step / 5) * 100}%`,
                background: 'var(--aura-gold)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>

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
              marginBottom: '1.5rem',
            }}
          >
            {error}
          </div>
        )}

        {/* STEP 1: Bio & Lifestyle Habits */}
        {step === 1 && (
          <div>
            <h1 style={{ fontSize: '1.85rem', marginBottom: '0.5rem' }}>Your Story &amp; Habits</h1>
            <p style={{ color: 'var(--aura-taupe)', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
              Share your intentions and lifestyle to help candidates understand the real you.
            </p>

            <div className="form-group">
              <label htmlFor="bio" className="form-label">
                About You / Relationship Intentions
              </label>
              <textarea
                id="bio"
                rows={4}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="What brings you to Aura? What values matter most to you?"
                className="form-textarea"
                maxLength={500}
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--aura-taupe)', textAlign: 'right' }}>
                {bio.length}/500 characters
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="smokingHabit" className="form-label">
                Smoking Habits
              </label>
              <select
                id="smokingHabit"
                value={smokingHabit}
                onChange={(e) => setSmokingHabit(e.target.value)}
                className="form-select"
              >
                <option value="NON_SMOKER">Non-Smoker (Never smoke)</option>
                <option value="SOCIAL_SMOKER">Social Smoker</option>
                <option value="REGULAR_SMOKER">Regular Smoker</option>
                <option value="CANNABIS_ONLY">Cannabis Only</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="drinkingHabit" className="form-label">
                Drinking Habits
              </label>
              <select
                id="drinkingHabit"
                value={drinkingHabit}
                onChange={(e) => setDrinkingHabit(e.target.value)}
                className="form-select"
              >
                <option value="SOBER">Sober / Non-Drinker</option>
                <option value="SOCIAL_DRINKER">Social Drinker</option>
                <option value="REGULAR_DRINKER">Regular Drinker</option>
              </select>
            </div>

            <button type="button" onClick={() => setStep(2)} className="btn-gold" style={{ width: '100%', marginTop: '1rem' }}>
              Continue to Dealbreakers &rarr;
            </button>
          </div>
        )}

        {/* STEP 2: Discovery Preferences & Hard Dealbreakers */}
        {step === 2 && (
          <div>
            <h1 style={{ fontSize: '1.85rem', marginBottom: '0.5rem' }}>Preferences &amp; Dealbreakers</h1>
            <p style={{ color: 'var(--aura-taupe)', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
              Aura enforces hard lifestyle dealbreakers with absolute integrity. No silent compromises.
            </p>

            <div className="form-group">
              <label className="form-label">
                Preferred Age Range: {minAge} to {maxAge} years
              </label>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <input
                  type="range"
                  min={18}
                  max={80}
                  value={minAge}
                  onChange={(e) => setMinAge(Math.min(Number(e.target.value), maxAge - 1))}
                  style={{ flex: 1, accentColor: 'var(--aura-gold)' }}
                />
                <input
                  type="range"
                  min={18}
                  max={80}
                  value={maxAge}
                  onChange={(e) => setMaxAge(Math.max(Number(e.target.value), minAge + 1))}
                  style={{ flex: 1, accentColor: 'var(--aura-gold)' }}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">
                Maximum Distance: {maxDistanceKm} km
              </label>
              <input
                type="range"
                min={5}
                max={250}
                value={maxDistanceKm}
                onChange={(e) => setMaxDistanceKm(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--aura-gold)' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block' }}>
                Genders You Are Open to Meeting
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {GENDER_OPTIONS.map((g) => {
                  const sel = preferredGenders.includes(g);
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => togglePreferredGender(g)}
                      style={{
                        background: sel ? 'var(--aura-gold)' : 'var(--aura-charcoal-deep)',
                        color: sel ? 'var(--aura-black)' : 'var(--aura-parchment)',
                        border: `1px solid ${sel ? 'var(--aura-gold)' : 'var(--border-medium)'}`,
                        padding: '0.4rem 0.8rem',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        fontWeight: sel ? 600 : 400,
                      }}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Hard Dealbreakers Toggles */}
            <div style={{ background: 'var(--aura-charcoal-deep)', padding: '1.25rem', borderRadius: '10px', marginTop: '1rem', border: '1px solid var(--border-subtle)' }}>
              <h4 style={{ fontSize: '1rem', color: 'var(--aura-gold)', marginBottom: '0.75rem' }}>
                ⚖️ Hard Lifestyle Dealbreakers
              </h4>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={nonSmokerOnly}
                  onChange={(e) => setNonSmokerOnly(e.target.checked)}
                  style={{ accentColor: 'var(--aura-gold)', width: '18px', height: '18px' }}
                />
                <span style={{ fontSize: '0.9rem', color: 'var(--aura-ivory)' }}>
                  <strong>Non-Smoker Only:</strong> Exclude all smokers completely from my discovery deck.
                </span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={verifiedOnly}
                  onChange={(e) => setVerifiedOnly(e.target.checked)}
                  style={{ accentColor: 'var(--aura-gold)', width: '18px', height: '18px' }}
                />
                <span style={{ fontSize: '0.9rem', color: 'var(--aura-ivory)' }}>
                  <strong>Verified Profiles Only:</strong> Discover only members with confirmed photo badges.
                </span>
              </label>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
              <button type="button" onClick={() => setStep(1)} className="btn-ghost" style={{ flex: 1 }}>
                &larr; Back
              </button>
              <button type="button" onClick={() => setStep(3)} className="btn-gold" style={{ flex: 2 }}>
                Continue to Privacy &rarr;
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Privacy & Discretion Controls */}
        {step === 3 && (
          <div>
            <h1 style={{ fontSize: '1.85rem', marginBottom: '0.5rem' }}>Discretion &amp; Shielding</h1>
            <p style={{ color: 'var(--aura-taupe)', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
              Tailor how visible your profile is in public spaces and during international travel.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ background: 'var(--aura-charcoal-deep)', padding: '1.25rem', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={travelerSafety}
                    onChange={(e) => setTravelerSafety(e.target.checked)}
                    style={{ accentColor: 'var(--aura-gold)', width: '20px', height: '20px', marginTop: '0.2rem' }}
                  />
                  <div>
                    <strong style={{ color: 'var(--aura-ivory)', display: 'block', marginBottom: '0.25rem' }}>
                      Traveler Safety Mode (Recommended)
                    </strong>
                    <span style={{ color: 'var(--aura-taupe)', fontSize: '0.88rem', lineHeight: 1.5, display: 'block' }}>
                      Automatically conceals sensitive gender and orientation labels when your device enters jurisdictions with restrictive LGBTQ+ legal climates.
                    </span>
                  </div>
                </label>
              </div>

              <div style={{ background: 'var(--aura-charcoal-deep)', padding: '1.25rem', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={discreteMode}
                    onChange={(e) => setDiscreteMode(e.target.checked)}
                    style={{ accentColor: 'var(--aura-gold)', width: '20px', height: '20px', marginTop: '0.2rem' }}
                  />
                  <div>
                    <strong style={{ color: 'var(--aura-ivory)', display: 'block', marginBottom: '0.25rem' }}>
                      Discrete Display Mode
                    </strong>
                    <span style={{ color: 'var(--aura-taupe)', fontSize: '0.88rem', lineHeight: 1.5, display: 'block' }}>
                      Hides profile badges and switches to neutral app title bars when browsing in public environments.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
              <button type="button" onClick={() => setStep(2)} className="btn-ghost" style={{ flex: 1 }}>
                &larr; Back
              </button>
              <button type="button" onClick={() => setStep(4)} className="btn-gold" style={{ flex: 2 }}>
                Continue to Age Verification &rarr;
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: Mandatory 18+ Age Assurance */}
        {step === 4 && (
          <div>
            <h1 style={{ fontSize: '1.85rem', marginBottom: '0.5rem' }}>Adult Age Assurance (18+)</h1>
            <p style={{ color: 'var(--aura-taupe)', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
              Aura is legally and ethically restricted to consenting adults aged 18 and older.
            </p>

            <div style={{ background: 'var(--aura-charcoal-deep)', padding: '1.5rem', borderRadius: '10px', border: '1px solid var(--border-gold)', textAlign: 'center', marginBottom: '1.5rem' }}>
              {ageStatus === 'VERIFIED' ? (
                <div>
                  <div style={{ fontSize: '2.5rem', color: 'var(--aura-gold)', marginBottom: '0.5rem' }}>✓</div>
                  <h3 style={{ fontSize: '1.3rem', color: 'var(--aura-ivory)', marginBottom: '0.5rem' }}>
                    Age Assurance Confirmed
                  </h3>
                  <p style={{ color: 'var(--aura-taupe)', fontSize: '0.9rem' }}>
                    Session ID: {ageSessionId || 'Active Verified Session'}. Your account is cleared for adult matchmaking.
                  </p>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🛡️</div>
                  <h3 style={{ fontSize: '1.3rem', color: 'var(--aura-ivory)', marginBottom: '0.5rem' }}>
                    Identity Verification Protocol
                  </h3>
                  <p style={{ color: 'var(--aura-taupe)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                    We verify age using privacy-preserving zero-knowledge proof. No identity documents are permanently stored on our servers.
                  </p>
                  {ageSessionId && (
                    <p style={{ color: 'var(--aura-gold)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                      Verification session {ageSessionId} is pending. Complete the provider step, then check again.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={initiateAgeAssurance}
                    disabled={loading}
                    className="btn-gold"
                  >
                    {loading
                      ? 'Initiating Verification...'
                      : ageSessionId
                        ? 'Check Verification Status'
                        : 'Begin Age Assurance Verification'}
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
              <button type="button" onClick={() => setStep(3)} className="btn-ghost" style={{ flex: 1 }}>
                &larr; Back
              </button>
              <button
                type="button"
                onClick={() => setStep(5)}
                disabled={ageStatus !== 'VERIFIED'}
                className="btn-gold"
                style={{ flex: 2, opacity: ageStatus === 'VERIFIED' ? 1 : 0.5 }}
              >
                Continue to Photos &rarr;
              </button>
            </div>
          </div>
        )}

        {/* STEP 5: Profile Photo & Finalize */}
        {step === 5 && (
          <div>
            <h1 style={{ fontSize: '1.85rem', marginBottom: '0.5rem' }}>Profile Presentation</h1>
            <p style={{ color: 'var(--aura-taupe)', fontSize: '0.95rem', marginBottom: '1.25rem' }}>
              Add at least 3 clear portraits to complete your profile and enter discovery. EXIF and GPS metadata are stripped automatically.
            </p>

            {/* Photo count progress indicator */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                background: uploadedPhotos.length >= 3 ? 'rgba(46, 125, 50, 0.15)' : 'var(--aura-charcoal-deep)',
                border: uploadedPhotos.length >= 3 ? '1px solid rgba(76, 175, 80, 0.4)' : '1px solid var(--border-gold)',
                marginBottom: '1.5rem',
              }}
            >
              <div>
                <span style={{ fontWeight: 600, color: uploadedPhotos.length >= 3 ? '#81c784' : 'var(--aura-gold)' }}>
                  {uploadedPhotos.length >= 3
                    ? `✓ ${uploadedPhotos.length} of 3 photos added — Discovery ready!`
                    : `📷 ${uploadedPhotos.length} of 3 photos added (${3 - uploadedPhotos.length} more required)`}
                </span>
              </div>
              <span style={{ fontSize: '0.82rem', color: 'var(--aura-taupe)' }}>
                Minimum: 3 photos
              </span>
            </div>

            {/* Photo Cards Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                gap: '1rem',
                marginBottom: '1.5rem',
              }}
            >
              {uploadedPhotos.map((photo, index) => (
                <div
                  key={photo.id}
                  style={{
                    position: 'relative',
                    aspectRatio: '3/4',
                    borderRadius: '10px',
                    overflow: 'hidden',
                    border: index === 0 ? '2px solid var(--aura-gold)' : '1px solid var(--border-subtle)',
                    backgroundColor: 'var(--aura-charcoal-deep)',
                    backgroundImage: `url(${photo.url})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: '6px',
                      left: '6px',
                      background: index === 0 ? 'var(--aura-gold)' : 'rgba(0,0,0,0.7)',
                      color: index === 0 ? '#000' : '#fff',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    {index === 0 ? '★ Primary' : `#${index + 1}`}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeletePhoto(photo.id)}
                    title="Remove Photo"
                    style={{
                      position: 'absolute',
                      top: '6px',
                      right: '6px',
                      background: 'rgba(0,0,0,0.75)',
                      border: 'none',
                      color: '#ff4d4d',
                      borderRadius: '50%',
                      width: '24px',
                      height: '24px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '0.8rem',
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}

              {/* Upload Slot */}
              {uploadedPhotos.length < 6 && (
                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    aspectRatio: '3/4',
                    borderRadius: '10px',
                    border: '2px dashed var(--border-gold)',
                    background: 'var(--aura-charcoal-deep)',
                    cursor: uploadingPhoto ? 'not-allowed' : 'pointer',
                    color: 'var(--aura-gold)',
                    padding: '0.5rem',
                    textAlign: 'center',
                  }}
                >
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handlePhotoSelect}
                    disabled={uploadingPhoto}
                    style={{ display: 'none' }}
                  />
                  {uploadingPhoto ? (
                    <span style={{ fontSize: '0.85rem' }}>Uploading...</span>
                  ) : (
                    <>
                      <span style={{ fontSize: '1.6rem', marginBottom: '0.25rem' }}>+</span>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Add Photo</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--aura-taupe)', marginTop: '2px' }}>JPEG, PNG, WebP</span>
                    </>
                  )}
                </label>
              )}
            </div>

            {photoUploadError && (
              <div
                role="alert"
                style={{
                  color: 'var(--aura-ruby, #ff4d4d)',
                  fontSize: '0.88rem',
                  padding: '0.75rem 1rem',
                  borderRadius: '6px',
                  background: 'var(--aura-oxblood-dim)',
                  border: '1px solid var(--aura-oxblood)',
                  marginBottom: '1.25rem',
                }}
              >
                {photoUploadError}
              </div>
            )}

            {uploadedPhotos.length < 3 && (
              <p style={{ color: 'var(--aura-taupe)', fontSize: '0.85rem', textAlign: 'center', margin: '0.5rem 0' }}>
                You must add at least 3 photos before entering discovery.
              </p>
            )}

            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
              <button type="button" onClick={() => setStep(4)} className="btn-ghost" style={{ flex: 1 }}>
                &larr; Back
              </button>
              <button
                type="button"
                onClick={handleComplete}
                disabled={loading || uploadingPhoto || uploadedPhotos.length < 3}
                className="btn-gold"
                style={{
                  flex: 2,
                  opacity: loading || uploadingPhoto || uploadedPhotos.length < 3 ? 0.5 : 1,
                  cursor: uploadedPhotos.length < 3 ? 'not-allowed' : 'pointer',
                }}
                title={uploadedPhotos.length < 3 ? `Add ${3 - uploadedPhotos.length} more photo(s) to continue` : ''}
              >
                {loading ? 'Finalizing Profile...' : 'Enter Discovery Sanctuary'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div style={{ textAlign: 'center', padding: '4rem', color: 'var(--aura-taupe)' }}>Loading onboarding experience...</div>}>
      <OnboardingContent />
    </Suspense>
  );
}
