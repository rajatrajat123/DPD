import type { Metadata } from 'next';
import Link from 'next/link';
import { constructMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = constructMetadata({
  title: 'How It Works | Aura LGBTQ+ Dating Platform Philosophy',
  description:
    'Discover how Aura delivers intentional LGBTQ+ dating through hard lifestyle dealbreakers, mandatory photo verification, and PostGIS privacy matching.',
  path: '/how-it-works',
});

export default function HowItWorksPage() {
  return (
    <div className="section-container" style={{ maxWidth: '960px', margin: '3.5rem auto' }}>
      <header style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
        <span className="badge-gold" style={{ marginBottom: '1rem' }}>
          ✦ Matchmaking Philosophy
        </span>
        <h1 style={{ marginBottom: '1.25rem' }}>
          How Aura Works: Intentional Dating &amp; Privacy Standards
        </h1>
        <p style={{ maxWidth: '680px', margin: '0 auto', fontSize: '1.15rem', color: 'var(--aura-parchment)' }}>
          A thoughtful, engineering-grade platform designed to end swipe fatigue and foster authentic queer relationships.
        </p>
      </header>

      {/* Step by Step Architecture */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
        <section className="card" id="taxonomy">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <span style={{ fontSize: '2rem', color: 'var(--aura-gold)', fontFamily: 'var(--font-serif)', fontWeight: 700 }}>01</span>
            <h2 style={{ fontSize: '1.6rem' }}>Expansive Identity &amp; Pronoun Taxonomy</h2>
          </div>
          <p>
            Language matters deeply in our community. Aura provides a comprehensive, non-binary, and intersectional identity model. Select your precise pronouns, gender identities, sexual orientations, and relationship structures (including monogamous, ethically non-monogamous, polyamorous, and exploring).
          </p>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span className="badge-taupe">Pronouns (they/them, she/her, he/him, ze/zir, custom)</span>
            <span className="badge-taupe">Genderfluid &amp; Non-Binary</span>
            <span className="badge-taupe">Two-Spirit &amp; Intersex</span>
            <span className="badge-taupe">Queer &amp; Pansexual</span>
          </div>
        </section>

        <section className="card" id="verification">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <span style={{ fontSize: '2rem', color: 'var(--aura-gold)', fontFamily: 'var(--font-serif)', fontWeight: 700 }}>02</span>
            <h2 style={{ fontSize: '1.6rem' }}>Mandatory 18+ Age Assurance &amp; Photo Verification</h2>
          </div>
          <p>
            Safety starts with knowing who you are talking to. Every member must complete age assurance (ensuring a strictly adults-only community) and 3D biometric pose verification against profile photos. Verified profiles earn the champagne gold checkmark, and users can choose to discover verified members only.
          </p>
        </section>

        <section className="card" id="dealbreakers">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <span style={{ fontSize: '2rem', color: 'var(--aura-gold)', fontFamily: 'var(--font-serif)', fontWeight: 700 }}>03</span>
            <h2 style={{ fontSize: '1.6rem' }}>Hard Lifestyle Dealbreaker Engine</h2>
          </div>
          <p>
            Mainstream apps secretly broaden your filters when candidate numbers are low. <strong>Aura refuses this compromise.</strong> If you select non-smokers only, you will never see smokers. Our reciprocal dealbreaker engine ensures bilateral respect: your lifestyle preferences and candidate boundaries are calculated with absolute mathematical integrity.
          </p>
          <div style={{ marginTop: '1rem', background: 'var(--aura-charcoal-deep)', padding: '1rem', borderRadius: '8px', borderLeft: '3px solid var(--aura-gold)' }}>
            <p style={{ fontSize: '0.92rem', color: 'var(--aura-ivory)', margin: 0 }}>
              <strong>Zero Scarcity Override:</strong> When no candidates match your strict dealbreakers nearby, Aura displays an honest, informative empty state rather than showing you mismatched profiles.
            </p>
          </div>
        </section>

        <section className="card" id="proximity">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <span style={{ fontSize: '2rem', color: 'var(--aura-gold)', fontFamily: 'var(--font-serif)', fontWeight: 700 }}>04</span>
            <h2 style={{ fontSize: '1.6rem' }}>PostGIS Spatial Proximity &amp; Privacy Floor</h2>
          </div>
          <p>
            Location matching is powered by PostGIS spatial calculations using geodesic spheres. To prevent micro-targeting or triangulation in hostile regions, exact GPS coordinates are never exposed. In low-density regions, matching summaries apply a cryptographic privacy floor ($N &lt; 5$) to protect individual community members.
          </p>
        </section>

        <section className="card" id="messaging">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <span style={{ fontSize: '2rem', color: 'var(--aura-gold)', fontFamily: 'var(--font-serif)', fontWeight: 700 }}>05</span>
            <h2 style={{ fontSize: '1.6rem' }}>Mutual Spark Connection &amp; Real-Time Dialogue</h2>
          </div>
          <p>
            When two members express mutual interest with a Like or Super Spark, an authentic match is established and real-time private messaging unlocks immediately. WebSocket streaming delivers instant updates, while strict safety tools allow immediate blocking, unmatching, and one-tap reporting.
          </p>
        </section>
      </div>

      <div style={{ textAlign: 'center', marginTop: '4rem', padding: '3rem', background: 'var(--aura-charcoal)', borderRadius: '16px', border: '1px solid var(--border-gold)' }}>
        <h2 style={{ marginBottom: '1rem' }}>Experience Intentional LGBTQ+ Dating</h2>
        <p style={{ maxWidth: '580px', margin: '0 auto 2rem auto', color: 'var(--aura-parchment)' }}>
          Join thousands of verified queer singles who have chosen dignity, honesty, and mutual respect.
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/auth/register" className="btn-gold">
            Apply for Membership
          </Link>
          <Link href="/safety" className="btn-secondary">
            Read Safety Guidelines
          </Link>
        </div>
      </div>
    </div>
  );
}
