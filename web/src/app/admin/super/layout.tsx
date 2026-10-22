import React from 'react';
import { requireAdminSession } from '@/lib/auth/session';

export const metadata = {
  title: 'Super Admin Console | Aura',
};

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminSession('SUPER_ADMIN');
  return <>{children}</>;
}
