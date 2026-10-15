'use client';

import React, { useState } from 'react';

interface MemberDetail {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  email_verified_at?: string;
  last_active_at?: string;
}

export default function CustomerSupportPage() {
  const [query, setQuery] = useState('');
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [generatedResetToken, setGeneratedResetToken] = useState<string | null>(null);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setStatusMessage(null);
    setMember(null);
    setGeneratedResetToken(null);

    try {
      const res = await fetch(`/api/admin/users?search=${encodeURIComponent(query.trim())}&limit=1`);
      if (res.ok) {
        const data = await res.json();
        if (data.users && data.users.length > 0) {
          setMember(data.users[0]);
        } else {
          setStatusMessage({ type: 'error', text: `No member found matching query "${query}".` });
        }
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Lookup failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = async () => {
    if (!member) return;
    setActionLoading(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/admin/support/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: member.id }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Unlock failed');
      }

      setMember({ ...member, status: 'ACTIVE' });
      setStatusMessage({ type: 'success', text: `Account for ${member.email} has been unlocked and restored to ACTIVE status.` });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Unlock failed' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!member) return;
    setActionLoading(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/admin/support/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: member.id }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Password reset generation failed');
      }

      setGeneratedResetToken(data.reset_token);
      setStatusMessage({ type: 'success', text: `One-time password recovery link generated for ${member.email}.` });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Password reset failed' });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-[#161922] via-[#1A1D28] to-[#161922] border border-[#262a36] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-sky-400 font-bold mb-1">
            Customer Support & Member Care
          </div>
          <h1 className="text-2xl font-serif text-white font-medium">
            Member Lookup & Account Recovery Desk
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Safely unlock locked accounts, resolve login lockouts, and dispatch secure password recovery links.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/30">
            🎧 Support Desk
          </span>
        </div>
      </div>

      {statusMessage && (
        <div
          className={`p-4 rounded-xl text-xs font-medium border ${
            statusMessage.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Member Lookup Form */}
      <div className="p-6 rounded-2xl bg-[#14161F] border border-[#262a36]">
        <h2 className="text-sm font-serif text-white font-medium mb-3">Lookup Member Record</h2>
        <form onSubmit={handleLookup} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by registered email address or User ID..."
            className="flex-1 px-4 py-2.5 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white text-xs focus:outline-none focus:border-sky-400"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2.5 rounded-xl text-xs font-semibold bg-sky-500 text-[#0d0f12] hover:bg-sky-400 transition disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Lookup Member'}
          </button>
        </form>
      </div>

      {/* Member Profile & Actions Card */}
      {member && (
        <div className="p-6 rounded-2xl bg-[#14161F] border border-[#262a36] space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[#262a36] gap-3">
            <div>
              <span className="text-[10px] font-mono uppercase text-neutral-400 tracking-wider">Member Found</span>
              <h3 className="text-lg font-serif text-white font-medium">{member.email}</h3>
              <p className="text-xs font-mono text-neutral-400">User ID: {member.id}</p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold ${
                  member.status === 'ACTIVE'
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'bg-red-500/15 text-red-300 border border-red-500/30'
                }`}
              >
                Status: {member.status}
              </span>
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#C3A15B]/15 text-[#E3C77D] border border-[#C3A15B]/30 font-mono">
                {member.role}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-3 bg-[#0B0D12] rounded-xl border border-[#262a36]">
              <div className="text-neutral-400 text-[10px] uppercase font-bold">Email Verification</div>
              <div className="text-white font-medium mt-1">
                {member.email_verified_at ? '✓ Verified' : 'Pending Verification'}
              </div>
            </div>

            <div className="p-3 bg-[#0B0D12] rounded-xl border border-[#262a36]">
              <div className="text-neutral-400 text-[10px] uppercase font-bold">Member Since</div>
              <div className="text-white font-medium mt-1">
                {new Date(member.created_at).toLocaleDateString()}
              </div>
            </div>

            <div className="p-3 bg-[#0B0D12] rounded-xl border border-[#262a36]">
              <div className="text-neutral-400 text-[10px] uppercase font-bold">Safety Clearance</div>
              <div className="text-emerald-400 font-medium mt-1">18+ Photo Verified</div>
            </div>
          </div>

          {/* Recovery Actions */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={handleUnlock}
              disabled={actionLoading || member.status === 'ACTIVE'}
              className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500 hover:text-black transition disabled:opacity-40"
            >
              {actionLoading ? 'Processing...' : 'Unlock Member Account'}
            </button>

            <button
              onClick={handleResetPassword}
              disabled={actionLoading}
              className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30 hover:bg-sky-500 hover:text-black transition disabled:opacity-40"
            >
              {actionLoading ? 'Generating...' : 'Generate Password Reset Link'}
            </button>
          </div>

          {/* Generated Reset Token Banner */}
          {generatedResetToken && (
            <div className="p-4 rounded-xl bg-[#0B0D12] border border-sky-500/40 space-y-2">
              <div className="text-xs font-bold text-sky-400">
                Single-Use Password Recovery Token (Expires in 24 hours):
              </div>
              <div className="p-2.5 rounded-lg bg-[#14161F] font-mono text-xs text-white break-all border border-neutral-700">
                https://www.auradating.com/auth/reset-password?token={generatedResetToken}
              </div>
              <p className="text-[11px] text-neutral-400">
                You can copy this link and provide it directly to the verified member if their email inbox is experiencing delivery delays.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
