import type { Metadata } from 'next';
import Link from 'next/link';
import { constructMetadata } from '@/lib/seo/metadata';
import { getSoftwareApplicationSchema } from '@/lib/seo/schema';

import { WaitlistForm } from '@/components/download/WaitlistForm';

export const metadata: Metadata = constructMetadata({
  title: 'Download Aura Dating App | Available on iOS & Android',
  description:
    'Download the Aura LGBTQ+ dating app for iOS and Android. Join thousands of verified gay, lesbian, bisexual, and queer members in a safe, authentic dating environment.',
  path: '/download',
});

export default function DownloadPage() {
  const appSchema = getSoftwareApplicationSchema();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(appSchema) }}
      />

      <section className="hero-section" aria-labelledby="download-heading">
        <div style={{ marginBottom: '1.25rem' }}>
          <span className="badge-gold">
            ✦ Mobile App Deployment Status
          </span>
        </div>
        <h1 id="download-heading" className="hero-title">
          Aura for iOS &amp; Android
        </h1>
        <p className="hero-subtitle">
          Our responsive web application is live and accessible on all modern devices today. Native mobile applications for Apple iOS (TestFlight) and Google Play (Early Access) are in private closed beta.
        </p>

        {/* Honest Mobile Status Card */}
        <div style={{ maxWidth: '640px', margin: '2.5rem auto', background: 'var(--aura-charcoal)', border: '1px solid var(--border-gold)', borderRadius: '16px', padding: '2.5rem 2rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--aura-gold)', fontWeight: 600 }}>
            <span>🔒</span> Private Invitation Beta
          </div>
          <h3 style={{ marginBottom: '0.75rem' }}>Reserve Your Early Access Spot</h3>
          <p style={{ color: 'var(--aura-taupe)', fontSize: '0.95rem', marginBottom: '1.75rem' }}>
            Enter your email to receive an invitation when native mobile builds open for TestFlight (iOS) or Google Play (Android). In the meantime, use Aura immediately via mobile browser with zero app installation required.
          </p>

          <WaitlistForm />

          <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
            <Link href="/auth/register" className="btn-secondary" style={{ fontSize: '0.9rem' }}>
              Launch Browser Web App Now &rarr;
            </Link>
          </div>
        </div>
      </section>

      <section className="section-container" aria-labelledby="specs-heading">
        <div className="section-header">
          <h2 id="specs-heading">Device Compatibility &amp; Security Specs</h2>
        </div>
        <div className="grid-3">
          <div className="card">
            <span className="badge-taupe" style={{ width: 'fit-content', marginBottom: '0.75rem' }}>Apple iOS</span>
            <h3>Apple iOS Support</h3>
            <p>Native app builds require iOS 16.0 or later. Fully compatible with Safari Progressive Web App (PWA) with home screen installation on iOS 16.4+.</p>
          </div>
          <div className="card">
            <span className="badge-taupe" style={{ width: 'fit-content', marginBottom: '0.75rem' }}>Google Android</span>
            <h3>Google Android Support</h3>
            <p>Compatible with Android 12.0 or later. Supported across Chrome, Firefox, and Samsung Internet with native push notifications.</p>
          </div>
          <div className="card">
            <span className="badge-taupe" style={{ width: 'fit-content', marginBottom: '0.75rem' }}>Privacy Sandbox</span>
            <h3>Zero Data Brokering</h3>
            <p>Strictly compliant with Apple App Tracking Transparency (ATT) and Android Privacy Sandbox. Zero tracking across external apps or websites.</p>
          </div>
        </div>
      </section>
    </>
  );
}
