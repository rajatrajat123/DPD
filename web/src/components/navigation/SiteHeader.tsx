'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PRIMARY_PUBLIC_NAV, COMMUNITY_HUBS, APP_NAV_ITEMS } from '@/lib/navigation';

interface SiteHeaderProps {
  initialIsAuthenticated?: boolean;
}

export function SiteHeader({ initialIsAuthenticated = false }: SiteHeaderProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(initialIsAuthenticated);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [communitiesOpen, setCommunitiesOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const hasAuthCookie = typeof document !== 'undefined' && document.cookie.includes('aura_auth_state=1');
    if (hasAuthCookie) {
      setIsAuthenticated(true);
    } else if (initialIsAuthenticated) {
      setIsAuthenticated(true);
    } else {
      fetch('/api/auth/session')
        .then((res) => (res.ok ? res.json() : { authenticated: false }))
        .then((data) => {
          if (data.authenticated) {
            setIsAuthenticated(true);
          }
        })
        .catch(() => {});
    }
  }, [initialIsAuthenticated, pathname]);

  // Close menus on route navigation
  useEffect(() => {
    setMobileMenuOpen(false);
    setCommunitiesOpen(false);
  }, [pathname]);

  const isAppRoute = pathname.startsWith('/app') || pathname.startsWith('/onboarding') || pathname.startsWith('/membership');

  if (pathname.startsWith('/admin')) {
    return null;
  }

  return (
    <header className="site-header">
      <div className="header-container">
        {/* Brand Monogram */}
        <Link href={isAuthenticated ? '/app/discovery' : '/'} className="brand-logo" aria-label="Aura LGBTQ+ Dating Home">
          <span className="logo-monogram">Aura</span>
          <span className="logo-tag">Luxury Dating</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="site-nav" aria-label="Primary Navigation">
          <ul>
            {isAppRoute || isAuthenticated ? (
              // Authenticated Navigation Bar
              <>
                {APP_NAV_ITEMS.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        style={{
                          color: active ? 'var(--aura-gold)' : 'var(--text-parchment)',
                          fontWeight: active ? 600 : 500,
                          borderBottom: active ? '2px solid var(--aura-gold)' : '2px solid transparent',
                          paddingBottom: '0.25rem',
                        }}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
                <li>
                  <Link href="/membership" style={{ color: 'var(--aura-gold-light)', fontSize: '0.9rem' }}>
                    ✦ Upgrade
                  </Link>
                </li>
                <li>
                  <form action="/api/auth/logout" method="POST" style={{ margin: 0 }}>
                    <button
                      type="submit"
                      className="btn-ghost"
                      style={{ fontSize: '0.88rem', padding: '0.35rem 0.85rem' }}
                    >
                      Sign Out
                    </button>
                  </form>
                </li>
              </>
            ) : (
              // Public Navigation Bar
              <>
                {PRIMARY_PUBLIC_NAV.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href}>{item.label}</Link>
                  </li>
                ))}

                {/* Communities Dropdown */}
                <li
                  style={{ position: 'relative' }}
                  onMouseEnter={() => setCommunitiesOpen(true)}
                  onMouseLeave={() => setCommunitiesOpen(false)}
                >
                  <button
                    onClick={() => setCommunitiesOpen((prev) => !prev)}
                    aria-expanded={communitiesOpen}
                    aria-haspopup="true"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: communitiesOpen ? 'var(--aura-gold)' : 'var(--text-parchment)',
                      fontSize: '0.95rem',
                      fontWeight: 500,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      fontFamily: 'inherit',
                      padding: 0,
                    }}
                  >
                    <span>Communities</span>
                    <span style={{ fontSize: '0.75rem', transform: communitiesOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
                  </button>

                  {communitiesOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: '-2rem',
                        marginTop: '0.75rem',
                        background: 'var(--aura-charcoal)',
                        border: '1px solid var(--border-gold)',
                        borderRadius: '10px',
                        padding: '0.75rem 0',
                        minWidth: '240px',
                        boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
                        zIndex: 200,
                      }}
                    >
                      {COMMUNITY_HUBS.map((hub) => (
                        <Link
                          key={hub.href}
                          href={hub.href}
                          style={{
                            display: 'block',
                            padding: '0.6rem 1.25rem',
                            color: 'var(--text-parchment)',
                            fontSize: '0.9rem',
                            textDecoration: 'none',
                            transition: 'background 0.2s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--aura-gold-dim)';
                            e.currentTarget.style.color = 'var(--aura-ivory)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = 'var(--text-parchment)';
                          }}
                        >
                          {hub.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </li>

                <li>
                  <Link href="/auth/login" style={{ color: 'var(--text-parchment)', fontWeight: 500 }}>
                    Sign In
                  </Link>
                </li>
                <li>
                  <Link href="/auth/register" className="btn-gold" style={{ padding: '0.5rem 1.25rem' }}>
                    Join Aura
                  </Link>
                </li>
              </>
            )}
          </ul>
        </nav>

        {/* Mobile Hamburger Button */}
        <button
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          aria-label={mobileMenuOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'}
          aria-expanded={mobileMenuOpen}
          style={{
            background: 'none',
            border: '1px solid var(--border-medium)',
            color: 'var(--aura-ivory)',
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'none',
          }}
          className="mobile-toggle-btn"
        >
          {mobileMenuOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div
          style={{
            background: 'var(--aura-black)',
            borderTop: '1px solid var(--border-subtle)',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          {isAppRoute || isAuthenticated ? (
            <>
              {APP_NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    color: pathname === item.href ? 'var(--aura-gold)' : 'var(--text-parchment)',
                    fontSize: '1.1rem',
                    textDecoration: 'none',
                    fontWeight: 500,
                  }}
                >
                  {item.label}
                </Link>
              ))}
              <Link href="/membership" style={{ color: 'var(--aura-gold-light)', fontSize: '1.1rem', textDecoration: 'none' }}>
                ✦ Upgrade Membership
              </Link>
              <form action="/api/auth/logout" method="POST" style={{ marginTop: '0.5rem' }}>
                <button type="submit" className="btn-ghost" style={{ width: '100%', textAlign: 'left' }}>
                  Sign Out
                </button>
              </form>
            </>
          ) : (
            <>
              {PRIMARY_PUBLIC_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{ color: 'var(--text-parchment)', fontSize: '1.1rem', textDecoration: 'none', fontWeight: 500 }}
                >
                  {item.label}
                </Link>
              ))}
              <div style={{ padding: '0.5rem 0', borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ color: 'var(--aura-taupe)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
                  Communities
                </div>
                {COMMUNITY_HUBS.map((hub) => (
                  <Link
                    key={hub.href}
                    href={hub.href}
                    style={{ display: 'block', padding: '0.35rem 0', color: 'var(--text-parchment)', fontSize: '1rem', textDecoration: 'none' }}
                  >
                    {hub.label}
                  </Link>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <Link href="/auth/login" className="btn-secondary" style={{ flex: 1, textAlign: 'center' }}>
                  Sign In
                </Link>
                <Link href="/auth/register" className="btn-gold" style={{ flex: 1, textAlign: 'center' }}>
                  Join Aura
                </Link>
              </div>
            </>
          )}
        </div>
      )}

      <style jsx>{`
        @media (max-width: 900px) {
          .mobile-toggle-btn {
            display: block !important;
          }
        }
      `}</style>
    </header>
  );
}
