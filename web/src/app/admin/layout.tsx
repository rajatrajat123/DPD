import React from 'react';
import { requireAdminSession } from '@/lib/auth/session';
import { StepUpProvider } from './StepUpContext';
import { AdminNav } from './AdminNav';

export const metadata = {
  title: 'Aura Unified Admin Console | LGBTQ+ Dating Platform',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdminSession();

  return (
    <StepUpProvider>
      <div className="min-h-screen bg-[#0B0D12] text-[#E8E9EC] flex">
        <AdminNav
          userEmail={session.email}
          userRole={session.role || 'SUPER_ADMIN'}
        />
        <main className="flex-1 overflow-y-auto min-h-screen bg-[#0E1017]">
          {children}
        </main>
      </div>
    </StepUpProvider>
  );
}
