import React from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAuthSession } from '@/lib/auth/session';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign In | Aura LGBTQ+ Luxury Dating',
  description: 'Sign in to your private Aura membership account.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

interface LoginPageProps {
  searchParams: Promise<{
    redirect?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getAuthSession();
  const params = await searchParams;
  const redirectTarget = params?.redirect || '/app/discovery';

  // If already authenticated, redirect immediately to intended destination or app
  if (session) {
    redirect(redirectTarget);
  }

  return (
    <div className="section-container" style={{ maxWidth: '460px', margin: '4rem auto' }}>
      <div className="card" style={{ border: '1px solid var(--border-gold)', padding: '2.5rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <span className="badge-gold" style={{ marginBottom: '0.75rem' }}>
            ✦ Private Access
          </span>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
            Member Sign In
          </h1>
          <p style={{ color: 'var(--aura-taupe)', fontSize: '0.95rem' }}>
            Enter your credentials to access your private discovery deck and conversations.
          </p>
        </div>

        <React.Suspense fallback={<div style={{ textAlign: 'center', color: 'var(--aura-taupe)' }}>Loading sign-in form...</div>}>
          <LoginForm />
        </React.Suspense>
      </div>
    </div>
  );
}
