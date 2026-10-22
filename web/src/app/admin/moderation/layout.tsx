import React from 'react';
import { requireAdminSession } from '@/lib/auth/session';

export const metadata = {
  title: 'Trust & Safety Console | Aura Admin',
};

export default async function ModerationAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminSession('TRUST_AND_SAFETY');
  return <>{children}</>;
}
