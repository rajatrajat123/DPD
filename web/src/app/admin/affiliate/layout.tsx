import React from 'react';
import { requireAdminSession } from '@/lib/auth/session';

export const metadata = {
  title: 'Affiliate Program Operations | Aura Admin',
};

export default async function AffiliateAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminSession('AFFILIATE_MANAGER');
  return <>{children}</>;
}
