import type { Metadata } from 'next';
import Link from 'next/link';
import { constructMetadata } from '@/lib/seo/metadata';
import { getArticleSchema, getFaqSchema } from '@/lib/seo/schema';
import { SITE_CONFIG } from '@/lib/seo/config';

export const metadata: Metadata = constructMetadata({
  title: 'LGBTQ+ Dating Safety Guide & Digital Privacy Standards',
  description:
    'Comprehensive safety resources for queer online dating: digital privacy protections, first-date safety checklists, photo verification, and 24/7 crisis helplines.',
  path: '/safety',
});

const SAFETY_FAQS = [
  {
    question: 'How do I protect my privacy while dating online?',
    answer:
      'Never share exact addresses, workplaces, or financial information early on. Use Aura’s Discrete Mode to obscure your profile when travelling in unfamiliar or less safe areas.',
  },
  {
    question: 'What is Aura’s Photo Verification standard?',
    answer:
      'Every verified profile undergoes multi-angle dynamic pose verification, cross-referenced using biometric liveness detection to eradicate bots and catfishing.',
  },
  {
    question: 'What should I do if I feel unsafe on a first date?',
    answer:
      'Always meet in populated public places, arrange your own transportation, tell a trusted friend your plans, and use our in-app emergency alert if needed.',
  },
];

export default function SafetyPage() {
  const articleSchema = getArticleSchema({
    title: 'LGBTQ+ Dating Safety Guide & Digital Privacy Standards',
    description:
      'Official safety protocols, digital discretion guides, and dating wellness advice from the Aura Safety Board.',
    url: `${SITE_CONFIG.baseUrl}/safety`,
    publishedTime: '2026-01-15T08:00:00Z',
    modifiedTime: '2026-10-10T12:00:00Z',
  });

  const faqSchema = getFaqSchema(SAFETY_FAQS);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <article className="hero-section" aria-labelledby="safety-heading">
        <h1 id="safety-heading" className="hero-title">
          LGBTQ+ Dating Safety &amp; Digital Privacy Guide
        </h1>
        <p className="hero-subtitle">
          Your safety, discretion, and peace of mind are non-negotiable. Learn how Aura safeguards
          your identity and how to stay safe while meeting new people.
        </p>
      </article>

      <section className="section-container" id="privacy" aria-labelledby="digital-privacy-heading">
        <div className="section-header">
          <h2 id="digital-privacy-heading">Digital Discretion &amp; Identity Shielding</h2>
        </div>
        <div className="grid-3">
          <div className="card">
            <h3>Fuzzy Geolocation</h3>
            <p>
              We never broadcast your exact GPS coordinates. Your distance is displayed as an
              approximate radius (e.g. within 3 miles) to prevent trilateration attacks.
            </p>
          </div>
          <div className="card">
            <h3>Discrete Icon &amp; App Masking</h3>
            <p>
              Heading into conservative environments or travelling? Switch the app launcher icon to a
              calculator or utility widget with a private PIN gate.
            </p>
          </div>
          <div className="card">
            <h3>Zero Search Engine Scraping</h3>
            <p>
              Your personal profile, bio, photos, and messages are completely firewalled from search
              crawlers. Only public educational pages like this one are indexable.
            </p>
          </div>
        </div>
      </section>

      <section className="section-container" id="resources" aria-labelledby="helpline-heading">
        <div className="section-header">
          <h2 id="helpline-heading">Global LGBTQ+ Crisis &amp; Support Helplines</h2>
          <p style={{ color: 'var(--text-muted)' }}>
            If you ever feel unsafe, threatened, or need someone to talk to, support is available 24/7.
          </p>
        </div>
        <div className="grid-3">
          <div className="card">
            <h3>The Trevor Project (US)</h3>
            <p>24/7 suicide prevention and crisis intervention for LGBTQ+ young people.</p>
            <p style={{ marginTop: '0.5rem', fontWeight: 600 }}>Call 1-866-488-7386 or text START to 678-678</p>
          </div>
          <div className="card">
            <h3>Switchboard LGBT+ (UK)</h3>
            <p>Confidential listening and support line for the UK LGBTQ+ community.</p>
            <p style={{ marginTop: '0.5rem', fontWeight: 600 }}>Call 0800 0119 100</p>
          </div>
          <div className="card">
            <h3>Trans Lifeline (US &amp; Canada)</h3>
            <p>Peer support service run by trans people, for trans and questioning individuals.</p>
            <p style={{ marginTop: '0.5rem', fontWeight: 600 }}>Call 877-565-8860</p>
          </div>
        </div>
      </section>

      <section className="section-container" aria-labelledby="faq-section-heading">
        <div className="section-header">
          <h2 id="faq-section-heading">Safety Frequently Asked Questions</h2>
        </div>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          {SAFETY_FAQS.map((faq, index) => (
            <div key={index} className="faq-item">
              <h3 className="faq-question">{faq.question}</h3>
              <p className="faq-answer">{faq.answer}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
