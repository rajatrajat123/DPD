import type { Metadata } from 'next';
import { constructMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = constructMetadata({
  title: 'Privacy Policy | GDPR & CCPA Compliance',
  description:
    'Aura Privacy Policy: Learn how we protect Special Category Data under GDPR Article 9, enforce zero data brokering, and maintain strict data minimization.',
  path: '/legal/privacy',
});

export default function PrivacyPolicyPage() {
  return (
    <article className="section-container" style={{ maxWidth: '800px', margin: '4rem auto' }}>
      <h1>Privacy Policy &amp; Data Protection Standard</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>Last updated: October 2026</p>

      <section style={{ marginBottom: '2rem' }}>
        <h2>1. Special Category Data Protection (GDPR Article 9)</h2>
        <p>
          Sexual orientation, gender identity, and dating preferences constitute sensitive data. Aura
          operates with explicit consent and maintains cryptographic isolation between member identity
          records and matchmaking telemetry.
        </p>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2>2. Zero Search Engine Indexing of Member Profiles</h2>
        <p>
          Your profile, photos, direct messages, and real-time location are never indexed by Google, Bing,
          or any other search crawler. Only public educational, safety, and marketing pages are visible
          to search engines.
        </p>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2>3. Zero Third-Party Data Selling</h2>
        <p>
          We do not sell, rent, or monetize your personal information to third-party ad networks, brokers,
          or state surveillance entities.
        </p>
      </section>
    </article>
  );
}
