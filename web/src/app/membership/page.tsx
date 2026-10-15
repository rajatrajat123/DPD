import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireAuthSession } from '@/lib/auth/session';
import { MembershipClient } from './MembershipClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Membership & Subscription Management | Aura LGBTQ+ Dating',
  description: 'Manage your Aura membership tier, active benefits, and auto-renewal settings.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function MembershipPage() {
  // Enforces server-side authentication check. If unauthenticated, triggers immediate redirect to login.
  const session = await requireAuthSession('/membership');

  return (
    <Suspense fallback={<div style={{ textAlign: 'center', padding: '4rem', color: 'var(--aura-taupe)' }}>Loading membership portal...</div>}>
      <MembershipClient userId={session.userId} userEmail={session.email} />
    </Suspense>
  );
}
