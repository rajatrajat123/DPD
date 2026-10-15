import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAuthSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Aura Member App',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function AuthenticatedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuthSession('/app/discovery');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--aura-black)' }}>
      <header
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          background: 'rgba(21, 21, 21, 0.95)',
          backdropFilter: 'blur(12px)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }}
      >
        <div
          style={{
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '0.85rem 1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
            <Link
              href="/app/discovery"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                textDecoration: 'none',
                color: 'var(--aura-ivory)',
                fontFamily: 'var(--font-serif)',
                fontWeight: 700,
                fontSize: '1.35rem',
                letterSpacing: '0.04em',
              }}
            >
              <span>Aura</span>
              <span className="badge-gold" style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem' }}>
                ✦ Member
              </span>
            </Link>

            <nav style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Link
                href="/app/discovery"
                style={{
                  color: 'var(--aura-ivory)',
                  textDecoration: 'none',
                  fontSize: '0.9rem',
                  fontWeight: 500,
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  background: 'var(--aura-charcoal-deep)',
                  border: '1px solid var(--border-gold)',
                }}
              >
                ✨ Discover
              </Link>
              <Link
                href="/app/matches"
                style={{
                  color: 'var(--aura-parchment)',
                  textDecoration: 'none',
                  fontSize: '0.9rem',
                  fontWeight: 500,
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  border: '1px solid transparent',
                  transition: 'background 0.2s',
                }}
              >
                💖 Matches
              </Link>
              <Link
                href="/app/messages"
                style={{
                  color: 'var(--aura-parchment)',
                  textDecoration: 'none',
                  fontSize: '0.9rem',
                  fontWeight: 500,
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  border: '1px solid transparent',
                  transition: 'background 0.2s',
                }}
              >
                💬 Messages
              </Link>
              <Link
                href="/app/profile"
                style={{
                  color: 'var(--aura-parchment)',
                  textDecoration: 'none',
                  fontSize: '0.9rem',
                  fontWeight: 500,
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  border: '1px solid transparent',
                  transition: 'background 0.2s',
                }}
              >
                👤 Profile
              </Link>
            </nav>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Link
              href="/membership"
              className="badge-gold"
              style={{
                textDecoration: 'none',
                padding: '0.35rem 0.75rem',
                fontSize: '0.75rem',
                cursor: 'pointer',
              }}
            >
              ⭐ Membership Plans
            </Link>

            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--aura-taupe)',
                  padding: '0.4rem 0.85rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.82rem',
                  transition: 'all 0.2s',
                }}
              >
                Sign Out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main style={{ flex: 1, padding: '1.5rem 1rem' }}>
        {children}
      </main>
    </div>
  );
}
