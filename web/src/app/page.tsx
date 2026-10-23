import type { Metadata } from 'next';
import Link from 'next/link';
import { constructMetadata } from '@/lib/seo/metadata';
import { COMMUNITY_HUBS } from '@/lib/navigation';
import { getAuthSession } from '@/lib/auth/session';

export const metadata: Metadata = constructMetadata({
  title: 'Aura | Luxury LGBTQ+ Dating for Genuine Relationships & Community',
  description:
    'Experience safe, authentic LGBTQ+ dating with photo verification, privacy-first controls, and intentional matchmaking for gay, lesbian, bi, and queer folks.',
  path: '/',
});

export default async function HomePage() {
  const session = await getAuthSession();

  return (
    <>
      {/* Editorial Luxury Hero Section */}
      <section className="hero-section" aria-labelledby="main-heading">
        <div style={{ marginBottom: '1.25rem' }}>
          <span className="badge-gold">
            ✦ Curated for Intentional LGBTQ+ Connections
          </span>
        </div>
        <h1 id="main-heading" className="hero-title">
          Where Intentional LGBTQ+ Connections Begin
        </h1>
        <p className="hero-subtitle">
          An elevated dating sanctuary engineered for discerning queer individuals who value substance, mutual respect, verified profiles, and absolute discretion.
        </p>
        <div className="cta-group">
          {session ? (
            <Link href="/app/discovery" className="btn-gold">
              Enter Discovery Sanctuary
            </Link>
          ) : (
            <Link href="/auth/register" className="btn-gold">
              Join Aura Membership
            </Link>
          )}
          <Link href="/how-it-works" className="btn-secondary">
            Discover Our Philosophy
          </Link>
        </div>
      </section>

      <hr className="gold-divider" style={{ maxWidth: '800px', margin: '3rem auto' }} />

      {/* Architectural Pillars */}
      <section className="section-container" aria-labelledby="pillars-heading">
        <div className="section-header">
          <h2 id="pillars-heading">The Four Standards of Aura</h2>
          <p style={{ color: 'var(--aura-taupe)' }}>
            Dating without the noise, fatigue, or compromises of mainstream swipe culture.
          </p>
        </div>

        <div className="grid-2">
          <article className="card">
            <div style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>⚖️</div>
            <h3>Hard Dealbreaker Integrity</h3>
            <p>
              Your lifestyle boundaries are sacred. When you set non-negotiable dealbreakers—whether non-smoking, relationship orientation, or verified-only—our matching engine strictly enforces them without silent compromises.
            </p>
            <div style={{ marginTop: '1.25rem' }}>
              <Link href="/how-it-works#dealbreakers" style={{ color: 'var(--aura-gold)', fontWeight: 600, fontSize: '0.92rem' }}>
                How Compatibility Works &rarr;
              </Link>
            </div>
          </article>

          <article className="card">
            <div style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>🛡️</div>
            <h3>Verified &amp; Adults-Only (18+)</h3>
            <p>
              Every profile undergoes strict cryptographic photo verification and 18+ age assurance. No bots, zero catfish, and no underage accounts—just authentic queer adults ready for meaningful connection.
            </p>
            <div style={{ marginTop: '1.25rem' }}>
              <Link href="/safety#verification" style={{ color: 'var(--aura-gold)', fontWeight: 600, fontSize: '0.92rem' }}>
                Our Verification Process &rarr;
              </Link>
            </div>
          </article>

          <article className="card">
            <div style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>🧭</div>
            <h3>Discretion &amp; Traveler Safety</h3>
            <p>
              Dating as an LGBTQ+ individual demands safety. Our platform includes Traveler Safety Mode to automatically protect sensitive identity tags in high-risk zones, alongside Incognito browsing for high-profile members.
            </p>
            <div style={{ marginTop: '1.25rem' }}>
              <Link href="/safety#discretion" style={{ color: 'var(--aura-gold)', fontWeight: 600, fontSize: '0.92rem' }}>
                Privacy Architecture &rarr;
              </Link>
            </div>
          </article>

          <article className="card">
            <div style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>💎</div>
            <h3>Mutual Spark Conversations</h3>
            <p>
              Conversations unlock only upon mutual genuine spark. Say goodbye to unsolicited cold messaging and inbox clutter. Every dialogue on Aura starts with shared intent and mutual excitement.
            </p>
            <div style={{ marginTop: '1.25rem' }}>
              <Link href="/features" style={{ color: 'var(--aura-gold)', fontWeight: 600, fontSize: '0.92rem' }}>
                Explore Messaging Tools &rarr;
              </Link>
            </div>
          </article>
        </div>
      </section>

      {/* Curated Communities Hubs (Crawlable SEO Architecture) */}
      <section className="section-container" aria-labelledby="communities-heading">
        <div className="section-header">
          <h2 id="communities-heading">Dedicated Sanctuaries for Every Identity</h2>
          <p style={{ color: 'var(--aura-taupe)' }}>
            Dignified spaces tailored to the unique dynamics, pronouns, and cultures of each community.
          </p>
        </div>

        <div className="grid-3">
          {COMMUNITY_HUBS.map((hub) => (
            <article key={hub.href} className="card">
              <span className="badge-taupe" style={{ width: 'fit-content', marginBottom: '0.75rem' }}>
                Community Sanctuary
              </span>
              <h3>{hub.label}</h3>
              <p>{hub.description}</p>
              <div style={{ marginTop: '1.5rem' }}>
                <Link href={hub.href} style={{ color: 'var(--aura-gold)', fontWeight: 600, fontSize: '0.92rem' }}>
                  Explore {hub.label} &rarr;
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Membership Tiers Preview */}
      <section className="section-container" aria-labelledby="membership-heading">
        <div className="section-header">
          <h2 id="membership-heading">Transparent Membership Tiers</h2>
          <p style={{ color: 'var(--aura-taupe)' }}>
            Choose the level of connection and privacy that aligns with your lifestyle.
          </p>
        </div>

        <div className="grid-3">
          <article className="card">
            <span className="badge-taupe" style={{ width: 'fit-content', marginBottom: '0.75rem' }}>
              Complimentary
            </span>
            <h3>Aura Member</h3>
            <p style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--aura-ivory)', margin: '0.5rem 0 1rem 0' }}>
              $0 <span style={{ fontSize: '0.9rem', color: 'var(--aura-taupe)', fontWeight: 400 }}>/ month</span>
            </p>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.5rem', fontSize: '0.92rem' }}>
              <li>✓ Verified profile &amp; photo badge</li>
              <li>✓ Full Discovery feed access</li>
              <li>✓ Mutual match messaging</li>
              <li>✓ Discrete mode controls</li>
            </ul>
            <div style={{ marginTop: 'auto' }}>
              {session ? (
                <Link href="/app/discovery" className="btn-secondary" style={{ width: '100%', textAlign: 'center' }}>
                  Current Tier (Discovery)
                </Link>
              ) : (
                <Link href="/auth/register" className="btn-secondary" style={{ width: '100%', textAlign: 'center' }}>
                  Join as Member
                </Link>
              )}
            </div>
          </article>

          <article className="card" style={{ border: '1px solid var(--aura-gold)' }}>
            <span className="badge-gold" style={{ width: 'fit-content', marginBottom: '0.75rem' }}>
              Most Popular
            </span>
            <h3>Aura Plus</h3>
            <p style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--aura-gold)', margin: '0.5rem 0 1rem 0' }}>
              $25 <span style={{ fontSize: '0.9rem', color: 'var(--aura-taupe)', fontWeight: 400 }}>/ month</span>
            </p>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.5rem', fontSize: '0.92rem' }}>
              <li>✓ Everything in Member</li>
              <li>✓ Unlimited Sparks &amp; Swipes</li>
              <li>✓ Advanced Lifestyle Dealbreakers</li>
              <li>✓ Global Passport Mode (7-day free trial)</li>
              <li>✓ 5 Super Sparks weekly</li>
            </ul>
            <div style={{ marginTop: 'auto' }}>
              <Link href={session ? "/membership?plan=AURA_PLUS_MONTHLY" : "/pricing"} className="btn-gold" style={{ width: '100%', textAlign: 'center' }}>
                Upgrade to Plus
              </Link>
            </div>
          </article>

          <article className="card">
            <span className="badge-oxblood" style={{ width: 'fit-content', marginBottom: '0.75rem' }}>
              VIP Discretion
            </span>
            <h3>Aura Extra Premium</h3>
            <p style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--aura-ivory)', margin: '0.5rem 0 1rem 0' }}>
              $34.99 <span style={{ fontSize: '0.9rem', color: 'var(--aura-taupe)', fontWeight: 400 }}>/ month</span>
            </p>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.5rem', fontSize: '0.92rem' }}>
              <li>✓ Everything in Plus</li>
              <li>✓ Complete Incognito Browsing</li>
              <li>✓ 3 Monthly 5x Profile Boosts</li>
              <li>✓ Priority Concierge Support</li>
              <li>✓ VIP Community Badging</li>
            </ul>
            <div style={{ marginTop: 'auto' }}>
              <Link href={session ? "/membership?plan=AURA_BLACK_MONTHLY" : "/pricing"} className="btn-secondary" style={{ width: '100%', textAlign: 'center' }}>
                View VIP Perks
              </Link>
            </div>
          </article>
        </div>
      </section>

      {/* Honest Mobile Apps Status Section */}
      <section className="section-container" style={{ textAlign: 'center', background: 'var(--aura-charcoal-deep)', padding: '3.5rem 2rem', borderRadius: '16px', border: '1px solid var(--border-subtle)' }}>
        <span className="badge-gold" style={{ marginBottom: '1rem' }}>
          ✦ Multi-Platform Access
        </span>
        <h2 style={{ marginBottom: '1rem' }}>Aura for iOS &amp; Android</h2>
        <p style={{ maxWidth: '640px', margin: '0 auto 2rem auto', color: 'var(--aura-parchment)' }}>
          Aura is fully accessible today on any modern desktop, tablet, and mobile web browser. Native iOS TestFlight and Android Early Access apps are currently in private invitation beta.
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/download" className="btn-outline-gold">
            Join iOS &amp; Android Waitlist
          </Link>
          <Link href={session ? "/app/discovery" : "/auth/register"} className="btn-gold">
            {session ? 'Enter Discovery Deck' : 'Launch Web App Now'}
          </Link>
        </div>
      </section>
    </>
  );
}
