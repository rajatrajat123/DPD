import type { Metadata } from 'next';
import Link from 'next/link';
import { constructMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = constructMetadata({
  title: 'Platform Features & Security Architecture',
  description:
    'Explore Aura’s safety and dating features: discrete app masking, photo verification, fuzzy GPS location, and intentional relationship filters.',
  path: '/features',
});

export default function FeaturesPage() {
  return (
    <>
      <section className="hero-section" aria-labelledby="features-heading">
        <h1 id="features-heading" className="hero-title">
          Platform Features &amp; Privacy Safeguards
        </h1>
        <p className="hero-subtitle">
          Engineered from the ground up for safety, authenticity, and control over your digital footprint.
        </p>
      </section>

      <section className="section-container" aria-labelledby="security-heading">
        <div className="section-header">
          <h2 id="security-heading">Core Privacy Features</h2>
        </div>
        <div className="grid-3">
          <div className="card">
            <h3>Biometric Liveness Verification</h3>
            <p>
              Prevent impersonation with mandatory selfie verification analyzed for liveness, ensuring
              every verified badge represents a real person.
            </p>
          </div>
          <div className="card">
            <h3>Discrete App Icon &amp; PIN Gate</h3>
            <p>
              Disguise the app on your phone home screen with alternative utility icons to protect your
              privacy in shared or conservative environments.
            </p>
          </div>
          <div className="card">
            <h3>Fuzzy Geolocation Shield</h3>
            <p>
              Exact GPS coordinates are never stored or displayed. Public distance is presented only as an
              approximate radius to prevent trilateration.
            </p>
          </div>
        </div>
      </section>

      <section className="section-container" style={{ textAlign: 'center' }}>
        <h2>Ready to experience intentional dating?</h2>
        <div className="cta-group" style={{ marginTop: '1.5rem' }}>
          <Link href="/download" className="btn-primary">
            Download Free App
          </Link>
          <Link href="/pricing" className="btn-secondary">
            View Pricing Plans
          </Link>
        </div>
      </section>
    </>
  );
}
