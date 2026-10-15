import React from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAuthSession } from '@/lib/auth/session';
import { RegisterForm } from '@/components/auth/RegisterForm';

export const metadata: Metadata = {
  title: 'Apply for Membership | Aura LGBTQ+ Luxury Dating',
  description: 'Apply for membership in Aura’s discreet, verified queer dating community.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

interface RegisterPageProps {
  searchParams: Promise<{
    redirect?: string;
    tier?: string;
  }>;
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const session = await getAuthSession();
  const params = await searchParams;
  const redirectParam = params?.redirect;
  const tierParam = params?.tier;

  const targetDestination =
    redirectParam ||
    (tierParam === 'plus'
      ? '/membership?plan=AURA_PLUS'
      : tierParam === 'elite'
      ? '/membership?plan=AURA_ELITE'
      : '/app/discovery');

  // If already authenticated, bypass the signup form and proceed directly to target destination
  if (session) {
    redirect(targetDestination);
  }

  return (
    <RegisterForm initialRedirect={redirectParam} initialTier={tierParam} />
  );
}
