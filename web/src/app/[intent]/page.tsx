import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { INTENT_CATEGORIES, SITE_CONFIG } from '@/lib/seo/config';
import { constructMetadata } from '@/lib/seo/metadata';
import { getBreadcrumbSchema, getFaqSchema } from '@/lib/seo/schema';

interface IntentPageProps {
  params: Promise<{ intent: string }>;
}

export async function generateStaticParams() {
  return Object.keys(INTENT_CATEGORIES).map((intent) => ({
    intent,
  }));
}

export async function generateMetadata({ params }: IntentPageProps): Promise<Metadata> {
  const { intent } = await params;
  const data = INTENT_CATEGORIES[intent];

  if (!data) {
    return constructMetadata({
      title: 'Page Not Found',
      description: 'The requested category does not exist.',
      path: `/${intent}`,
      noIndex: true,
    });
  }

  return constructMetadata({
    title: data.metaTitle,
    description: data.metaDescription,
    path: `/${data.slug}`,
  });
}

export default async function IntentPage({ params }: IntentPageProps) {
  const { intent } = await params;
  const data = INTENT_CATEGORIES[intent];

  if (!data) {
    notFound();
  }

  const breadcrumbs = [
    { name: 'Home', url: '/' },
    { name: 'Dating Categories', url: '/dating' },
    { name: data.title, url: `/${data.slug}` },
  ];

  const breadcrumbSchema = getBreadcrumbSchema(breadcrumbs);
  const faqSchema = getFaqSchema(data.faqs);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      {/* Crawlable Breadcrumb Navigation */}
      <nav aria-label="Breadcrumb" className="section-container" style={{ paddingBottom: 0 }}>
        <ol style={{ display: 'flex', gap: '0.5rem', listStyle: 'none', color: 'var(--text-muted)' }}>
          {breadcrumbs.map((b, i) => (
            <li key={b.url} style={{ display: 'flex', gap: '0.5rem' }}>
              <Link href={b.url} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
                {b.name}
              </Link>
              {i < breadcrumbs.length - 1 && <span>/</span>}
            </li>
          ))}
        </ol>
      </nav>

      {/* Hero Section */}
      <section className="hero-section" aria-labelledby="intent-heading">
        <h1 id="intent-heading" className="hero-title">
          {data.heading}
        </h1>
        <p className="hero-subtitle">{data.subheading}</p>
        <p style={{ maxWidth: '800px', margin: '0 auto 2rem', color: 'var(--text-muted)' }}>
          {data.heroCopy}
        </p>
        <div className="cta-group">
          <Link href="/download" className="btn-primary">
            Join Verified Community
          </Link>
          <Link href="/safety" className="btn-secondary">
            Safety &amp; Verification Rules
          </Link>
        </div>
      </section>

      {/* Structured FAQs with Schema */}
      <section className="section-container" aria-labelledby="faqs-heading">
        <div className="section-header">
          <h2 id="faqs-heading">Frequently Asked Questions</h2>
          <p style={{ color: 'var(--text-muted)' }}>
            Transparent answers about privacy, verification, and our community standards.
          </p>
        </div>

        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          {data.faqs.map((faq, index) => (
            <div key={index} className="faq-item">
              <h3 className="faq-question">{faq.question}</h3>
              <p className="faq-answer">{faq.answer}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Crawlable Internal Links to other Intent Hubs */}
      <section className="section-container" aria-labelledby="explore-heading">
        <div className="section-header">
          <h2 id="explore-heading">Explore Other Communities</h2>
        </div>
        <div className="grid-3">
          {Object.values(INTENT_CATEGORIES)
            .filter((cat) => cat.slug !== data.slug)
            .map((cat) => (
              <article key={cat.slug} className="card">
                <h3>{cat.title}</h3>
                <p>{cat.subheading}</p>
                <div style={{ marginTop: '1rem' }}>
                  <Link href={`/${cat.slug}`} style={{ color: 'var(--primary)', fontWeight: 600 }}>
                    Visit {cat.title} &rarr;
                  </Link>
                </div>
              </article>
            ))}
        </div>
      </section>
    </>
  );
}
