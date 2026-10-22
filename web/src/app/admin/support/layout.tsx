import React from 'react';
import { requireAdminSession } from '@/lib/auth/session';

export const metadata = {
  title: 'Customer Support Console | Aura Admin',
};

export default async function SupportAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminSession('CUSTOMER_SUPPORT');
  return <>{children}</>;
}
