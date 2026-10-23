'use client';

import React, { useEffect, useState } from 'react';
import { useStepUp } from '../StepUpContext';

interface UserItem {
  id: string;
  email: string;
  role: string;
  status: string;
  login_method?: string;
  subscription_tier?: string;
  subscription_status?: string;
  created_at: string;
  last_active_at?: string;
}

interface ProductItem {
  id: string;
  plan_code: string;
  name: string;
  description: string;
  product_type: string;
  tier: string;
  billing_period: string;
  price_cents: number;
  currency: string;
  entitlements?: string[];
  boost_credits?: number;
  super_like_credits?: number;
  is_active: boolean;
}

const ROLES = [
  'MEMBER',
  'TRUST_AND_SAFETY',
  'FINANCE_ADMIN',
  'EDITORIAL_CMS',
  'CUSTOMER_SUPPORT',
  'AFFILIATE_MANAGER',
  'SUPER_ADMIN',
];

export default function SuperAdminPage() {
  const [activeTab, setActiveTab] = useState<'users' | 'pricing'>('users');

  // --- Users State ---
  const [users, setUsers] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // --- Pricing State ---
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [pricingCategory, setPricingCategory] = useState<'ALL' | 'SUBSCRIPTION' | 'CONSUMABLE'>('ALL');
  const [loadingPricing, setLoadingPricing] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [newPriceDollars, setNewPriceDollars] = useState<string>('');
  const [newIsActive, setNewIsActive] = useState<boolean>(true);
  const [updatingPricing, setUpdatingPricing] = useState(false);

  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { openStepUpModal, stepUpToken } = useStepUp();

  // Fetch Users
  const fetchUsers = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const params = new URLSearchParams();
      if (roleFilter) params.set('role', roleFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      params.set('limit', pageSize.toString());
      params.set('offset', ((page - 1) * pageSize).toString());

      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        setTotal(data.total || 0);
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || errData.message || 'Failed to fetch users');
      }
    } catch (err: any) {
      console.error('Failed to fetch users:', err);
      setStatusMessage({ type: 'error', text: err.message || 'Failed to fetch users' });
    } finally {
      setLoading(false);
    }
  };

  // Fetch Pricing
  const fetchPricing = async () => {
    setLoadingPricing(true);
    try {
      const res = await fetch('/api/admin/billing/plans');
      if (res.ok) {
        const data = await res.json();
        setProducts(data.plans || []);
      }
    } catch (err) {
      console.error('Failed to fetch catalog products:', err);
    } finally {
      setLoadingPricing(false);
    }
  };

  useEffect(() => {
    fetchPricing();
  }, []);

  useEffect(() => {
    if (activeTab === 'users') {
      fetchUsers();
    } else {
      fetchPricing();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, roleFilter, statusFilter, page, pageSize]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchUsers();
  };

  const handleRoleChange = (userId: string, newRole: string) => {
    setStatusMessage(null);

    const executeUpdate = async (token: string) => {
      try {
        const res = await fetch(`/api/admin/users/${userId}/role`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Aura-Step-Up': token,
          },
          body: JSON.stringify({ role: newRole }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error?.message || data.message || 'Failed to update user role');
        }

        setStatusMessage({ type: 'success', text: `User ${userId} role successfully updated to ${newRole}.` });
        fetchUsers();
      } catch (err: any) {
        setStatusMessage({ type: 'error', text: err.message || 'Role change failed' });
      }
    };

    if (stepUpToken) {
      executeUpdate(stepUpToken);
    } else {
      openStepUpModal(executeUpdate);
    }
  };

  const openEditPriceModal = (product: ProductItem) => {
    setEditingProduct(product);
    setNewPriceDollars((product.price_cents / 100).toFixed(2));
    setNewIsActive(product.is_active);
  };

  const handleSavePrice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;

    const parsedPrice = parseFloat(newPriceDollars);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      setStatusMessage({ type: 'error', text: 'Please enter a valid non-negative price amount.' });
      return;
    }

    const priceCents = Math.round(parsedPrice * 100);

    const executeSave = async (token: string) => {
      setUpdatingPricing(true);
      setStatusMessage(null);
      try {
        const res = await fetch(`/api/admin/billing/products/${editingProduct.plan_code}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Aura-Step-Up': token,
          },
          body: JSON.stringify({
            price_cents: priceCents,
            currency: editingProduct.currency || 'USD',
            is_active: newIsActive,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error?.message || data.message || 'Failed to update catalog product');
        }

        setStatusMessage({
          type: 'success',
          text: `Product ${editingProduct.plan_code} updated to $${(priceCents / 100).toFixed(2)}. Remember to update Google Play Console & Apple App Store Connect.`,
        });
        setEditingProduct(null);
        fetchPricing();
      } catch (err: any) {
        setStatusMessage({ type: 'error', text: err.message || 'Failed to update price' });
      } finally {
        setUpdatingPricing(false);
      }
    };

    if (stepUpToken) {
      executeSave(stepUpToken);
    } else {
      openStepUpModal(executeSave);
    }
  };

  const totalPages = Math.ceil(total / pageSize) || 1;

  const filteredProducts = products.filter((p) => {
    if (pricingCategory === 'SUBSCRIPTION') return p.product_type === 'subscription';
    if (pricingCategory === 'CONSUMABLE') return p.product_type === 'consumable';
    return true;
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-[#161922] via-[#1A1D28] to-[#161922] border border-[#262a36] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-[#C3A15B] font-bold mb-1">
            Super Administrator Workspace
          </div>
          <h1 className="text-2xl font-serif text-white font-medium">
            System Administration & Catalog Governance
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Manage user identity directories, enforce RBAC boundaries, and govern server product catalogs with step-up verification.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30">
            👑 Super Admin Only
          </span>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#C3A15B]/15 text-[#E3C77D] border border-[#C3A15B]/30">
            Step-Up Enforced
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
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'users'
              ? 'bg-[#C3A15B] text-[#0d0f12] font-bold'
              : 'text-neutral-400 hover:text-white hover:bg-[#1A1D28]'
          }`}
        >
          👥 User Directory & RBAC ({total})
        </button>
        <button
          onClick={() => setActiveTab('pricing')}
          className={`px-4 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'pricing'
              ? 'bg-[#C3A15B] text-[#0d0f12] font-bold'
              : 'text-neutral-400 hover:text-white hover:bg-[#1A1D28]'
          }`}
        >
          🏷️ Pricing & Product Catalog ({products.length})
        </button>
      </div>

      {activeTab === 'users' ? (
        <>
          {/* Filter and Search Bar */}
          <div className="p-4 rounded-2xl bg-[#14161F] border border-[#262a36] flex flex-col md:flex-row items-center justify-between gap-4">
            <form onSubmit={handleSearch} className="flex items-center gap-2 w-full md:w-auto flex-1 max-w-md">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by email address or User ID..."
                className="w-full px-3.5 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white text-xs focus:outline-none focus:border-[#C3A15B]"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#202533] text-neutral-200 border border-[#2d3345] hover:border-[#C3A15B] transition shrink-0"
              >
                Search
              </button>
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setPage(1);
                    fetchUsers();
                  }}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-neutral-400 hover:text-white transition shrink-0"
                >
                  Clear
                </button>
              )}
            </form>

            <div className="flex items-center gap-3 w-full md:w-auto">
              <div>
                <select
                  value={roleFilter}
                  onChange={(e) => {
                    setRoleFilter(e.target.value);
                    setPage(1);
                  }}
                  className="px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-neutral-300 text-xs focus:outline-none focus:border-[#C3A15B]"
                >
                  <option value="">All Roles</option>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                  className="px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-neutral-300 text-xs focus:outline-none focus:border-[#C3A15B]"
                >
                  <option value="">All Statuses</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                  <option value="BANNED">BANNED</option>
                  <option value="DEACTIVATED">DEACTIVATED</option>
                </select>
              </div>

              <div>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-neutral-300 text-xs focus:outline-none focus:border-[#C3A15B]"
                >
                  <option value={10}>10 / page</option>
                  <option value={15}>15 / page</option>
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                </select>
              </div>

              <span className="text-xs text-neutral-400 font-mono pl-2">
                Total: {total}
              </span>
            </div>
          </div>

          {/* Users Table */}
          <div className="p-6 rounded-2xl bg-[#14161F] border border-[#262a36]">
            {loading ? (
              <div className="py-12 text-center text-xs text-neutral-400">Loading user records...</div>
            ) : users.length === 0 ? (
              <div className="py-12 text-center text-xs text-neutral-400">No users found matching current filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#262a36] text-neutral-400 uppercase text-[10px] font-mono">
                      <th className="py-3 px-3">User ID</th>
                      <th className="py-3 px-3">Email</th>
                      <th className="py-3 px-3">Login Method</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3">Subscription</th>
                      <th className="py-3 px-3">Registration Date</th>
                      <th className="py-3 px-3">Assigned Role</th>
                      <th className="py-3 px-3 text-right">Modify Role (Step-Up)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202533]">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-[#181c27] transition">
                        <td className="py-3 px-3 font-mono text-neutral-300 truncate max-w-[130px]" title={u.id}>
                          {u.id}
                        </td>
                        <td className="py-3 px-3 text-white font-medium">{u.email}</td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-neutral-800 text-neutral-300 border border-neutral-700">
                            {u.login_method?.includes('GOOGLE') ? 'Google' : 'Email / Password'}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              u.status === 'ACTIVE'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-red-500/10 text-red-400 border border-red-500/20'
                            }`}
                          >
                            {u.status}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              u.subscription_tier === 'BLACK'
                                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                : u.subscription_tier === 'PLUS'
                                ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                                : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                            }`}
                          >
                            {u.subscription_tier || 'FREE'}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono text-neutral-400">
                          {new Date(u.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider bg-[#C3A15B]/15 text-[#E3C77D] border border-[#C3A15B]/30 font-mono">
                            {u.role}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <select
                            defaultValue={u.role}
                            onChange={(e) => handleRoleChange(u.id, e.target.value)}
                            className="px-2.5 py-1 rounded-lg bg-[#0B0D12] border border-neutral-700 text-neutral-300 text-xs focus:outline-none focus:border-[#C3A15B] cursor-pointer"
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            <div className="mt-6 flex flex-col md:flex-row items-center justify-between gap-4 border-t border-[#262a36] pt-4 text-xs text-neutral-400">
              <div>
                Showing {total > 0 ? (page - 1) * pageSize + 1 : 0} to {Math.min(page * pageSize, total)} of {total} accounts
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                  className="px-3 py-1.5 rounded-lg bg-[#202533] text-neutral-200 border border-[#2d3345] hover:border-[#C3A15B] disabled:opacity-40 disabled:hover:border-[#2d3345] transition"
                >
                  Previous
                </button>
                <span className="px-3 font-mono text-white">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                  className="px-3 py-1.5 rounded-lg bg-[#202533] text-neutral-200 border border-[#2d3345] hover:border-[#C3A15B] disabled:opacity-40 disabled:hover:border-[#2d3345] transition"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* Pricing & Catalog Management Tab */
        <div className="space-y-6">
          {/* Third-Party Store Console Notice Banner */}
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <div className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                Store Console Synchronization Required
              </div>
              <p className="text-xs text-neutral-300 mt-1 leading-relaxed">
                Server catalog prices establish entitlement values and fallback display across Aura. Google Play and Apple App Store in-app purchases are billed according to product IDs configured in Google Play Console and App Store Connect. Updating catalog prices here modifies server verification baselines and must be synchronized in the app store developer consoles.
              </p>
            </div>
          </div>

          {/* Pricing Category Filters */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPricingCategory('ALL')}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition ${
                  pricingCategory === 'ALL'
                    ? 'bg-[#C3A15B] text-[#0d0f12] font-bold'
                    : 'bg-[#14161F] text-neutral-400 hover:text-white border border-[#262a36]'
                }`}
              >
                All Products ({products.length})
              </button>
              <button
                onClick={() => setPricingCategory('SUBSCRIPTION')}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition ${
                  pricingCategory === 'SUBSCRIPTION'
                    ? 'bg-[#C3A15B] text-[#0d0f12] font-bold'
                    : 'bg-[#14161F] text-neutral-400 hover:text-white border border-[#262a36]'
                }`}
              >
                Subscriptions
              </button>
              <button
                onClick={() => setPricingCategory('CONSUMABLE')}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition ${
                  pricingCategory === 'CONSUMABLE'
                    ? 'bg-[#C3A15B] text-[#0d0f12] font-bold'
                    : 'bg-[#14161F] text-neutral-400 hover:text-white border border-[#262a36]'
                }`}
              >
                Consumables (Boost & Super Like)
              </button>
            </div>
          </div>

          {/* Catalog Table */}
          <div className="p-6 rounded-2xl bg-[#14161F] border border-[#262a36]">
            {loadingPricing ? (
              <div className="py-12 text-center text-xs text-neutral-400">Loading catalog items...</div>
            ) : filteredProducts.length === 0 ? (
              <div className="py-12 text-center text-xs text-neutral-400">No catalog products found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#262a36] text-neutral-400 uppercase text-[10px] font-mono">
                      <th className="py-3 px-3">Plan Code</th>
                      <th className="py-3 px-3">Product Name</th>
                      <th className="py-3 px-3">Type</th>
                      <th className="py-3 px-3">Period / Tier</th>
                      <th className="py-3 px-3">Server Price</th>
                      <th className="py-3 px-3">Included Credits</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3 text-right">Edit Pricing (Step-Up)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202533]">
                    {filteredProducts.map((p) => (
                      <tr key={p.plan_code} className="hover:bg-[#181c27] transition">
                        <td className="py-3 px-3 font-mono text-[#C3A15B] font-bold">{p.plan_code}</td>
                        <td className="py-3 px-3 text-white font-medium">
                          <div>{p.name}</div>
                          <div className="text-[10px] text-neutral-400 truncate max-w-xs">{p.description}</div>
                        </td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-neutral-800 text-neutral-300">
                            {p.product_type}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono text-neutral-300">
                          {p.billing_period !== 'none' ? p.billing_period : p.tier}
                        </td>
                        <td className="py-3 px-3 font-mono text-emerald-400 font-bold">
                          ${(p.price_cents / 100).toFixed(2)} {p.currency}
                        </td>
                        <td className="py-3 px-3 text-neutral-400 text-[11px]">
                          {p.boost_credits ? `${p.boost_credits} Boosts ` : ''}
                          {p.super_like_credits ? `${p.super_like_credits} Super Likes` : ''}
                          {!p.boost_credits && !p.super_like_credits ? '—' : ''}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              p.is_active
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-red-500/10 text-red-400 border border-red-500/20'
                            }`}
                          >
                            {p.is_active ? 'ACTIVE' : 'INACTIVE'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            onClick={() => openEditPriceModal(p)}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#202533] text-neutral-200 border border-[#2d3345] hover:border-[#C3A15B] transition"
                          >
                            Configure
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Product Modal */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#14161F] border border-[#262a36] rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#262a36] pb-3">
              <div>
                <h3 className="text-base font-serif font-bold text-white">Configure Catalog Product</h3>
                <p className="text-xs text-[#C3A15B] font-mono">{editingProduct.plan_code}</p>
              </div>
              <button
                onClick={() => setEditingProduct(null)}
                className="text-neutral-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePrice} className="space-y-4 text-xs">
              <div>
                <label className="block text-neutral-300 font-medium mb-1">Product Name</label>
                <input
                  type="text"
                  disabled
                  value={editingProduct.name}
                  className="w-full px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-800 text-neutral-400"
                />
              </div>

              <div>
                <label className="block text-neutral-300 font-medium mb-1">Price (USD)</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-neutral-400 font-mono">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={newPriceDollars}
                    onChange={(e) => setNewPriceDollars(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white font-mono focus:outline-none focus:border-[#C3A15B]"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="productIsActive"
                  checked={newIsActive}
                  onChange={(e) => setNewIsActive(e.target.checked)}
                  className="rounded border-neutral-700 text-[#C3A15B] focus:ring-0"
                />
                <label htmlFor="productIsActive" className="text-neutral-300 cursor-pointer">
                  Available in Store Catalog (Active)
                </label>
              </div>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 leading-relaxed">
                Step-up authentication is required. Catalog adjustments will create a permanent audit log trail.
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  className="px-4 py-2 rounded-xl text-neutral-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updatingPricing}
                  className="px-4 py-2 rounded-xl bg-[#C3A15B] text-[#0d0f12] font-bold hover:bg-[#d8b56d] transition disabled:opacity-50"
                >
                  {updatingPricing ? 'Saving...' : 'Save & Audit Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
