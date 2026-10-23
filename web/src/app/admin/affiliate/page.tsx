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
  tax_form_verified?: boolean;
  created_at: string;
}

interface CommissionRule {
  id: string;
  name: string;
  affiliate_tier: string;
  model: string;
  cpa_amount_cents: number;
  revshare_bps: number;
  recurring_enabled: boolean;
  max_recurring_months: number;
  escrow_hold_days: number;
  created_at: string;
}

interface CampaignItem {
  id: string;
  affiliate_id: string;
  campaign_slug: string;
  name: string;
  destination_url: string;
  clicks_count: number;
  conversions_count: number;
  is_active: boolean;
  created_at: string;
}

interface ConversionItem {
  id: string;
  referred_user_id: string;
  affiliate_id: string;
  partner_code: string;
  sub_campaign: string;
  attributed_at: string;
}

interface CommissionItem {
  id: string;
  affiliate_id: string;
  transaction_id: string;
  referred_user_id: string;
  gross_amount_cents: number;
  commission_amount_cents: number;
  currency: string;
  status: string;
  matures_at?: string;
  created_at: string;
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
  const [activeTab, setActiveTab] = useState<'affiliates' | 'rules' | 'campaigns' | 'conversions' | 'payouts'>('affiliates');

  // Data states
  const [affiliates, setAffiliates] = useState<AffiliateItem[]>([]);
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [conversions, setConversions] = useState<ConversionItem[]>([]);
  const [commissions, setCommissions] = useState<CommissionItem[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);

  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modals state
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [ruleTier, setRuleTier] = useState('STANDARD');
  const [ruleModel, setRuleModel] = useState('REVSHARE');
  const [ruleCpaDollars, setRuleCpaDollars] = useState('0.00');
  const [ruleRevsharePercent, setRuleRevsharePercent] = useState('20');
  const [ruleEscrowDays, setRuleEscrowDays] = useState('30');
  const [ruleRecurringEnabled, setRuleRecurringEnabled] = useState(true);
  const [ruleMaxMonths, setRuleMaxMonths] = useState('12');
  const [submittingRule, setSubmittingRule] = useState(false);

  // Campaign modal
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [campAffiliateId, setCampAffiliateId] = useState('');
  const [campSlug, setCampSlug] = useState('');
  const [campName, setCampName] = useState('');
  const [campDest, setCampDest] = useState('https://auradating.com');
  const [submittingCampaign, setSubmittingCampaign] = useState(false);

