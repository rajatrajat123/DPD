'use client';

import React, { useState } from 'react';
import Link from 'next/link';

export default function AccountDeletionPage() {
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('no_longer_needed');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email || !email.includes('@')) {
      setError('Please provide a valid email address.');
      return;
    }
    if (!confirmed) {
      setError('Please confirm that you understand account deletion is permanent.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/deletion-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          reason,
          confirm_deletion: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to submit deletion request.');
      }

      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again or contact support.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0b0b0c] text-[#f5f5f7] py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-12">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full border-2 border-[#d4af37] text-[#d4af37] text-2xl font-bold tracking-widest mx-auto">
            A
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            Account Deletion &amp; Data Erasure
          </h1>
          <p className="text-lg text-neutral-400 max-w-xl mx-auto">
            Aura complies fully with Google Play policies and global data protection regulations (GDPR &amp; CCPA), providing transparent, irrevocable control over your personal data.
          </p>
        </div>

        {/* In-App Deletion Instructions */}
        <section className="bg-[#161618] border border-[#2a2a2e] rounded-2xl p-6 sm:p-8 space-y-4">
          <h2 className="text-xl font-bold text-[#d4af37] flex items-center gap-2">
            <span>📱</span> Recommended: Delete Instantly Inside the Aura App
          </h2>
          <p className="text-neutral-300">
            For fastest execution with instant cryptographic session revocation, delete your account directly inside the Aura mobile application:
          </p>
          <ol className="list-decimal list-inside space-y-2 text-neutral-300 ml-2">
            <li>Open the Aura app on your mobile device.</li>
            <li>Navigate to the <strong>Profile</strong> tab (bottom right) and tap <strong>Settings (gear icon)</strong>.</li>
            <li>Scroll to the <strong>Account &amp; Security</strong> section and tap <strong>Delete Account</strong>.</li>
            <li>Read the permanent deletion warning and enter your password to confirm.</li>
          </ol>
          <p className="text-sm text-neutral-400 italic">
            This immediately unlinks all OAuth sessions, removes your profile from discovery, redacts chat history, and purges all personal photos and preferences.
          </p>
        </section>

        {/* Subscription Notice Alert */}
        <div className="bg-[#241c0e] border border-[#d4af37]/40 rounded-2xl p-6 sm:p-8 space-y-3">
          <div className="flex items-center gap-3 text-[#d4af37]">
            <span className="text-2xl">⚠️</span>
            <h3 className="text-lg font-bold">Important Notice Regarding App Store Subscriptions</h3>
          </div>
          <p className="text-sm text-neutral-200 leading-relaxed">
            Deleting your Aura account <strong>does not automatically cancel recurring subscriptions</strong> purchased through Google Play or Apple App Store. Per platform store guidelines, recurring billing is managed exclusively by Apple and Google.
          </p>
          <div className="pt-2 flex flex-col sm:flex-row gap-4">
            <a
              href="https://play.google.com/store/account/subscriptions"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-[#2a2a2e] hover:bg-[#333338] text-white text-sm font-semibold transition-colors"
            >
              Google Play Subscriptions ↗
            </a>
            <a
              href="https://apps.apple.com/account/subscriptions"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-[#2a2a2e] hover:bg-[#333338] text-white text-sm font-semibold transition-colors"
            >
              Apple App Store Subscriptions ↗
            </a>
          </div>
        </div>

        {/* What gets deleted / retained */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-[#161618] border border-[#2a2a2e] rounded-xl p-6 space-y-3">
            <h3 className="font-bold text-white flex items-center gap-2">
              <span className="text-red-400">✕</span> What Data is Permanently Erased
            </h3>
            <ul className="text-sm text-neutral-400 space-y-1.5 list-disc list-inside">
              <li>Profile data (bio, age, gender, pronouns, preferences)</li>
              <li>All uploaded gallery &amp; verification photos and videos</li>
              <li>Real-time GPS coordinates &amp; location history</li>
              <li>All chat messages, voice notes &amp; read receipts</li>
              <li>Swipes, matches, blocks &amp; user favourites</li>
              <li>Google OAuth identity tokens &amp; push notification tokens</li>
            </ul>
          </div>
          <div className="bg-[#161618] border border-[#2a2a2e] rounded-xl p-6 space-y-3">
            <h3 className="font-bold text-white flex items-center gap-2">
              <span className="text-yellow-400">⚖️</span> What Data is Retained
            </h3>
            <p className="text-sm text-neutral-400 leading-relaxed">
              Statutory accounting &amp; tax compliance laws require Aura to maintain immutable financial transaction records (such as payment receipts and affiliate payouts).
            </p>
            <p className="text-sm text-neutral-400 leading-relaxed">
              These records are strictly retained under an <strong>anonymized system identifier</strong> with zero personal identifiers (no name, email, phone, or location).
            </p>
          </div>
        </div>

        {/* Web Deletion Form (Google Play Compliance) */}
        <section className="bg-[#161618] border border-[#2a2a2e] rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-white">Web-Based Account Deletion Request</h2>
            <p className="text-sm text-neutral-400">
              If you have uninstalled the app or cannot access your phone, submit your registered Aura email below. We will verify and process your deletion request.
            </p>
          </div>

          {submitted ? (
            <div className="bg-[#112417] border border-green-500/40 rounded-xl p-6 text-center space-y-3" test-id="deletion-success-banner">
              <span className="text-3xl">✓</span>
              <h3 className="text-lg font-bold text-green-400">Deletion Request Received</h3>
              <p className="text-sm text-neutral-300 max-w-md mx-auto">
                Your request has been securely queued. If an active account matches the email address provided, all personal data will be irrevocably deleted and all active sessions terminated.
              </p>
              <Link href="/" className="inline-block pt-2 text-[#d4af37] font-semibold text-sm hover:underline">
                Return to Aura Home
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="p-4 rounded-lg bg-red-950/50 border border-red-500/40 text-red-200 text-sm">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-neutral-300 mb-2">
                  Aura Account Email Address <span className="text-red-400">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jordan@example.com"
                  className="w-full bg-[#0b0b0c] border border-[#2a2a2e] focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] rounded-lg px-4 py-3 text-white placeholder-neutral-600 outline-none transition"
                />
              </div>

              <div>
                <label htmlFor="reason" className="block text-sm font-medium text-neutral-300 mb-2">
                  Reason for Leaving (Optional)
                </label>
                <select
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full bg-[#0b0b0c] border border-[#2a2a2e] focus:border-[#d4af37] rounded-lg px-4 py-3 text-white outline-none transition"
                >
                  <option value="met_someone">I met someone special</option>
                  <option value="taking_a_break">Taking a break from dating</option>
                  <option value="privacy_concerns">Privacy preferences</option>
                  <option value="no_longer_needed">No longer need the service</option>
                  <option value="other">Other reason</option>
                </select>
              </div>

              <div className="flex items-start gap-3 pt-2">
                <input
                  id="confirm"
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-[#2a2a2e] bg-[#0b0b0c] text-[#d4af37] focus:ring-[#d4af37]"
                />
                <label htmlFor="confirm" className="text-sm text-neutral-300 leading-snug">
                  I understand that this action is permanent and irreversible. My profile, messages, matches, and uploaded media will be completely erased.
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 px-6 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-sm tracking-wide transition-colors flex items-center justify-center gap-2"
              >
                {loading ? 'Processing Deletion Request...' : 'Permanently Delete My Aura Account'}
              </button>
            </form>
          )}
        </section>

        {/* Footer Navigation */}
        <div className="pt-8 border-t border-[#2a2a2e] text-center text-sm text-neutral-500 space-x-6">
          <Link href="/legal/privacy" className="hover:text-neutral-300 transition-colors">
            Privacy Policy
          </Link>
          <span>•</span>
          <Link href="/legal/terms" className="hover:text-neutral-300 transition-colors">
            Terms of Service
          </Link>
          <span>•</span>
          <Link href="/safety" className="hover:text-neutral-300 transition-colors">
            Community Guidelines
          </Link>
        </div>
      </div>
    </main>
  );
}
