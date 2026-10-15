import type { Metadata } from 'next';
import { SITE_CONFIG, MARKET_CLEARANCE_REGISTRY } from './config';

export interface SeoOptions {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
  ogType?: 'website' | 'article';
  publishedTime?: string;
  modifiedTime?: string;
  noIndex?: boolean;
}

export function constructMetadata({
  title,
  description,
  path,
  ogImage = SITE_CONFIG.defaultOgImage,
  ogType = 'website',
  publishedTime,
  modifiedTime,
  noIndex = false,
}: SeoOptions): Metadata {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const canonicalUrl = `${SITE_CONFIG.baseUrl}${normalizedPath === '/' ? '' : normalizedPath}`;

  // Build multi-market hreflang alternates only for cleared markets
  const languages: Record<string, string> = {
    'x-default': canonicalUrl,
    'en-US': canonicalUrl,
  };

  Object.values(MARKET_CLEARANCE_REGISTRY).forEach((market) => {
    if (market.isDatingSearchIndexable && market.code !== 'us') {
      languages[market.defaultLocale] = `${SITE_CONFIG.baseUrl}/${market.code}${normalizedPath === '/' ? '' : normalizedPath}`;
    }
  });

  const fullTitle = (title.includes(SITE_CONFIG.name) || title.includes('Aura')) ? title : `${title} | ${SITE_CONFIG.name}`;

  return {
    title: {
      absolute: fullTitle,
    },
    description,
    metadataBase: new URL(SITE_CONFIG.baseUrl),
    alternates: {
      canonical: canonicalUrl,
      languages,
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
          nocache: true,
          googleBot: {
            index: false,
            follow: false,
          },
        }
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
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
      locale: 'en_US',
      type: ogType,
      ...(publishedTime ? { publishedTime } : {}),
      ...(modifiedTime ? { modifiedTime } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ${SITE_CONFIG.name}`,
      description,
      images: [ogImage],
      creator: SITE_CONFIG.twitterHandle,
    },
    other: {
      'google-site-verification': SITE_CONFIG.googleSiteVerification,
      'msvalidate.01': SITE_CONFIG.bingSiteVerification,
    },
  };
}
