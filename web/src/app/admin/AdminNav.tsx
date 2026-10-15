'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStepUp } from './StepUpContext';

interface AdminNavProps {
  userEmail: string;
  userRole: string;
}

const WORKSPACES = [
  { href: '/admin', label: 'Overview', icon: '📊', roles: ['ALL'] },
  { href: '/admin/super', label: 'Super Admin', icon: '👑', roles: ['SUPER_ADMIN'] },
  { href: '/admin/moderation', label: 'Moderation & Safety', icon: '🛡️', roles: ['SUPER_ADMIN', 'TRUST_AND_SAFETY', 'CUSTOMER_SUPPORT'] },
  { href: '/admin/support', label: 'Customer Support', icon: '🎧', roles: ['SUPER_ADMIN', 'CUSTOMER_SUPPORT', 'TRUST_AND_SAFETY'] },
  { href: '/admin/finance', label: 'Finance & Billing', icon: '💳', roles: ['SUPER_ADMIN', 'FINANCE_ADMIN'] },
  { href: '/admin/affiliate', label: 'Affiliates', icon: '🤝', roles: ['SUPER_ADMIN', 'AFFILIATE_MANAGER', 'FINANCE_ADMIN'] },
  { href: '/admin/cms', label: 'Editorial CMS', icon: '✍️', roles: ['SUPER_ADMIN', 'EDITORIAL_CMS'] },
  { href: '/admin/analytics', label: 'Analytics & Ops', icon: '📈', roles: ['SUPER_ADMIN', 'FINANCE_ADMIN', 'TRUST_AND_SAFETY', 'EDITORIAL_CMS', 'CUSTOMER_SUPPORT', 'AFFILIATE_MANAGER'] },
];

export function AdminNav({ userEmail, userRole }: AdminNavProps) {
  const pathname = usePathname();
  const { stepUpToken, openStepUpModal } = useStepUp();

  return (
    <aside className="w-64 bg-[#111319] border-r border-[#262a36] flex flex-col justify-between shrink-0 min-h-screen">
      <div>
        {/* Console Header */}
        <div className="p-6 border-b border-[#262a36]">
          <Link href="/admin" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#9B7A2F] via-[#C3A15B] to-[#E3C77D] flex items-center justify-center shadow-lg shadow-[#C3A15B]/10">
              <span className="text-[#0d0f12] font-serif font-black text-lg">A</span>
            </div>
            <div>
              <div className="text-sm font-serif font-bold text-white tracking-wider">AURA CONSOLE</div>
              <div className="text-[10px] uppercase tracking-widest text-[#C3A15B] font-semibold">Sanctuary Operations</div>
            </div>
          </Link>
        </div>

        {/* User Role Card */}
        <div className="p-4 mx-4 my-4 rounded-xl bg-[#161922] border border-[#262a36]">
          <div className="text-[11px] text-neutral-400 truncate mb-1" title={userEmail}>
            {userEmail}
          </div>
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider bg-[#C3A15B]/15 text-[#E3C77D] border border-[#C3A15B]/30">
              {userRole}
            </span>
            <button
              onClick={() => openStepUpModal()}
              className={`text-[10px] px-2 py-0.5 rounded font-medium transition ${
                stepUpToken
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-neutral-800 text-neutral-300 hover:text-white border border-neutral-700'
              }`}
            >
              {stepUpToken ? '🔒 Step-Up Active' : '🔑 Step-Up'}
            </button>
          </div>
        </div>

        {/* Workspace Switcher / Navigation Links */}
        <nav className="px-3 space-y-1">
          <div className="px-3 pb-2 text-[10px] uppercase tracking-widest text-neutral-400 font-bold">
            Operational Workspaces
          </div>
          {WORKSPACES.map((ws) => {
            const isAccessible = ws.roles.includes('ALL') || ws.roles.includes(userRole);
            const isActive = pathname === ws.href || (ws.href !== '/admin' && pathname.startsWith(ws.href));

            return (
              <Link
                key={ws.href}
                href={ws.href}
                className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition ${
                  isActive
                    ? 'bg-[#C3A15B]/15 text-[#E3C77D] border border-[#C3A15B]/30'
                    : isAccessible
                    ? 'text-neutral-300 hover:bg-[#161922] hover:text-white'
                    : 'text-neutral-400 opacity-60 hover:opacity-100 hover:text-neutral-300'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-sm">{ws.icon}</span>
                  <span>{ws.label}</span>
                </div>
                {!isAccessible && (
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-neutral-800/80 text-neutral-400">
                    Restricted
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer Return Link */}
      <div className="p-4 border-t border-[#262a36]">
        <Link
          href="/"
          className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium text-neutral-400 hover:text-white hover:bg-neutral-800/50 transition border border-neutral-800"
        >
          <span>←</span> Return to Consumer Site
        </Link>
      </div>
    </aside>
  );
}
