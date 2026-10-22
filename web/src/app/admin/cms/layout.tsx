import React from 'react';
import { requireAdminSession } from '@/lib/auth/session';

export const metadata = {
  title: 'Editorial CMS Console | Aura Admin',
};

export default async function CMSAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminSession('EDITORIAL_CMS');
  return <>{children}</>;
}
