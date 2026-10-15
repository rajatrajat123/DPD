'use client';

import React, { useEffect, useState } from 'react';
import { useStepUp } from '../StepUpContext';

interface AffiliateItem {
  id: string;
  user_id: string;
  partner_code: string;
  display_name: string;
  status: string;
  tier: string;
  created_at: string;
}

interface CommissionRule {
  id: string;
  plan_code: string;
  commission_percentage: number;
  tier: string;
  is_active: boolean;
}

interface PayoutRequest {
  id: string;
  affiliate_id: string;
  amount_cents: number;
  currency: string;
  payout_method: string;
  status: string;
  created_at: string;
}

export default function AffiliateAdminPage() {
  const [activeTab, setActiveTab] = useState<'affiliates' | 'rules' | 'payouts'>('affiliates');
  const [affiliates, setAffiliates] = useState<AffiliateItem[]>([]);
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { openStepUpModal, stepUpToken } = useStepUp();

  const fetchAffiliates = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/admin/affiliates');
      if (res.ok) {
        const data = await res.json();
        setAffiliates(data.affiliates || []);
      }
    } catch (err) {
      console.error('Failed to load affiliates:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRules = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/admin/commission-rules');
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules || []);
      }
    } catch (err) {
      console.error('Failed to load rules:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPayouts = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/admin/payouts');
      if (res.ok) {
        const data = await res.json();
        setPayouts(data.payouts || []);
      }
    } catch (err) {
      console.error('Failed to load payouts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'affiliates') fetchAffiliates();
    else if (activeTab === 'rules') fetchRules();
    else fetchPayouts();
  }, [activeTab]);

  const handleUpdateStatus = async (affiliateId: string, status: 'APPROVED' | 'REJECTED') => {
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/admin/affiliates/${affiliateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Status update failed');
      }

      setStatusMessage({ type: 'success', text: `Affiliate ${affiliateId} status updated to ${status}.` });
      fetchAffiliates();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Action failed' });
    }
  };

  const handleApprovePayout = (payoutId: string) => {
    setStatusMessage(null);

    const executePayout = async (token: string) => {
      try {
        const res = await fetch(`/api/admin/payouts/${payoutId}/approve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Aura-Step-Up': token,
          },
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error?.message || data.message || 'Payout approval failed');
        }

        setStatusMessage({ type: 'success', text: `Payout ${payoutId} approved and disbursement ledger committed.` });
        fetchPayouts();
      } catch (err: any) {
        setStatusMessage({ type: 'error', text: err.message || 'Payout approval failed' });
      }
    };

    if (stepUpToken) {
      executePayout(stepUpToken);
    } else {
      openStepUpModal(executePayout);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-[#161922] via-[#1A1D28] to-[#161922] border border-[#262a36] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-pink-400 font-bold mb-1">
            Affiliate & Growth Ecosystem
          </div>
          <h1 className="text-2xl font-serif text-white font-medium">
            Affiliate Management & Double-Entry Payouts
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Review creator and partner applications, tune multi-tier commission parameters, and authorize disbursement payouts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-pink-500/15 text-pink-300 border border-pink-500/30">
            🤝 Partner Ledger
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

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[#262a36] pb-3">
        <button
          onClick={() => setActiveTab('affiliates')}
          className={`px-4 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'affiliates'
              ? 'bg-pink-500 text-[#0d0f12] font-semibold'
              : 'text-neutral-400 hover:text-white hover:bg-[#1A1D28]'
          }`}
        >
          Partners ({affiliates.length})
        </button>
        <button
          onClick={() => setActiveTab('rules')}
          className={`px-4 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'rules'
              ? 'bg-pink-500 text-[#0d0f12] font-semibold'
              : 'text-neutral-400 hover:text-white hover:bg-[#1A1D28]'
          }`}
        >
          Commission Rules ({rules.length})
        </button>
        <button
          onClick={() => setActiveTab('payouts')}
          className={`px-4 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'payouts'
              ? 'bg-pink-500 text-[#0d0f12] font-semibold'
              : 'text-neutral-400 hover:text-white hover:bg-[#1A1D28]'
          }`}
        >
          Pending Payouts ({payouts.length})
        </button>
      </div>

      {/* Main Table */}
      <div className="p-6 rounded-2xl bg-[#14161F] border border-[#262a36]">
        {loading ? (
          <div className="py-12 text-center text-xs text-neutral-400">Loading affiliate data...</div>
        ) : activeTab === 'affiliates' ? (
          affiliates.length === 0 ? (
            <div className="py-12 text-center text-xs text-neutral-400">No registered affiliate partners.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#262a36] text-neutral-400 uppercase text-[10px] font-mono">
                    <th className="py-3 px-3">Partner Code</th>
                    <th className="py-3 px-3">Display Name</th>
                    <th className="py-3 px-3">User ID</th>
                    <th className="py-3 px-3">Tier</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Approval Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202533]">
                  {affiliates.map((aff) => (
                    <tr key={aff.id} className="hover:bg-[#181c27] transition">
                      <td className="py-3 px-3 font-mono text-[#C3A15B] font-bold">/r/{aff.partner_code}</td>
                      <td className="py-3 px-3 text-white font-medium">{aff.display_name}</td>
                      <td className="py-3 px-3 font-mono text-neutral-400 truncate max-w-[120px]">{aff.user_id}</td>
                      <td className="py-3 px-3 font-mono text-neutral-300">{aff.tier}</td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            aff.status === 'APPROVED'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : aff.status === 'REJECTED'
                              ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                              : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {aff.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right space-x-2">
                        {aff.status === 'PENDING' && (
                          <>
                            <button
                              onClick={() => handleUpdateStatus(aff.id, 'APPROVED')}
                              className="px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500 hover:text-black transition"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleUpdateStatus(aff.id, 'REJECTED')}
                              className="px-3 py-1 rounded-lg text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500 hover:text-white transition"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : activeTab === 'rules' ? (
          rules.length === 0 ? (
            <div className="py-12 text-center text-xs text-neutral-400">No custom commission rules configured.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#262a36] text-neutral-400 uppercase text-[10px] font-mono">
                    <th className="py-3 px-3">Rule ID</th>
                    <th className="py-3 px-3">Plan Code</th>
                    <th className="py-3 px-3">Commission %</th>
                    <th className="py-3 px-3">Tier</th>
                    <th className="py-3 px-3">Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202533]">
                  {rules.map((r) => (
                    <tr key={r.id} className="hover:bg-[#181c27] transition">
                      <td className="py-3 px-3 font-mono text-[#C3A15B]">{r.id}</td>
                      <td className="py-3 px-3 font-mono text-white">{r.plan_code}</td>
                      <td className="py-3 px-3 font-mono text-emerald-400 font-bold">{r.commission_percentage}%</td>
                      <td className="py-3 px-3 font-mono text-neutral-300">{r.tier}</td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400">
                          {r.is_active ? 'ACTIVE' : 'DISABLED'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : payouts.length === 0 ? (
          <div className="py-12 text-center text-xs text-neutral-400">No pending payout disbursements.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#262a36] text-neutral-400 uppercase text-[10px] font-mono">
                  <th className="py-3 px-3">Payout ID</th>
                  <th className="py-3 px-3">Affiliate ID</th>
                  <th className="py-3 px-3">Amount</th>
                  <th className="py-3 px-3">Method</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Action (Step-Up)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202533]">
                {payouts.map((p) => (
                  <tr key={p.id} className="hover:bg-[#181c27] transition">
                    <td className="py-3 px-3 font-mono text-[#C3A15B]">{p.id}</td>
                    <td className="py-3 px-3 font-mono text-neutral-300">{p.affiliate_id}</td>
                    <td className="py-3 px-3 font-mono text-white font-bold">
                      ${(p.amount_cents / 100).toFixed(2)} {p.currency}
                    </td>
                    <td className="py-3 px-3 font-mono text-neutral-300">{p.payout_method}</td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300">
                        {p.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      {p.status === 'PENDING' && (
                        <button
                          onClick={() => handleApprovePayout(p.id)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500 hover:text-black transition"
                        >
                          Approve Payout
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