  // Rejection modal
  const [rejectingPayoutId, setRejectingPayoutId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('Incomplete tax verification or compliance review');

  const { openStepUpModal, stepUpToken } = useStepUp();

  const fetchAffiliates = async () => {
    setLoading(true);
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

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/affiliates/campaigns');
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data.campaigns || []);
      }
    } catch (err) {
      console.error('Failed to load campaigns:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchConversionsAndCommissions = async () => {
    setLoading(true);
    try {
      const [convRes, commRes] = await Promise.all([
        fetch('/api/admin/affiliates/conversions'),
        fetch('/api/admin/affiliates/commissions'),
      ]);
      if (convRes.ok) {
        const convData = await convRes.json();
        setConversions(convData.conversions || []);
      }
      if (commRes.ok) {
        const commData = await commRes.json();
        setCommissions(commData.commissions || []);
      }
    } catch (err) {
      console.error('Failed to load conversions or commissions:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPayouts = async () => {
    setLoading(true);
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
    setStatusMessage(null);
    if (activeTab === 'affiliates') fetchAffiliates();
    else if (activeTab === 'rules') fetchRules();
    else if (activeTab === 'campaigns') fetchCampaigns();
    else if (activeTab === 'conversions') fetchConversionsAndCommissions();
    else if (activeTab === 'payouts') fetchPayouts();
  }, [activeTab]);

  const handleUpdateStatus = async (affiliateId: string, status: 'APPROVED' | 'REJECTED' | 'SUSPENDED') => {
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

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName.trim()) {
      setStatusMessage({ type: 'error', text: 'Rule name is required.' });
      return;
    }

    setSubmittingRule(true);
    setStatusMessage(null);
    try {
      const cpaCents = Math.round(parseFloat(ruleCpaDollars || '0') * 100);
      const revshareBps = Math.round(parseFloat(ruleRevsharePercent || '0') * 100);

      const res = await fetch('/api/admin/commission-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: ruleName.trim(),
          affiliate_tier: ruleTier,
          model: ruleModel,
          cpa_amount_cents: cpaCents,
          revshare_bps: revshareBps,
          recurring_enabled: ruleRecurringEnabled,
          max_recurring_months: parseInt(ruleMaxMonths, 10) || 12,
          escrow_hold_days: parseInt(ruleEscrowDays, 10) || 30,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Failed to save commission rule');
      }

      setStatusMessage({ type: 'success', text: `Commission rule "${ruleName}" successfully created/updated.` });
      setIsRuleModalOpen(false);
      fetchRules();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to create commission rule' });
    } finally {
      setSubmittingRule(false);
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campSlug.trim() || !campAffiliateId.trim()) {
      setStatusMessage({ type: 'error', text: 'Affiliate ID and Campaign Slug are required.' });
      return;
    }

    setSubmittingCampaign(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/admin/affiliates/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          affiliate_id: campAffiliateId.trim(),
          campaign_slug: campSlug.trim().toLowerCase(),
          name: campName.trim() || campSlug.trim(),
          destination_url: campDest.trim() || 'https://auradating.com',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Failed to create campaign');
      }

      setStatusMessage({ type: 'success', text: `Campaign "${campSlug}" successfully created.` });
      setIsCampaignModalOpen(false);
      fetchCampaigns();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to create campaign' });
    } finally {
      setSubmittingCampaign(false);
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

  const handleRejectPayout = async () => {
    if (!rejectingPayoutId) return;
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/admin/payouts/${rejectingPayoutId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectionReason }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Payout rejection failed');
      }

      setStatusMessage({ type: 'success', text: `Payout ${rejectingPayoutId} rejected.` });
      setRejectingPayoutId(null);
      fetchPayouts();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to reject payout' });
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
            Affiliate Operations & Double-Entry Ledger
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Review partner approvals, configure multi-tier commission rules, inspect attribution conversions, and authorize disbursement payouts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-pink-500/15 text-pink-300 border border-pink-500/30">
            🤝 Partner Management
          </span>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#C3A15B]/15 text-[#E3C77D] border border-[#C3A15B]/30">
            Ledger Enforced
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
      <div className="flex items-center gap-2 border-b border-[#262a36] pb-3 overflow-x-auto">
        <button
          onClick={() => setActiveTab('affiliates')}
          className={`px-4 py-2 rounded-xl text-xs font-medium transition shrink-0 ${
            activeTab === 'affiliates'
              ? 'bg-pink-500 text-[#0d0f12] font-bold'
              : 'text-neutral-400 hover:text-white hover:bg-[#1A1D28]'
          }`}
        >
          Partners ({affiliates.length})
        </button>
        <button
          onClick={() => setActiveTab('rules')}
          className={`px-4 py-2 rounded-xl text-xs font-medium transition shrink-0 ${
            activeTab === 'rules'
              ? 'bg-pink-500 text-[#0d0f12] font-bold'
              : 'text-neutral-400 hover:text-white hover:bg-[#1A1D28]'
          }`}
        >
          Commission Rules ({rules.length})
        </button>
        <button
          onClick={() => setActiveTab('campaigns')}
          className={`px-4 py-2 rounded-xl text-xs font-medium transition shrink-0 ${
            activeTab === 'campaigns'
              ? 'bg-pink-500 text-[#0d0f12] font-bold'
              : 'text-neutral-400 hover:text-white hover:bg-[#1A1D28]'
          }`}
        >
          Campaigns & Clicks ({campaigns.length})
        </button>
        <button
          onClick={() => setActiveTab('conversions')}
          className={`px-4 py-2 rounded-xl text-xs font-medium transition shrink-0 ${
            activeTab === 'conversions'
              ? 'bg-pink-500 text-[#0d0f12] font-bold'
              : 'text-neutral-400 hover:text-white hover:bg-[#1A1D28]'
          }`}
        >
          Attribution & Commissions ({conversions.length + commissions.length})
        </button>
        <button
          onClick={() => setActiveTab('payouts')}
          className={`px-4 py-2 rounded-xl text-xs font-medium transition shrink-0 ${
            activeTab === 'payouts'
              ? 'bg-pink-500 text-[#0d0f12] font-bold'
              : 'text-neutral-400 hover:text-white hover:bg-[#1A1D28]'
          }`}
        >
          Disbursement Payouts ({payouts.length})
        </button>
      </div>

      {/* Main Content Area */}
      <div className="p-6 rounded-2xl bg-[#14161F] border border-[#262a36]">
        {loading ? (
          <div className="py-12 text-center text-xs text-neutral-400">Loading ecosystem data...</div>
        ) : activeTab === 'affiliates' ? (
          /* TAB 1: PARTNERS */
          affiliates.length === 0 ? (
            <div className="py-12 text-center text-xs text-neutral-400">
              No registered affiliate partners found in the database.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#262a36] text-neutral-400 uppercase text-[10px] font-mono">
                    <th className="py-3 px-3">Partner Code</th>
                    <th className="py-3 px-3">Display Name</th>
                    <th className="py-3 px-3">User ID</th>
                    <th className="py-3 px-3">Tier</th>
                    <th className="py-3 px-3">Tax Status</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Approval Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202533]">
                  {affiliates.map((aff) => (
                    <tr key={aff.id} className="hover:bg-[#181c27] transition">
                      <td className="py-3 px-3 font-mono text-[#C3A15B] font-bold">/r/{aff.partner_code}</td>
                      <td className="py-3 px-3 text-white font-medium">{aff.display_name}</td>
                      <td className="py-3 px-3 font-mono text-neutral-400 truncate max-w-[120px]" title={aff.user_id}>
                        {aff.user_id}
                      </td>
                      <td className="py-3 px-3 font-mono text-neutral-300">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-neutral-800 text-neutral-300">
                          {aff.tier}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px]">
                        {aff.tax_form_verified ? (
                          <span className="text-emerald-400">✓ Verified</span>
                        ) : (
                          <span className="text-amber-400">Pending W-9/W-8</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            aff.status === 'APPROVED'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : aff.status === 'REJECTED'
                              ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                              : aff.status === 'SUSPENDED'
                              ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
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
                        {aff.status === 'APPROVED' && (
                          <button
                            onClick={() => handleUpdateStatus(aff.id, 'SUSPENDED')}
                            className="px-3 py-1 rounded-lg text-xs font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500 hover:text-white transition"
                          >
                            Suspend
                          </button>
                        )}
                        {aff.status === 'SUSPENDED' && (
                          <button
                            onClick={() => handleUpdateStatus(aff.id, 'APPROVED')}
                            className="px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500 hover:text-black transition"
                          >
                            Reactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : activeTab === 'rules' ? (
          /* TAB 2: COMMISSION RULES */
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#262a36]">
              <div>
                <h3 className="text-sm font-semibold text-white">Tier Commission Parameters</h3>
                <p className="text-xs text-neutral-400">Configure revenue share percentages, CPA bounties, and escrow hold durations.</p>
              </div>
              <button
                onClick={() => setIsRuleModalOpen(true)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-pink-500 text-[#0d0f12] hover:bg-pink-400 transition"
              >
                + Create Commission Rule
              </button>
            </div>

            {rules.length === 0 ? (
              <div className="py-12 text-center text-xs text-neutral-400">No custom commission rules configured.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#262a36] text-neutral-400 uppercase text-[10px] font-mono">
                      <th className="py-3 px-3">Rule Name</th>
                      <th className="py-3 px-3">Tier</th>
                      <th className="py-3 px-3">Model</th>
                      <th className="py-3 px-3">Revshare %</th>
                      <th className="py-3 px-3">CPA Bounty</th>
                      <th className="py-3 px-3">Escrow Hold</th>
                      <th className="py-3 px-3">Recurring Limits</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202533]">
                    {rules.map((r) => (
                      <tr key={r.id || r.affiliate_tier} className="hover:bg-[#181c27] transition">
                        <td className="py-3 px-3 font-medium text-white">{r.name}</td>
                        <td className="py-3 px-3 font-mono text-[#C3A15B] font-bold">{r.affiliate_tier}</td>
                        <td className="py-3 px-3 font-mono text-neutral-300">{r.model}</td>
                        <td className="py-3 px-3 font-mono text-emerald-400 font-bold">
                          {(r.revshare_bps / 100).toFixed(1)}% ({r.revshare_bps} bps)
                        </td>
                        <td className="py-3 px-3 font-mono text-white">
                          ${(r.cpa_amount_cents / 100).toFixed(2)}
                        </td>
                        <td className="py-3 px-3 font-mono text-neutral-300">{r.escrow_hold_days} days</td>
                        <td className="py-3 px-3 text-neutral-400">
                          {r.recurring_enabled ? `Up to ${r.max_recurring_months} months` : 'First cycle only'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : activeTab === 'campaigns' ? (
          /* TAB 3: CAMPAIGNS & CLICKS */
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#262a36]">
              <div>
                <h3 className="text-sm font-semibold text-white">Referral Marketing Campaigns</h3>
                <p className="text-xs text-neutral-400">Track clicks, smart routing, and deferred deep-linking endpoints across campaigns.</p>
              </div>
              <button
                onClick={() => setIsCampaignModalOpen(true)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-pink-500 text-[#0d0f12] hover:bg-pink-400 transition"
              >
                + New Campaign
              </button>
            </div>

            {campaigns.length === 0 ? (
              <div className="py-12 text-center text-xs text-neutral-400">No affiliate campaigns recorded.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#262a36] text-neutral-400 uppercase text-[10px] font-mono">
                      <th className="py-3 px-3">Campaign Name</th>
                      <th className="py-3 px-3">Slug</th>
                      <th className="py-3 px-3">Affiliate ID</th>
                      <th className="py-3 px-3">Destination URL</th>
                      <th className="py-3 px-3">Clicks</th>
                      <th className="py-3 px-3">Conversions</th>
                      <th className="py-3 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202533]">
                    {campaigns.map((c) => (
                      <tr key={c.id || c.campaign_slug} className="hover:bg-[#181c27] transition">
                        <td className="py-3 px-3 font-medium text-white">{c.name}</td>
                        <td className="py-3 px-3 font-mono text-[#C3A15B] font-bold">?c={c.campaign_slug}</td>
                        <td className="py-3 px-3 font-mono text-neutral-400 truncate max-w-[120px]" title={c.affiliate_id}>
                          {c.affiliate_id}
                        </td>
                        <td className="py-3 px-3 font-mono text-neutral-400 truncate max-w-xs">{c.destination_url}</td>
                        <td className="py-3 px-3 font-mono text-white font-bold">{c.clicks_count}</td>
                        <td className="py-3 px-3 font-mono text-emerald-400 font-bold">{c.conversions_count}</td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              c.is_active
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-red-500/10 text-red-400 border border-red-500/20'
                            }`}
                          >
                            {c.is_active ? 'ACTIVE' : 'PAUSED'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : activeTab === 'conversions' ? (
          /* TAB 4: CONVERSIONS & COMMISSIONS */
          <div className="space-y-8">
            {/* Attributed Conversions Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-white">Attributed Referral Registrations ({conversions.length})</h3>
              {conversions.length === 0 ? (
                <div className="py-6 text-center text-xs text-neutral-400 bg-[#0B0D12] rounded-xl border border-[#262a36]">
                  No referral conversions recorded yet. Attributions are registered when new members register using an affiliate link.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#262a36] text-neutral-400 uppercase text-[10px] font-mono">
                        <th className="py-3 px-3">Referred User ID</th>
                        <th className="py-3 px-3">Partner Code</th>
                        <th className="py-3 px-3">Affiliate ID</th>
                        <th className="py-3 px-3">Sub-Campaign</th>
                        <th className="py-3 px-3">Attributed At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#202533]">
                      {conversions.map((cv) => (
                        <tr key={cv.id || cv.referred_user_id} className="hover:bg-[#181c27] transition">
                          <td className="py-3 px-3 font-mono text-white font-medium">{cv.referred_user_id}</td>
                          <td className="py-3 px-3 font-mono text-[#C3A15B] font-bold">/r/{cv.partner_code}</td>
                          <td className="py-3 px-3 font-mono text-neutral-400 truncate max-w-[120px]">{cv.affiliate_id}</td>
                          <td className="py-3 px-3 font-mono text-neutral-300">{cv.sub_campaign || '—'}</td>
                          <td className="py-3 px-3 font-mono text-neutral-400">{new Date(cv.attributed_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Commissions Ledger Section */}
            <div className="space-y-3 pt-4 border-t border-[#262a36]">
              <h3 className="text-sm font-semibold text-white">Commissions Ledger & Entitlement Accruals ({commissions.length})</h3>
              {commissions.length === 0 ? (
                <div className="py-6 text-center text-xs text-neutral-400 bg-[#0B0D12] rounded-xl border border-[#262a36]">
                  No commissions accrued yet. Commissions are created automatically when attributed users purchase subscriptions.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#262a36] text-neutral-400 uppercase text-[10px] font-mono">
                        <th className="py-3 px-3">Commission ID</th>
                        <th className="py-3 px-3">Affiliate ID</th>
                        <th className="py-3 px-3">Transaction ID</th>
                        <th className="py-3 px-3">Gross Amount</th>
                        <th className="py-3 px-3">Commission Amount</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-3">Matures At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#202533]">
                      {commissions.map((cm) => (
                        <tr key={cm.id} className="hover:bg-[#181c27] transition">
                          <td className="py-3 px-3 font-mono text-neutral-300">{cm.id}</td>
                          <td className="py-3 px-3 font-mono text-neutral-400 truncate max-w-[120px]">{cm.affiliate_id}</td>
                          <td className="py-3 px-3 font-mono text-white">{cm.transaction_id}</td>
                          <td className="py-3 px-3 font-mono text-neutral-300">
                            ${(cm.gross_amount_cents / 100).toFixed(2)} {cm.currency}
                          </td>
                          <td className="py-3 px-3 font-mono text-emerald-400 font-bold">
                            ${(cm.commission_amount_cents / 100).toFixed(2)} {cm.currency}
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                cm.status === 'MATURED' || cm.status === 'PAID'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : cm.status === 'CLAWED_BACK'
                                  ? 'bg-rose-500/15 text-rose-400'
                                  : 'bg-amber-500/15 text-amber-300'
                              }`}
                            >
                              {cm.status}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono text-neutral-400">
                            {cm.matures_at ? new Date(cm.matures_at).toLocaleDateString() : 'Immediate'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* TAB 5: PAYOUTS */
          payouts.length === 0 ? (
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
                    <th className="py-3 px-3 text-right">Disbursement Actions (Step-Up)</th>
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
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            p.status === 'APPROVED' || p.status === 'DISBURSED'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : p.status === 'REJECTED'
                              ? 'bg-red-500/15 text-red-400'
                              : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right space-x-2">
                        {p.status === 'PENDING' && (
                          <>
                            <button
                              onClick={() => handleApprovePayout(p.id)}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500 hover:text-black transition"
                            >
                              Approve Payout
                            </button>
                            <button
                              onClick={() => setRejectingPayoutId(p.id)}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500 hover:text-white transition"
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
        )}
      </div>

      {/* Create Commission Rule Modal */}
      {isRuleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#14161F] border border-[#262a36] rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#262a36] pb-3">
              <h3 className="text-base font-serif font-bold text-white">Create Commission Rule</h3>
              <button onClick={() => setIsRuleModalOpen(false)} className="text-neutral-400 hover:text-white text-lg">✕</button>
            </div>

            <form onSubmit={handleCreateRule} className="space-y-4 text-xs">
              <div>
                <label className="block text-neutral-300 font-medium mb-1">Rule Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Standard 20% Revshare"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-300 font-medium mb-1">Affiliate Tier</label>
                  <select
                    value={ruleTier}
                    onChange={(e) => setRuleTier(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white focus:outline-none focus:border-pink-500"
                  >
                    <option value="STANDARD">STANDARD</option>
                    <option value="VIP">VIP</option>
                    <option value="INFLUENCER">INFLUENCER</option>
                  </select>
                </div>

                <div>
                  <label className="block text-neutral-300 font-medium mb-1">Commission Model</label>
                  <select
                    value={ruleModel}
                    onChange={(e) => setRuleModel(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white focus:outline-none focus:border-pink-500"
                  >
                    <option value="REVSHARE">REVSHARE</option>
                    <option value="CPA">CPA</option>
                    <option value="HYBRID">HYBRID</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-300 font-medium mb-1">Revshare Percentage (%)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={ruleRevsharePercent}
                    onChange={(e) => setRuleRevsharePercent(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white focus:outline-none focus:border-pink-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-neutral-300 font-medium mb-1">CPA Bounty ($ USD)</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={ruleCpaDollars}
                    onChange={(e) => setRuleCpaDollars(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white focus:outline-none focus:border-pink-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-300 font-medium mb-1">Escrow Hold (Days)</label>
                  <input
                    type="number"
                    min="0"
                    max="365"
                    value={ruleEscrowDays}
                    onChange={(e) => setRuleEscrowDays(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white focus:outline-none focus:border-pink-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-neutral-300 font-medium mb-1">Max Recurring Months</label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={ruleMaxMonths}
                    onChange={(e) => setRuleMaxMonths(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white focus:outline-none focus:border-pink-500 font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="recurringEnabled"
                  checked={ruleRecurringEnabled}
                  onChange={(e) => setRuleRecurringEnabled(e.target.checked)}
                  className="rounded border-neutral-700 text-pink-500 focus:ring-0"
                />
                <label htmlFor="recurringEnabled" className="text-neutral-300 cursor-pointer">
                  Enable recurring commissions for renewal billing cycles
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsRuleModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-neutral-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingRule}
                  className="px-4 py-2 rounded-xl bg-pink-500 text-[#0d0f12] font-bold hover:bg-pink-400 transition disabled:opacity-50"
                >
                  {submittingRule ? 'Saving...' : 'Save Commission Rule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Campaign Modal */}
      {isCampaignModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#14161F] border border-[#262a36] rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#262a36] pb-3">
              <h3 className="text-base font-serif font-bold text-white">Register Marketing Campaign</h3>
              <button onClick={() => setIsCampaignModalOpen(false)} className="text-neutral-400 hover:text-white text-lg">✕</button>
            </div>

            <form onSubmit={handleCreateCampaign} className="space-y-4 text-xs">
              <div>
                <label className="block text-neutral-300 font-medium mb-1">Affiliate Partner ID</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. aff_123 or select an affiliate ID"
                  value={campAffiliateId}
                  onChange={(e) => setCampAffiliateId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white font-mono focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="block text-neutral-300 font-medium mb-1">Campaign Slug</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. pride_2026, podcast_ad"
                  value={campSlug}
                  onChange={(e) => setCampSlug(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white font-mono focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="block text-neutral-300 font-medium mb-1">Campaign Label / Name</label>
                <input
                  type="text"
                  placeholder="e.g. Summer Pride Festival Campaign"
                  value={campName}
                  onChange={(e) => setCampName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="block text-neutral-300 font-medium mb-1">Destination Landing URL</label>
                <input
                  type="url"
                  value={campDest}
                  onChange={(e) => setCampDest(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white font-mono focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsCampaignModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-neutral-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingCampaign}
                  className="px-4 py-2 rounded-xl bg-pink-500 text-[#0d0f12] font-bold hover:bg-pink-400 transition disabled:opacity-50"
                >
                  {submittingCampaign ? 'Creating...' : 'Create Campaign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject Payout Modal */}
      {rejectingPayoutId && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#14161F] border border-[#262a36] rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#262a36] pb-3">
              <h3 className="text-base font-serif font-bold text-white">Reject Payout Request</h3>
              <button onClick={() => setRejectingPayoutId(null)} className="text-neutral-400 hover:text-white text-lg">✕</button>
            </div>

            <div className="space-y-4 text-xs">
              <p className="text-neutral-300">
                Rejecting payout batch <span className="font-mono text-pink-400">{rejectingPayoutId}</span> will restore funds back into the partner&apos;s escrow balance.
              </p>

              <div>
                <label className="block text-neutral-300 font-medium mb-1">Rejection Reason</label>
                <textarea
                  rows={3}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setRejectingPayoutId(null)}
                  className="px-4 py-2 rounded-xl text-neutral-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRejectPayout}
                  className="px-4 py-2 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 transition"
                >
                  Confirm Rejection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
