import React from 'react';
import { requireAdminSession } from '@/lib/auth/session';

export const metadata = {
  title: 'Finance & Billing Console | Aura Admin',
};

export default async function FinanceAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminSession('FINANCE_ADMIN');
  return <>{children}</>;
}
