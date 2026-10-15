# Technical SEO Architecture Specification

## 1. Next.js App Router Rendering Engine

The public consumer website is built using Next.js 15+ App Router, providing server-first rendering, streaming, and edge caching capabilities.

### 1.1 Page Strategy Matrix

| Route Pattern | Rendering Mode | Revalidation Strategy | Crawl Intent |
| :--- | :--- | :--- | :--- |
| `/` (Homepage) | SSG + ISR | `revalidate: 3600` (1 hr) | Brand Discovery & Navigation |
| `/dating` | SSG + ISR | `revalidate: 7200` (2 hrs) | Primary Category Hub |
| `/gay-dating`, `/lesbian-dating`, `/bisexual-dating`, `/queer-dating` | SSG + ISR | `revalidate: 7200` (2 hrs) | High-Intent Demographic Search |
| `/dating/[country]/[city]` | SSG + ISR (`generateStaticParams`) | `revalidate: 86400` (24 hrs) | Hyper-Local Intent (Curated) |
| `/safety`, `/safety/[guide]` | SSG | Static Build / On-Demand ISR | Trust & Safety (E-E-A-T) |
| `/resources/[article]` | SSG + ISR | `revalidate: 86400` (24 hrs) | Educational Intent (E-E-A-T) |
| `/blog`, `/blog/[slug]` | SSG + ISR (`generateStaticParams`) | `revalidate: 3600` (1 hr) | Editorial & Lifestyle |
| `/features`, `/pricing` | SSG | Static Build / On-Demand ISR | Commercial & Conversion |
| `/download`, `/download/[platform]` | SSG | Static Build / On-Demand ISR | App Store Conversion |
| `/app/**`, `/messages/**`, `/matches/**` | Client Components / Dynamic SSR | `dynamic: 'force-dynamic'`, `no-store` | **STRICTLY BLOCKED FROM CRAWLERS** |

---

## 2. Dynamic Metadata & Canonical URL Resolution

### 2.1 Next.js Metadata API Standards
Every public page exports an explicit `Metadata` or `generateMetadata()` definition adhering to the following rules:
- **Title**: Formatted as `{Page Specific Value} | {Platform Name}`. Never exceeds 60 characters.
- **Description**: 140 to 160 characters, containing the primary keyword phrase and an authentic call-to-action without keyword stuffing.
- **Canonical**: Explicit absolute URL defined in `alternates.canonical`. All query parameters (e.g. tracking tokens, search filters) are stripped.
- **OpenGraph & Twitter Cards**: High-contrast, brand-aligned 1200x630px imagery with explicit alt text, locale definitions, and Twitter Summary Card metadata.

```typescript
// Example: src/lib/seo/metadata.ts
import { Metadata } from 'next';
import { SITE_CONFIG } from './config';

interface SeoParams {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
  noIndex?: boolean;
}

export function constructMetadata({
  title,
  description,
  path,
  ogImage = SITE_CONFIG.defaultOgImage,
  noIndex = false,
}: SeoParams): Metadata {
  const canonicalUrl = `${SITE_CONFIG.baseUrl}${path}`;

  return {
    title,
    description,
    metadataBase: new URL(SITE_CONFIG.baseUrl),
    alternates: {
      canonical: canonicalUrl,
      languages: {
        'en-US': `${SITE_CONFIG.baseUrl}${path}`,
        'en-GB': `${SITE_CONFIG.baseUrl}/en-gb${path}`,
        'de-DE': `${SITE_CONFIG.baseUrl}/de-de${path}`,
        'x-default': `${SITE_CONFIG.baseUrl}${path}`,
      },
    },
    robots: noIndex
      ? { index: false, follow: false, nocache: true }
      : {
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
    openGraph: {
      title: `${title} | ${SITE_CONFIG.name}`,
      description,
      url: canonicalUrl,
      siteName: SITE_CONFIG.name,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
      locale: 'en_US',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ${SITE_CONFIG.name}`,
      description,
      images: [ogImage],
      creator: SITE_CONFIG.twitterHandle,
    },
  };
}
```

---

## 3. Dynamic XML Sitemaps Architecture

Sitemaps are split dynamically to avoid crawler timeouts and stay well below the 50,000 URLs / 50MB limits.

### 3.1 Sitemap Routes
1. `/sitemap.xml`: Root sitemap index.
2. `/sitemap-static.xml`: Core brand, product, and safety pages.
3. `/sitemap-categories.xml`: Intent and demographic hubs (`/gay-dating`, `/lesbian-dating`, etc.).
4. `/sitemap-locations.xml`: Approved, localized city and regional guides.
5. `/sitemap-resources.xml`: Guides, educational articles, and safety manuals.
6. `/sitemap-blog.xml`: Editorial posts with dynamic `lastModified` fetched from the CMS.

Each sitemap entry strictly checks the `is_indexable` flag and verified regional clearance status before outputting `<loc>`.

---

## 4. Crawlable Internal Link Graph & Information Architecture

### 4.1 Crawl Depth Budget
- Maximum click depth from homepage (`/`) to any key demographic or city landing page is **<= 3 clicks**.
- Clear Breadcrumb navigation (`Home > Dating Guides > New York City`) rendered with both crawlable HTML links (`<nav aria-label="Breadcrumb">`) and Schema.org `BreadcrumbList`.
- Global footer provides crawlable links to primary demographic hubs, safety guides, and legal pages.

### 4.2 Semantic HTML Structure
All public templates strictly enforce:
1. Exactly one `<h1>` per document containing the core keyword phrase.
2. Sequential heading levels (`<h2>` -> `<h3>` -> `<h4>`) without skips.
3. `<main>` landmark element around primary content.
4. Descriptive anchor text (e.g. `Read our LGBTQ+ First Date Safety Guide` rather than `Click here`).
5. All images wrapped in `<Image>` with enforced non-empty `alt` attributes.
