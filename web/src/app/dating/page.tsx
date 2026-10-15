import type { Metadata } from 'next';
import Link from 'next/link';
import { constructMetadata } from '@/lib/seo/metadata';
import { INTENT_CATEGORIES } from '@/lib/seo/config';
import { getBreadcrumbSchema } from '@/lib/seo/schema';

export const metadata: Metadata = constructMetadata({
  title: 'LGBTQ+ Dating Hub & Intentional Matchmaking',
  description:
    'Discover affirming LGBTQ+ dating categories. Explore gay, lesbian, bisexual, and queer dating spaces built with verified profiles and privacy controls.',
  path: '/dating',
});

export default function DatingHubPage() {
  const breadcrumbs = [
    { name: 'Home', url: '/' },
    { name: 'Dating Categories', url: '/dating' },
  ];
  const breadcrumbSchema = getBreadcrumbSchema(breadcrumbs);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />

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

      <section className="hero-section" aria-labelledby="hub-heading">
        <h1 id="hub-heading" className="hero-title">
          LGBTQ+ Dating Communities
        </h1>
        <p className="hero-subtitle">
          Find your space. Choose an intentional dating community designed around your identity,
          values, and relationship style.
        </p>
      </section>

      <section className="section-container" aria-labelledby="categories-heading">
        <div className="section-header">
          <h2 id="categories-heading">Explore Dating Categories</h2>
        </div>
        <div className="grid-3">
          {Object.values(INTENT_CATEGORIES).map((intent) => (
            <article key={intent.slug} className="card">
              <h3>{intent.title}</h3>
              <p>{intent.subheading}</p>
              <div style={{ marginTop: '1.25rem' }}>
                <Link href={`/${intent.slug}`} className="btn-primary" style={{ display: 'inline-block' }}>
                  Explore {intent.title} &rarr;
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
