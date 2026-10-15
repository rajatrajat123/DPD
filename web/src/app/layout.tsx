import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_CONFIG } from '@/lib/seo/config';
import { getOrganizationSchema, getWebSiteSchema } from '@/lib/seo/schema';
import { getAuthSession } from '@/lib/auth/session';
import { SiteHeader } from '@/components/navigation/SiteHeader';
import { FOOTER_SECTIONS } from '@/lib/navigation';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_CONFIG.baseUrl),
  title: {
    default: `${SITE_CONFIG.name} | ${SITE_CONFIG.tagline}`,
    template: `%s | ${SITE_CONFIG.name}`,
  },
  description:
    'The premier luxury LGBTQ+ dating platform engineered for authentic connections, verified profiles, discretion, and community safety.',
  openGraph: {
    siteName: SITE_CONFIG.name,
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    creator: SITE_CONFIG.twitterHandle,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const organizationSchema = getOrganizationSchema();
  const websiteSchema = getWebSiteSchema();
  const session = await getAuthSession();

  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
        />
      </head>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>

        {/* Luxury Site Header */}
        <SiteHeader initialIsAuthenticated={Boolean(session)} />

        {/* Semantic Main Content Landmark */}
        <main id="main-content">
          {children}
        </main>

        {/* Semantic Footer with Crawlable Taxonomy Graph */}
        <footer className="site-footer">
          <div className="footer-container">
            {FOOTER_SECTIONS.map((section) => (
              <div key={section.title} className="footer-col">
                <h3>{section.title}</h3>
                <ul>
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href}>{item.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="footer-bottom">
            <p>&copy; {new Date().getFullYear()} {SITE_CONFIG.companyLegalName}. All rights reserved.</p>
            <p className="privacy-badge">Zero data brokering. Your orientation, pronouns and location remain strictly confidential.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
