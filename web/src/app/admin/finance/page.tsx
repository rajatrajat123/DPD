'use client';

import React, { useEffect, useState } from 'react';
import { useStepUp } from '../StepUpContext';

interface SubscriptionItem {
  id: string;
  user_id: string;
  plan_code: string;
  provider: string;
  status: string;
  price_cents: number;
  currency: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
}

interface TransactionItem {
  id: string;
  user_id: string;
  transaction_type: string;
  provider: string;
  gross_amount_cents: number;
  net_amount_cents: number;
  currency: string;
  occurred_at: string;
}

export default function FinanceAdminPage() {
  const [activeTab, setActiveTab] = useState<'subs' | 'txs'>('subs');
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Refund Modal State
  const [refundTxId, setRefundTxId] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
  const [processingRefund, setProcessingRefund] = useState(false);

  const { openStepUpModal, stepUpToken } = useStepUp();

  const fetchSubscriptions = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/admin/billing/subscriptions');
      if (res.ok) {
        const data = await res.json();
        setSubscriptions(data.subscriptions || []);
      }
    } catch (err) {
      console.error('Failed to load subscriptions:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTransactions = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/admin/billing/transactions');
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions || []);
      }
    } catch (err) {
      console.error('Failed to load transactions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'subs') {
      fetchSubscriptions();
    } else {
      fetchTransactions();
    }
  }, [activeTab]);

  const handleIssueRefund = (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundTxId.trim()) return;

    const executeRefund = async (token: string) => {
      setProcessingRefund(true);
      setStatusMessage(null);

      try {
        const res = await fetch('/api/admin/billing/refund', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Aura-Step-Up': token,
          },
          body: JSON.stringify({
            transaction_id: refundTxId.trim(),
            reason: refundReason || 'Customer requested financial dispute resolution',
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error?.message || data.message || 'Refund failed');
        }

        setStatusMessage({ type: 'success', text: `Refund successfully processed for Transaction ${refundTxId}. Ledger updated.` });
        setIsRefundModalOpen(false);
        setRefundTxId('');
        setRefundReason('');
        if (activeTab === 'txs') fetchTransactions();
      } catch (err: any) {
        setStatusMessage({ type: 'error', text: err.message || 'Refund processing failed' });
      } finally {
        setProcessingRefund(false);
      }
    };

    if (stepUpToken) {
      executeRefund(stepUpToken);
    } else {
      openStepUpModal(executeRefund);
    }
  };

  const formatAmount = (cents: number, currency: string = 'USD') => {
    const isNegative = cents < 0;
    const abs = Math.abs(cents);
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(abs / 100);
    return isNegative ? `-${formatted}` : formatted;
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-[#161922] via-[#1A1D28] to-[#161922] border border-[#262a36] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-1">
            Finance & Payment Infrastructure
          </div>
          <h1 className="text-2xl font-serif text-white font-medium">
            Subscription Ledger & Revenue Governance
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Audit subscription lifecycle states, differentiate live vs sandbox checkouts, and issue step-up verified refunds.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsRefundModalOpen(true)}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500 hover:text-white transition"
          >
            Issue Step-Up Refund
          </button>
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
          onClick={() => setActiveTab('subs')}
          className={`px-4 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'subs'
              ? 'bg-emerald-500 text-[#0d0f12] font-semibold'
              : 'text-neutral-400 hover:text-white hover:bg-[#1A1D28]'
          }`}
        >
          Active Subscriptions ({subscriptions.length})
        </button>
        <button
          onClick={() => setActiveTab('txs')}
          className={`px-4 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'txs'
              ? 'bg-emerald-500 text-[#0d0f12] font-semibold'
              : 'text-neutral-400 hover:text-white hover:bg-[#1A1D28]'
          }`}
        >
          Transactions & Ledger ({transactions.length})
        </button>
      </div>

      {/* Main Table */}
      <div className="p-6 rounded-2xl bg-[#14161F] border border-[#262a36]">
        {loading ? (
          <div className="py-12 text-center text-xs text-neutral-400">Loading ledger data...</div>
        ) : activeTab === 'subs' ? (
          subscriptions.length === 0 ? (
            <div className="py-12 text-center text-xs text-neutral-400">No active subscriptions found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#262a36] text-neutral-400 uppercase text-[10px] font-mono">
                    <th className="py-3 px-3">Sub ID</th>
                    <th className="py-3 px-3">User ID</th>
                    <th className="py-3 px-3">Plan Code</th>
                    <th className="py-3 px-3">Environment & Provider</th>
                    <th className="py-3 px-3">Rate</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Period End</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202533]">
                  {subscriptions.map((s) => (
                    <tr key={s.id} className="hover:bg-[#181c27] transition">
                      <td className="py-3 px-3 font-mono text-[#C3A15B] font-semibold">{s.id}</td>
                      <td className="py-3 px-3 font-mono text-neutral-300 truncate max-w-[120px]" title={s.user_id}>
                        {s.user_id}
                      </td>
                      <td className="py-3 px-3 font-mono text-white font-medium">{s.plan_code}</td>
                      <td className="py-3 px-3">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-neutral-800 text-neutral-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          {s.provider} (LIVE)
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono text-white">
                        {formatAmount(s.price_cents, s.currency)}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            s.status === 'ACTIVE'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-neutral-800 text-neutral-400'
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono text-neutral-400">
                        {new Date(s.current_period_end).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : transactions.length === 0 ? (
          <div className="py-12 text-center text-xs text-neutral-400">No transactions recorded in ledger.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#262a36] text-neutral-400 uppercase text-[10px] font-mono">
                  <th className="py-3 px-3">Transaction ID</th>
                  <th className="py-3 px-3">User ID</th>
                  <th className="py-3 px-3">Event Type</th>
                  <th className="py-3 px-3">Gross Amount</th>
                  <th className="py-3 px-3">Net Amount</th>
                  <th className="py-3 px-3">Occurred</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202533]">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-[#181c27] transition">
                    <td className="py-3 px-3 font-mono text-[#C3A15B]">{tx.id}</td>
                    <td className="py-3 px-3 font-mono text-neutral-300 truncate max-w-[120px]" title={tx.user_id}>
                      {tx.user_id}
                    </td>
                    <td className="py-3 px-3 font-mono text-white">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          tx.transaction_type === 'REFUND'
                            ? 'bg-red-500/15 text-red-300 border border-red-500/30'
                            : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        }`}
                      >
                        {tx.transaction_type}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-white">
                      {formatAmount(tx.gross_amount_cents, tx.currency)}
                    </td>
                    <td className="py-3 px-3 font-mono text-neutral-300">
                      {formatAmount(tx.net_amount_cents, tx.currency)}
                    </td>
                    <td className="py-3 px-3 font-mono text-neutral-400">
                      {new Date(tx.occurred_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Step-Up Refund Modal */}
      {isRefundModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#151821] border border-red-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setIsRefundModalOpen(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-white text-lg"
            >
              ✕
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400">
                💳
              </div>
              <div>
                <h3 className="text-lg font-serif text-white font-medium">Issue Transaction Refund</h3>
                <p className="text-xs text-neutral-400">Step-Up Verified Ledger Action</p>
              </div>
            </div>

            <form onSubmit={handleIssueRefund} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-neutral-400 font-medium mb-1">
                  Transaction ID
                </label>
                <input
                  type="text"
                  value={refundTxId}
                  onChange={(e) => setRefundTxId(e.target.value)}
                  required
                  placeholder="e.g. tx_1234567890"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white text-sm focus:outline-none focus:border-red-400 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-neutral-400 font-medium mb-1">
                  Reason for Refund
                </label>
                <textarea
                  rows={3}
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Explain why this refund is being granted..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white text-xs focus:outline-none focus:border-red-400"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRefundModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-neutral-300 hover:bg-neutral-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processingRefund}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-red-500 text-white hover:bg-red-400 transition disabled:opacity-50"
                >
                  {processingRefund ? 'Authorizing...' : 'Authorize Refund (Step-Up)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
