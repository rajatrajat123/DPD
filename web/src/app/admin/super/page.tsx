'use client';

import React, { useEffect, useState } from 'react';
import { useStepUp } from '../StepUpContext';

interface UserItem {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  last_active_at?: string;
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
  const [users, setUsers] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { openStepUpModal, stepUpToken } = useStepUp();

  const fetchUsers = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const params = new URLSearchParams();
      if (roleFilter) params.set('role', roleFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('search', search);

      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        setTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleFilter, statusFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
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

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-[#161922] via-[#1A1D28] to-[#161922] border border-[#262a36] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-[#C3A15B] font-bold mb-1">
            Super Administrator Workspace
          </div>
          <h1 className="text-2xl font-serif text-white font-medium">
            User Directory & Administrative RBAC
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Manage system permissions, promote administrative roles, and enforce anti-self-action security guarantees.
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
        </form>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
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
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-[#0B0D12] border border-neutral-700 text-neutral-300 text-xs focus:outline-none focus:border-[#C3A15B]"
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="SUSPENDED">SUSPENDED</option>
              <option value="BANNED">BANNED</option>
              <option value="DEACTIVATED">DEACTIVATED</option>
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
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Assigned Role</th>
                  <th className="py-3 px-3">Created</th>
                  <th className="py-3 px-3 text-right">Modify Role (Step-Up)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202533]">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-[#181c27] transition">
                    <td className="py-3 px-3 font-mono text-neutral-300 truncate max-w-[140px]" title={u.id}>
                      {u.id}
                    </td>
                    <td className="py-3 px-3 text-white font-medium">{u.email}</td>
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
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider bg-[#C3A15B]/15 text-[#E3C77D] border border-[#C3A15B]/30 font-mono">
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-neutral-400">
                      {new Date(u.created_at).toLocaleDateString()}
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
      </div>
    </div>
  );
}
