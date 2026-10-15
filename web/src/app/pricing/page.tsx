import type { Metadata } from 'next';
import Link from 'next/link';
import { constructMetadata } from '@/lib/seo/metadata';
import { getProductSchema } from '@/lib/seo/schema';
import { getAuthSession } from '@/lib/auth/session';

export const metadata: Metadata = constructMetadata({
  title: 'Pricing & Transparent Premium Plans | Aura LGBTQ+ Dating',
  description:
    'Discover Aura’s transparent pricing plans. Compare Member, Plus, and Elite tiers with unlimited sparks, discrete browsing, and advanced travel filters.',
  path: '/pricing',
});

export default async function PricingPage() {
  const productSchema = getProductSchema();
  const session = await getAuthSession();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
      />

      <section className="hero-section" aria-labelledby="pricing-heading">
        <div style={{ marginBottom: '1.25rem' }}>
          <span className="badge-gold">
            ✦ Honest, Predictable Membership
          </span>
        </div>
        <h1 id="pricing-heading" className="hero-title">
          Transparent Membership Tiers
        </h1>
        <p className="hero-subtitle">
          Core discovery, verified matching, and mutual messaging are always accessible. Upgrade for enhanced discretion, lifestyle dealbreakers, and global exploration.
        </p>
      </section>

      <section className="section-container" aria-labelledby="plans-heading">
        <div className="section-header">
          <h2 id="plans-heading">Curated for Your Dating Intentions</h2>
          <p style={{ color: 'var(--aura-taupe)' }}>
            No hidden charges, zero automatic bait-and-switch fees, and immediate cancellation at any time.
          </p>
        </div>

        <div className="grid-3">
          {/* Member Tier */}
          <div className="card">
            <span className="badge-taupe" style={{ width: 'fit-content', marginBottom: '0.75rem' }}>
              Complimentary
            </span>
            <h3>Aura Member</h3>
            <p style={{ fontSize: '2.25rem', fontWeight: 700, margin: '0.75rem 0', color: 'var(--aura-ivory)', fontFamily: 'var(--font-serif)' }}>
              $0 <span style={{ fontSize: '1rem', color: 'var(--aura-taupe)', fontWeight: 400, fontFamily: 'var(--font-sans)' }}>/ month</span>
            </p>
            <p style={{ color: 'var(--aura-taupe)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Essential authentic dating for verified queer adults seeking real relationships.
            </p>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '2rem', color: 'var(--aura-parchment)', fontSize: '0.92rem' }}>
              <li>✓ Verified profile badge &amp; photo verification</li>
              <li>✓ Full Discovery feed with distance &amp; age filters</li>
              <li>✓ Mutual match instant private messaging</li>
              <li>✓ Discrete Mode &amp; Traveler Safety protections</li>
              <li>✓ 25 daily intentional Sparks</li>
            </ul>
            <div style={{ marginTop: 'auto' }}>
              {session ? (
                <Link href="/app/discovery" className="btn-secondary" style={{ display: 'block', textAlign: 'center' }}>
                  Current Tier &rarr; Discovery Deck
                </Link>
              ) : (
                <Link href="/auth/register" className="btn-secondary" style={{ display: 'block', textAlign: 'center' }}>
                  Join as Member
                </Link>
              )}
            </div>
          </div>

          {/* Plus Tier */}
          <div className="card" style={{ border: '1px solid var(--aura-gold)', position: 'relative' }}>
            <span className="badge-gold" style={{ position: 'absolute', top: '1.25rem', right: '1.25rem' }}>
              Most Selected
            </span>
            <span className="badge-gold" style={{ width: 'fit-content', marginBottom: '0.75rem' }}>
              Expanded Intent
            </span>
            <h3>Aura Plus</h3>
            <p style={{ fontSize: '2.25rem', fontWeight: 700, margin: '0.75rem 0', color: 'var(--aura-gold)', fontFamily: 'var(--font-serif)' }}>
              $24.99 <span style={{ fontSize: '1rem', color: 'var(--aura-taupe)', fontWeight: 400, fontFamily: 'var(--font-sans)' }}>/ month</span>
            </p>
            <p style={{ color: 'var(--aura-taupe)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Ideal for intentional daters who want deeper filtering and unlimited matching.
            </p>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '2rem', color: 'var(--aura-parchment)', fontSize: '0.92rem' }}>
              <li>✓ Everything in Member tier</li>
              <li>✓ <strong>Unlimited Sparks &amp; Swipes</strong> (zero daily caps)</li>
              <li>✓ <strong>Hard Lifestyle Dealbreaker Filters</strong> (smoking, verified-only)</li>
              <li>✓ <strong>Global Passport Mode</strong> (connect before traveling)</li>
              <li>✓ 5 Super Sparks weekly with priority intro notes</li>
              <li>✓ Rewind accidental passes instantly</li>
            </ul>
            <div style={{ marginTop: 'auto' }}>
              {session ? (
                <Link href="/membership?plan=AURA_PLUS" className="btn-gold" style={{ display: 'block', textAlign: 'center' }}>
                  Activate Aura Plus
                </Link>
              ) : (
                <>
                  <Link href="/auth/register?redirect=%2Fmembership%3Fplan%3DAURA_PLUS" className="btn-gold" style={{ display: 'block', textAlign: 'center' }}>
                    Activate Aura Plus
                  </Link>
                  <p style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--aura-taupe)' }}>
                    Already a member?{' '}
                    <Link href="/auth/login?redirect=%2Fmembership%3Fplan%3DAURA_PLUS" style={{ color: 'var(--aura-gold)' }}>
                      Sign in to upgrade
                    </Link>
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Elite Tier */}
          <div className="card" style={{ position: 'relative' }}>
            <span className="badge-oxblood" style={{ width: 'fit-content', marginBottom: '0.75rem' }}>
              Maximum Discretion
            </span>
            <h3>Aura Elite</h3>
            <p style={{ fontSize: '2.25rem', fontWeight: 700, margin: '0.75rem 0', color: 'var(--aura-ivory)', fontFamily: 'var(--font-serif)' }}>
              $49.99 <span style={{ fontSize: '1rem', color: 'var(--aura-taupe)', fontWeight: 400, fontFamily: 'var(--font-sans)' }}>/ month</span>
            </p>
            <p style={{ color: 'var(--aura-taupe)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Tailored for executives, public figures, and privacy-first community leaders.
            </p>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '2rem', color: 'var(--aura-parchment)', fontSize: '0.92rem' }}>
              <li>✓ Everything in Aura Plus</li>
              <li>✓ <strong>Complete Incognito Browsing</strong> (only visible to people you like)</li>
              <li>✓ <strong>1 Monthly Spotlight Profile Boost</strong> (3x visibility in your city)</li>
              <li>✓ Priority Concierge Review &amp; Safety Desk support</li>
              <li>✓ Exclusive VIP Community Badging</li>
              <li>✓ Read receipts &amp; advanced presence indicators</li>
            </ul>
            <div style={{ marginTop: 'auto' }}>
              {session ? (
                <Link href="/membership?plan=AURA_ELITE" className="btn-secondary" style={{ display: 'block', textAlign: 'center' }}>
                  Join Aura Elite
                </Link>
              ) : (
                <>
                  <Link href="/auth/register?redirect=%2Fmembership%3Fplan%3DAURA_ELITE" className="btn-secondary" style={{ display: 'block', textAlign: 'center' }}>
                    Join Aura Elite
                  </Link>
                  <p style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--aura-taupe)' }}>
                    Already a member?{' '}
                    <Link href="/auth/login?redirect=%2Fmembership%3Fplan%3DAURA_ELITE" style={{ color: 'var(--aura-gold)' }}>
                      Sign in to upgrade
                    </Link>
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Financial Transparency FAQ */}
        <div style={{ maxWidth: '840px', margin: '4rem auto 0 auto', background: 'var(--aura-charcoal)', padding: '2.5rem', borderRadius: '14px', border: '1px solid var(--border-subtle)' }}>
          <h3 style={{ marginBottom: '1.5rem', color: 'var(--aura-gold)' }}>Our Ethical Billing Guarantees</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', fontSize: '0.95rem' }}>
            <div>
              <h4 style={{ fontSize: '1.1rem', marginBottom: '0.35rem' }}>How does billing work?</h4>
              <p style={{ color: 'var(--aura-taupe)' }}>
                Subscriptions are billed via secure encrypted payment channels (Stripe / Apple / Google Pay). You can switch, pause, or cancel at any time directly in your account settings.
              </p>
            </div>
            <div>
              <h4 style={{ fontSize: '1.1rem', marginBottom: '0.35rem' }}>Do you ever sell member data to advertisers?</h4>
              <p style={{ color: 'var(--aura-taupe)' }}>
                Never. Aura is funded entirely by voluntary premium memberships, not data brokering or behavioral surveillance. Your sexual orientation, gender identity, and location will never be shared with third-party ad networks.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
