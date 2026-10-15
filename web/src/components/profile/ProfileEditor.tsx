'use client';

import React, { useState, useEffect } from 'react';

interface ProfileData {
  display_name: string;
  birthdate: string;
  bio: string;
  pronouns: string[];
  gender_identities: string[];
  sexual_orientations: string[];
  relationship_intents: string[];
  relationship_structure: string;
  is_photo_verified: boolean;
  discrete_mode_enabled: boolean;
  incognito_enabled: boolean;
  smoking_habit?: string;
  drinking_habit?: string;
}

interface PreferenceData {
  min_age: number;
  max_age: number;
  max_distance_km: number;
  preferred_genders: string[];
  preferred_intents: string[];
  verified_profiles_only: boolean;
  non_smoker_only: boolean;
  require_monogamous: boolean;
}

interface NotificationPrefs {
  match_notifications: boolean;
  message_notifications: boolean;
  discovery_notifications: boolean;
  billing_notifications: boolean;
  security_alerts: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start_utc: number;
  quiet_hours_end_utc: number;
}

interface GalleryAsset {
  id: string;
  display_order: number;
  derivatives?: Array<{ url: string; variant: string }>;
}

export function ProfileEditor() {
  const [activeTab, setActiveTab] = useState<'profile' | 'gallery' | 'preferences' | 'privacy' | 'notifications'>('profile');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [gallery, setGallery] = useState<GalleryAsset[]>([]);
  const [uploadingGallery, setUploadingGallery] = useState(false);

  const [profile, setProfile] = useState<ProfileData>({
    display_name: '',
    birthdate: '1995-06-15',
    bio: '',
    pronouns: ['they/them'],
    gender_identities: ['non-binary'],
    sexual_orientations: ['queer'],
    relationship_intents: ['serious dating'],
    relationship_structure: 'MONOGAMOUS',
    is_photo_verified: true,
    discrete_mode_enabled: false,
    incognito_enabled: false,
  });

  const [preferences, setPreferences] = useState<PreferenceData>({
    min_age: 21,
    max_age: 45,
    max_distance_km: 50,
    preferred_genders: ['non-binary', 'queer', 'transgender woman', 'cisgender woman'],
    preferred_intents: ['serious dating'],
    verified_profiles_only: false,
    non_smoker_only: true,
    require_monogamous: false,
  });

  const [notifications, setNotifications] = useState<NotificationPrefs>({
    match_notifications: true,
    message_notifications: true,
    discovery_notifications: true,
    billing_notifications: true,
    security_alerts: true,
    quiet_hours_enabled: false,
    quiet_hours_start_utc: 22,
    quiet_hours_end_utc: 8,
  });

  const loadGallery = async () => {
    try {
      const res = await fetch('/api/v1/media/gallery/me');
      if (res.ok) {
        const data = await res.json();
        setGallery(data.assets || []);
      }
    } catch {
      // ignore
    }
  };

  const handleUploadGalleryPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingGallery(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('purpose', 'PROFILE_GALLERY');
      formData.append('media_type', 'IMAGE');

      const res = await fetch('/api/v1/media/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        if (errJson?.error?.code === 'MODERATION_REJECTED') {
          throw new Error('Photo was rejected by safety moderation. Please choose an appropriate photo.');
        }
        throw new Error(errJson?.error?.message || 'Upload failed');
      }
      await loadGallery();
      setMessage({ text: 'Photo uploaded successfully.', type: 'success' });
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : 'Could not upload photo.', type: 'error' });
    } finally {
      setUploadingGallery(false);
      e.target.value = '';
    }
  };

  const handleDeleteGalleryPhoto = async (assetId: string) => {
    if (!confirm('Are you sure you want to remove this photo?')) return;
    try {
      const res = await fetch(`/api/v1/media/${assetId}`, { method: 'DELETE' });
      if (res.ok) {
        setGallery((prev) => prev.filter((item) => item.id !== assetId));
        setMessage({ text: 'Photo deleted.', type: 'success' });
      } else {
        const errJson = await res.json().catch(() => null);
        setMessage({
          text: errJson?.error?.message || 'Could not delete photo: active profiles must maintain at least 3 approved profile photos.',
          type: 'error',
        });
      }
    } catch {
      setMessage({ text: 'Could not delete photo.', type: 'error' });
    }
  };

  const handleMoveGalleryPhoto = async (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= gallery.length) return;
    const reordered = [...gallery];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setGallery(reordered);

    const assetIds = reordered.map((a) => a.id);
    try {
      await fetch('/api/v1/media/gallery/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_ids: assetIds }),
      });
      setMessage({ text: 'Gallery order updated.', type: 'success' });
    } catch {
      setMessage({ text: 'Could not save gallery order.', type: 'error' });
      await loadGallery();
    }
  };

  useEffect(() => {
    async function loadData() {
      try {
        const [profRes, prefRes, notifRes, galRes] = await Promise.all([
          fetch('/api/v1/profiles/me'),
          fetch('/api/v1/profiles/me/preferences'),
          fetch('/api/v1/notifications/preferences'),
          fetch('/api/v1/media/gallery/me'),
        ]);

        if (profRes.ok) {
          const raw = await profRes.json();
          const p = raw.profile || raw;
          setProfile((prev) => ({
            ...prev,
            display_name: p.display_name ?? prev.display_name,
            birthdate: p.birthdate ? p.birthdate.split('T')[0] : prev.birthdate,
            bio: p.bio ?? prev.bio,
            pronouns: Array.isArray(p.pronouns) && p.pronouns.length > 0 ? p.pronouns : prev.pronouns,
            gender_identities: Array.isArray(p.gender_identities) && p.gender_identities.length > 0 ? p.gender_identities : prev.gender_identities,
            sexual_orientations: Array.isArray(p.sexual_orientations) && p.sexual_orientations.length > 0 ? p.sexual_orientations : prev.sexual_orientations,
            relationship_intents: Array.isArray(p.relationship_intents) && p.relationship_intents.length > 0 ? p.relationship_intents : prev.relationship_intents,
            relationship_structure: p.relationship_structure ?? prev.relationship_structure,
            is_photo_verified: p.is_photo_verified ?? prev.is_photo_verified,
            discrete_mode_enabled: p.discrete_mode_enabled ?? prev.discrete_mode_enabled,
            incognito_enabled: p.incognito_enabled ?? prev.incognito_enabled,
            smoking_habit: p.smoking_habit ?? prev.smoking_habit,
            drinking_habit: p.drinking_habit ?? prev.drinking_habit,
          }));
        }
        if (prefRes.ok) {
          const pref = await prefRes.json();
          setPreferences((prev) => ({
            ...prev,
            min_age: pref.min_age ?? prev.min_age,
            max_age: pref.max_age ?? prev.max_age,
            max_distance_km: pref.max_distance_km ?? prev.max_distance_km,
            preferred_genders: Array.isArray(pref.preferred_genders) && pref.preferred_genders.length > 0 ? pref.preferred_genders : prev.preferred_genders,
            preferred_intents: Array.isArray(pref.preferred_intents) && pref.preferred_intents.length > 0 ? pref.preferred_intents : prev.preferred_intents,
            verified_profiles_only: pref.verified_profiles_only ?? pref.dealbreakers?.require_verified ?? prev.verified_profiles_only,
            non_smoker_only: pref.dealbreakers?.non_smoker_only ?? pref.non_smoker_only ?? prev.non_smoker_only,
            require_monogamous: pref.dealbreakers?.require_monogamous ?? pref.require_monogamous ?? prev.require_monogamous,
          }));
        }
        if (notifRes.ok) {
          const n = await notifRes.json();
          setNotifications((prev) => ({ ...prev, ...n }));
        }
        if (galRes.ok) {
          const g = await galRes.json();
          setGallery(g.assets || []);
        }
      } catch {
        // Fallback to local defaults
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const updatePayload: Record<string, any> = {
      display_name: profile.display_name,
      bio: profile.bio,
      pronouns: profile.pronouns,
      gender_identities: profile.gender_identities,
      sexual_orientations: profile.sexual_orientations,
      relationship_intents: profile.relationship_intents,
      relationship_structure: profile.relationship_structure,
      discrete_mode_enabled: profile.discrete_mode_enabled,
      incognito_enabled: profile.incognito_enabled,
    };
    if (profile.smoking_habit) updatePayload.smoking_habit = profile.smoking_habit;
    if (profile.drinking_habit) updatePayload.drinking_habit = profile.drinking_habit;

    try {
      const res = await fetch('/api/v1/profiles/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || errJson?.message || 'Failed to update profile');
      }
      setMessage({ text: 'Profile changes saved successfully.', type: 'success' });
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : 'Error saving profile', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const updatePayload = {
      min_age: preferences.min_age,
      max_age: preferences.max_age,
      max_distance_km: preferences.max_distance_km,
      preferred_genders: preferences.preferred_genders,
      preferred_intents: preferences.preferred_intents,
      verified_profiles_only: preferences.verified_profiles_only,
      dealbreakers: {
        non_smoker_only: preferences.non_smoker_only,
        require_monogamous: preferences.require_monogamous,
        require_verified: preferences.verified_profiles_only,
      },
    };

    try {
      const res = await fetch('/api/v1/profiles/me/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || errJson?.message || 'Failed to update dating preferences');
      }
      setMessage({ text: 'Dating preferences and dealbreakers saved.', type: 'success' });
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : 'Error saving preferences', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNotifications = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/v1/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notifications),
      });
      if (!res.ok) throw new Error('Failed to update notification settings');
      setMessage({ text: 'Notification preferences updated.', type: 'success' });
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : 'Error updating notifications', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--aura-taupe)' }}>
        Loading member account settings...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '780px', margin: '0 auto' }}>
      {/* Account Overview Bar */}
      <div className="card" style={{ marginBottom: '2rem', padding: '1.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'var(--aura-charcoal-deep)',
              border: '2px solid var(--border-gold)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.75rem',
            }}
          >
            👤
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h2 style={{ fontSize: '1.4rem', margin: 0 }}>{profile.display_name || 'Aura Member'}</h2>
              {profile.is_photo_verified && (
                <span className="badge-gold" title="Biometrically Verified Photo">
                  ✓ Verified
                </span>
              )}
            </div>
            <p style={{ color: 'var(--aura-taupe)', fontSize: '0.88rem', margin: 0 }}>
              Pronouns: {profile.pronouns.join(', ')} • 18+ Verified Member
            </p>
          </div>
        </div>

        <form action="/api/auth/logout" method="POST">
          <button type="submit" className="btn-secondary" style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}>
            Sign Out
          </button>
        </form>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', marginBottom: '2rem', overflowX: 'auto' }}>
        {[
          { key: 'profile', label: 'Profile Details' },
          { key: 'gallery', label: 'Photo Gallery' },
          { key: 'preferences', label: 'Discovery & Dealbreakers' },
          { key: 'privacy', label: 'Discretion & Privacy' },
          { key: 'notifications', label: 'Notifications' },
        ].map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setActiveTab(tab.key as any);
                setMessage(null);
              }}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: active ? '2px solid var(--aura-gold)' : '2px solid transparent',
                color: active ? 'var(--aura-gold)' : 'var(--aura-taupe)',
                fontWeight: active ? 600 : 500,
                padding: '0.75rem 1.25rem',
                cursor: 'pointer',
                fontSize: '0.95rem',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {message && (
        <div
          role="alert"
          style={{
            padding: '0.85rem 1.25rem',
            borderRadius: '6px',
            marginBottom: '1.5rem',
            background: message.type === 'success' ? 'var(--aura-gold-dim)' : 'var(--aura-oxblood-dim)',
            border: `1px solid ${message.type === 'success' ? 'var(--border-gold)' : 'var(--aura-oxblood)'}`,
            color: 'var(--aura-ivory)',
            fontSize: '0.92rem',
          }}
        >
          {message.text}
        </div>
      )}

      {/* TAB 1: Profile Details */}
      {activeTab === 'profile' && (
        <form onSubmit={handleSaveProfile} className="card">
          <h3 style={{ marginBottom: '1.5rem' }}>Personal Profile Details</h3>

          <div className="form-group">
            <label htmlFor="displayName" className="form-label">
              Display Name
            </label>
            <input
              id="displayName"
              type="text"
              value={profile.display_name}
              onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
              className="form-input"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="bio" className="form-label">
              About You / Bio
            </label>
            <textarea
              id="bio"
              rows={4}
              value={profile.bio}
              onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
              className="form-textarea"
              maxLength={500}
            />
          </div>

          <div className="form-group">
            <label htmlFor="relStructure" className="form-label">
              Relationship Structure
            </label>
            <select
              id="relStructure"
              value={profile.relationship_structure}
              onChange={(e) => setProfile({ ...profile, relationship_structure: e.target.value })}
              className="form-select"
            >
              <option value="MONOGAMOUS">Monogamous</option>
              <option value="ENM">Ethically Non-Monogamous (ENM)</option>
              <option value="POLYAMOROUS">Polyamorous</option>
              <option value="OPEN">Open Relationship</option>
              <option value="EXPLORING">Exploring</option>
            </select>
          </div>

          <button type="submit" disabled={saving} className="btn-gold" style={{ marginTop: '1rem', width: 'fit-content' }}>
            {saving ? 'Saving...' : 'Save Profile Details'}
          </button>
        </form>
      )}

      {/* TAB 2: Photo Gallery */}
      {activeTab === 'gallery' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, marginBottom: '0.25rem' }}>Profile Photos</h3>
              <p style={{ color: 'var(--aura-taupe)', fontSize: '0.88rem', margin: 0 }}>
                Photos are ordered from primary (#1) to supporting. EXIF and GPS tags are automatically stripped.
              </p>
            </div>
            <label className="btn-gold" style={{ cursor: 'pointer', display: 'inline-block' }}>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleUploadGalleryPhoto}
                disabled={uploadingGallery}
                style={{ display: 'none' }}
              />
              {uploadingGallery ? 'Uploading...' : '+ Add Photo'}
            </label>
          </div>

          {/* Photo count progress banner */}
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              marginBottom: '1.25rem',
              background: gallery.length >= 3 ? 'rgba(46, 125, 50, 0.15)' : 'var(--aura-oxblood-dim)',
              border: gallery.length >= 3 ? '1px solid rgba(76, 175, 80, 0.4)' : '1px solid var(--aura-oxblood)',
              fontSize: '0.88rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>
              {gallery.length >= 3
                ? `✓ ${gallery.length} of 3 approved photos — Profile visible in discovery.`
                : `⚠️ ${gallery.length} of 3 approved photos. Active profiles must maintain at least 3 approved photos for discovery visibility.`}
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--aura-taupe)' }}>
              Minimum: 3 photos
            </span>
          </div>

          {gallery.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', background: 'var(--aura-charcoal-deep)', borderRadius: '10px', border: '1px dashed var(--border-subtle)' }}>
              <p style={{ color: 'var(--aura-taupe)', marginBottom: '1rem' }}>No photos in your gallery yet.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1.25rem' }}>
              {gallery.map((asset, index) => {
                const streamUrl = asset.derivatives?.[0]?.url || `/api/v1/media/${asset.id}`;
                return (
                  <div
                    key={asset.id}
                    style={{
                      position: 'relative',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      border: index === 0 ? '2px solid var(--aura-gold)' : '1px solid var(--border-subtle)',
                      background: 'var(--aura-charcoal-deep)',
                    }}
                  >
                    <div
                      style={{
                        width: '100%',
                        paddingTop: '130%',
                        backgroundImage: `url(${streamUrl})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        top: '8px',
                        left: '8px',
                        background: index === 0 ? 'var(--aura-gold)' : 'rgba(0,0,0,0.7)',
                        color: index === 0 ? '#000' : '#fff',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '4px',
                      }}
                    >
                      {index === 0 ? '★ Primary' : `#${index + 1}`}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteGalleryPhoto(asset.id)}
                      title="Delete Photo"
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        background: 'rgba(0,0,0,0.75)',
                        border: 'none',
                        color: '#ff4d4d',
                        borderRadius: '50%',
                        width: '26px',
                        height: '26px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                      }}
                    >
                      ✕
                    </button>

                    <div
                      style={{
                        position: 'absolute',
                        bottom: '8px',
                        right: '8px',
                        display: 'flex',
                        gap: '4px',
                      }}
                    >
                      {index > 0 && (
                        <button
                          type="button"
                          onClick={() => handleMoveGalleryPhoto(index, index - 1)}
                          title="Move Earlier"
                          style={{
                            background: 'rgba(0,0,0,0.75)',
                            border: 'none',
                            color: 'var(--aura-gold)',
                            borderRadius: '4px',
                            padding: '4px 8px',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                          }}
                        >
                          ◀
                        </button>
                      )}
                      {index < gallery.length - 1 && (
                        <button
                          type="button"
                          onClick={() => handleMoveGalleryPhoto(index, index + 1)}
                          title="Move Later"
                          style={{
                            background: 'rgba(0,0,0,0.75)',
                            border: 'none',
                            color: 'var(--aura-gold)',
                            borderRadius: '4px',
                            padding: '4px 8px',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                          }}
                        >
                          ▶
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Preferences & Dealbreakers */}
      {activeTab === 'preferences' && (
        <form onSubmit={handleSavePreferences} className="card">
          <h3 style={{ marginBottom: '1.5rem' }}>Discovery Filters &amp; Hard Dealbreakers</h3>

          <div className="form-group">
            <label className="form-label">
              Age Range: {preferences.min_age} to {preferences.max_age} years
            </label>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <input
                type="range"
                min={18}
                max={75}
                value={preferences.min_age}
                onChange={(e) => setPreferences({ ...preferences, min_age: Number(e.target.value) })}
                style={{ flex: 1, accentColor: 'var(--aura-gold)' }}
              />
              <input
                type="range"
                min={18}
                max={75}
                value={preferences.max_age}
                onChange={(e) => setPreferences({ ...preferences, max_age: Number(e.target.value) })}
                style={{ flex: 1, accentColor: 'var(--aura-gold)' }}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              Maximum Distance: {preferences.max_distance_km} km
            </label>
            <input
              type="range"
              min={5}
              max={300}
              value={preferences.max_distance_km}
              onChange={(e) => setPreferences({ ...preferences, max_distance_km: Number(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--aura-gold)' }}
            />
          </div>

          <div style={{ background: 'var(--aura-charcoal-deep)', padding: '1.25rem', borderRadius: '8px', border: '1px solid var(--border-gold)', margin: '1rem 0' }}>
            <h4 style={{ fontSize: '1rem', color: 'var(--aura-gold)', marginBottom: '0.75rem' }}>
              ⚖️ Bilateral Dealbreakers (Authoritative)
            </h4>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={preferences.non_smoker_only}
                onChange={(e) => setPreferences({ ...preferences, non_smoker_only: e.target.checked })}
                style={{ accentColor: 'var(--aura-gold)', width: '18px', height: '18px' }}
              />
              <span style={{ fontSize: '0.92rem' }}>
                <strong>Non-Smoker Only:</strong> Exclude smokers from discovery feed.
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={preferences.verified_profiles_only}
                onChange={(e) => setPreferences({ ...preferences, verified_profiles_only: e.target.checked })}
                style={{ accentColor: 'var(--aura-gold)', width: '18px', height: '18px' }}
              />
              <span style={{ fontSize: '0.92rem' }}>
                <strong>Verified Profiles Only:</strong> Match only with biometrically verified accounts.
              </span>
            </label>
          </div>

          <button type="submit" disabled={saving} className="btn-gold" style={{ marginTop: '1rem', width: 'fit-content' }}>
            {saving ? 'Saving...' : 'Save Preferences'}
          </button>
        </form>
      )}

      {/* TAB 3: Discretion & Privacy */}
      {activeTab === 'privacy' && (
        <form onSubmit={handleSaveProfile} className="card">
          <h3 style={{ marginBottom: '1.5rem' }}>Privacy &amp; Discretion Settings</h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '1.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={profile.discrete_mode_enabled}
                onChange={(e) => setProfile({ ...profile, discrete_mode_enabled: e.target.checked })}
                style={{ accentColor: 'var(--aura-gold)', width: '20px', height: '20px', marginTop: '0.2rem' }}
              />
              <div>
                <strong style={{ color: 'var(--aura-ivory)', display: 'block' }}>Discrete Display Mode</strong>
                <span style={{ color: 'var(--aura-taupe)', fontSize: '0.88rem' }}>
                  Suppresses explicit branding and labels when using the app in public environments.
                </span>
              </div>
            </label>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={profile.incognito_enabled}
                onChange={(e) => setProfile({ ...profile, incognito_enabled: e.target.checked })}
                style={{ accentColor: 'var(--aura-gold)', width: '20px', height: '20px', marginTop: '0.2rem' }}
              />
              <div>
                <strong style={{ color: 'var(--aura-ivory)', display: 'block' }}>Incognito Mode (Elite Perk)</strong>
                <span style={{ color: 'var(--aura-taupe)', fontSize: '0.88rem' }}>
                  Renders your card completely invisible in discovery until you express a direct Like on a candidate.
                </span>
              </div>
            </label>
          </div>

          <button type="submit" disabled={saving} className="btn-gold" style={{ width: 'fit-content' }}>
            {saving ? 'Saving...' : 'Save Privacy Controls'}
          </button>
        </form>
      )}

      {/* TAB 4: Notifications */}
      {activeTab === 'notifications' && (
        <form onSubmit={handleSaveNotifications} className="card">
          <h3 style={{ marginBottom: '1.5rem' }}>Notification Preferences</h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '1.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={notifications.match_notifications}
                onChange={(e) => setNotifications({ ...notifications, match_notifications: e.target.checked })}
                style={{ accentColor: 'var(--aura-gold)', width: '18px', height: '18px' }}
              />
              <span style={{ fontSize: '0.92rem' }}>Mutual Match Notifications</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={notifications.message_notifications}
                onChange={(e) => setNotifications({ ...notifications, message_notifications: e.target.checked })}
                style={{ accentColor: 'var(--aura-gold)', width: '18px', height: '18px' }}
              />
              <span style={{ fontSize: '0.92rem' }}>New Message Notifications</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={notifications.discovery_notifications}
                onChange={(e) => setNotifications({ ...notifications, discovery_notifications: e.target.checked })}
                style={{ accentColor: 'var(--aura-gold)', width: '18px', height: '18px' }}
              />
              <span style={{ fontSize: '0.92rem' }}>New Verified Members Nearby</span>
            </label>

            <div style={{ background: 'var(--aura-charcoal-deep)', padding: '1rem', borderRadius: '8px' }}>
              <p style={{ color: 'var(--aura-taupe)', fontSize: '0.85rem', margin: 0 }}>
                🛡️ <strong>Security Alerts:</strong> Account security notifications, login alerts, and password recovery emails are mandatory and cannot be disabled.
              </p>
            </div>
          </div>

          <button type="submit" disabled={saving} className="btn-gold" style={{ width: 'fit-content' }}>
            {saving ? 'Saving...' : 'Update Notifications'}
          </button>
        </form>
      )}
    </div>
  );
}
