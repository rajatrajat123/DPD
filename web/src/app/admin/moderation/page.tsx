'use client';

import React, { useEffect, useState } from 'react';

interface ModerationCase {
  id: string;
  target_user_id: string;
  category: string;
  priority: string;
  status: string;
  report_count: number;
  assigned_to_user_id?: string;
  created_at: string;
  updated_at: string;
}

interface MemberAppeal {
  id: string;
  user_id: string;
  case_id: string;
  reason: string;
  statement: string;
  status: string;
  reviewer_id?: string;
  created_at: string;
}

export default function ModerationAdminPage() {
  const [cases, setCases] = useState<ModerationCase[]>([]);
  const [appeals, setAppeals] = useState<MemberAppeal[]>([]);
  const [activeTab, setActiveTab] = useState<'cases' | 'appeals'>('cases');
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Action Modal State
  const [selectedCase, setSelectedCase] = useState<ModerationCase | null>(null);
  const [actionType, setActionType] = useState('WARN');
  const [actionRationale, setActionRationale] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);

  const fetchCases = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const url = statusFilter
        ? `/api/admin/moderation/cases?status=${statusFilter}`
        : '/api/admin/moderation/cases';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setCases(data.cases || []);
      }
    } catch (err) {
      console.error('Failed to load moderation cases:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAppeals = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/admin/moderation/appeals');
      if (res.ok) {
        const data = await res.json();
        setAppeals(data.appeals || []);
      }
    } catch (err) {
      console.error('Failed to load appeals:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'cases') {
      fetchCases();
    } else {
      fetchAppeals();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, statusFilter]);

  const handleExecuteAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;

    setSubmittingAction(true);
    setStatusMessage(null);

    try {
      const res = await fetch(`/api/admin/moderation/cases/${selectedCase.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: actionType,
          rationale: actionRationale,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Action failed');
      }

      setStatusMessage({ type: 'success', text: `Action ${actionType} successfully enforced on Case ${selectedCase.id}.` });
      setSelectedCase(null);
      setActionRationale('');
      fetchCases();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to enforce action' });
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleAppealDecision = async (appealId: string, decision: 'APPROVE' | 'DENY') => {
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/admin/moderation/appeals/${appealId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          rationale: `Appeal reviewed and ${decision.toLowerCase()}d by Trust & Safety`,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Appeal decision failed');
      }

      setStatusMessage({ type: 'success', text: `Appeal ${appealId} ${decision}D successfully.` });
      fetchAppeals();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to resolve appeal' });
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-[#161922] via-[#1A1D28] to-[#161922] border border-[#262a36] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-amber-400 font-bold mb-1">
            Trust & Safety Operations
          </div>
          <h1 className="text-2xl font-serif text-white font-medium">
            Community Moderation & Appeals Triage
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Review member reports, investigate predatory behavior or harassment, and enforce proportionate safety sanctions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
            🛡️ Zero-Tolerance Enforcement
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

      {/* Tabs & Filters */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 border-b border-[#262a36] pb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('cases')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition ${
              activeTab === 'cases'
                ? 'bg-amber-500 text-[#0d0f12] font-semibold'
                : 'text-neutral-400 hover:text-white hover:bg-[#1A1D28]'
            }`}
          >
            Moderation Cases ({cases.length})
          </button>
          <button
            onClick={() => setActiveTab('appeals')}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition ${
              activeTab === 'appeals'
                ? 'bg-amber-500 text-[#0d0f12] font-semibold'
                : 'text-neutral-400 hover:text-white hover:bg-[#1A1D28]'
            }`}
          >
            Member Appeals ({appeals.length})
          </button>
        </div>

        {activeTab === 'cases' && (
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-neutral-300 text-xs focus:outline-none focus:border-amber-400"
            >
              <option value="">All Case Statuses</option>
              <option value="OPEN">OPEN</option>
              <option value="INVESTIGATING">INVESTIGATING</option>
              <option value="ACTIONED">ACTIONED</option>
              <option value="DISMISSED">DISMISSED</option>
            </select>
          </div>
        )}
      </div>

      {/* Main Table Content */}
      <div className="p-6 rounded-2xl bg-[#14161F] border border-[#262a36]">
        {loading ? (
          <div className="py-12 text-center text-xs text-neutral-400">Loading moderation queue...</div>
        ) : activeTab === 'cases' ? (
          cases.length === 0 ? (
            <div className="py-12 text-center text-xs text-neutral-400">Queue clean: No pending moderation cases.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#262a36] text-neutral-400 uppercase text-[10px] font-mono">
                    <th className="py-3 px-3">Case ID</th>
                    <th className="py-3 px-3">Target Member</th>
                    <th className="py-3 px-3">Violation Category</th>
                    <th className="py-3 px-3">Priority</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Reports</th>
                    <th className="py-3 px-3">Created</th>
                    <th className="py-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202533]">
                  {cases.map((c) => (
                    <tr key={c.id} className="hover:bg-[#181c27] transition">
                      <td className="py-3 px-3 font-mono text-[#C3A15B] font-semibold">{c.id}</td>
                      <td className="py-3 px-3 font-mono text-neutral-300 truncate max-w-[120px]" title={c.target_user_id}>
                        {c.target_user_id}
                      </td>
                      <td className="py-3 px-3 font-medium text-white">{c.category}</td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            c.priority === 'CRITICAL'
                              ? 'bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse'
                              : c.priority === 'HIGH'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-neutral-800 text-neutral-300'
                          }`}
                        >
                          {c.priority}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-neutral-800 text-neutral-300">
                          {c.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono text-neutral-300">{c.report_count}</td>
                      <td className="py-3 px-3 font-mono text-neutral-400">
                        {new Date(c.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => setSelectedCase(c)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500 hover:text-black transition"
                        >
                          Triage & Act
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : appeals.length === 0 ? (
          <div className="py-12 text-center text-xs text-neutral-400">No member appeals pending review.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#262a36] text-neutral-400 uppercase text-[10px] font-mono">
                  <th className="py-3 px-3">Appeal ID</th>
                  <th className="py-3 px-3">Member ID</th>
                  <th className="py-3 px-3">Reason</th>
                  <th className="py-3 px-3">Statement</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202533]">
                {appeals.map((a) => (
                  <tr key={a.id} className="hover:bg-[#181c27] transition">
                    <td className="py-3 px-3 font-mono text-[#C3A15B]">{a.id}</td>
                    <td className="py-3 px-3 font-mono text-neutral-300">{a.user_id}</td>
                    <td className="py-3 px-3 text-white font-medium">{a.reason}</td>
                    <td className="py-3 px-3 text-neutral-400 max-w-xs truncate" title={a.statement}>
                      {a.statement}
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-neutral-800 text-neutral-300">
                        {a.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right space-x-2">
                      <button
                        onClick={() => handleAppealDecision(a.id, 'APPROVE')}
                        className="px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500 hover:text-black transition"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleAppealDecision(a.id, 'DENY')}
                        className="px-3 py-1 rounded-lg text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500 hover:text-white transition"
                      >
                        Deny
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Enforcement Action Modal */}
      {selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#151821] border border-amber-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setSelectedCase(null)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-white text-lg"
            >
              ✕
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                🛡️
              </div>
              <div>
                <h3 className="text-lg font-serif text-white font-medium">Execute Safety Enforcement</h3>
                <p className="text-xs text-neutral-400 font-mono">Case: {selectedCase.id}</p>
              </div>
            </div>

            <form onSubmit={handleExecuteAction} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-neutral-400 font-medium mb-1">
                  Enforcement Action
                </label>
                <select
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white text-sm focus:outline-none focus:border-amber-400"
                >
                  <option value="WARN">WARN — Send formal warning notification</option>
                  <option value="RESTRICT">RESTRICT — Limit messaging & discovery temporarily</option>
                  <option value="SUSPEND">SUSPEND — 7-day account suspension</option>
                  <option value="BAN">BAN — Permanent account revocation</option>
                  <option value="DISMISS">DISMISS — Mark report as unsubstantiated</option>
                </select>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-neutral-400 font-medium mb-1">
                  Enforcement Rationale / Audit Notes
                </label>
                <textarea
                  rows={3}
                  value={actionRationale}
                  onChange={(e) => setActionRationale(e.target.value)}
                  required
                  placeholder="Explain why this action was selected (mandatory for audit trail)..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white text-xs focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedCase(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-neutral-300 hover:bg-neutral-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAction}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-amber-500 text-[#0d0f12] hover:bg-amber-400 transition disabled:opacity-50"
                >
                  {submittingAction ? 'Enforcing...' : 'Enforce Action'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
