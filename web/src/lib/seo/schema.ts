import { SITE_CONFIG } from './config';

export function getOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_CONFIG.name,
    legalName: SITE_CONFIG.companyLegalName,
    url: SITE_CONFIG.baseUrl,
    logo: `${SITE_CONFIG.baseUrl}/images/brand/logo.png`,
    sameAs: [
      `https://twitter.com/${SITE_CONFIG.twitterHandle.replace('@', '')}`,
      'https://www.instagram.com/auradating',
      'https://www.linkedin.com/company/aura-dating',
    ],
    contactPoint: {
      '@type': 'ContactPoint',
      email: SITE_CONFIG.supportEmail,
      contactType: 'customer support',
      availableLanguage: ['English', 'German', 'French'],
    },
  };
}

export function getWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_CONFIG.name,
    url: SITE_CONFIG.baseUrl,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_CONFIG.baseUrl}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

export function getBreadcrumbSchema(items: Array<{ name: string; url: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url.startsWith('http') ? item.url : `${SITE_CONFIG.baseUrl}${item.url}`,
    })),
  };
}

export function getFaqSchema(faqs: Array<{ question: string; answer: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}

export function getArticleSchema({
  title,
  description,
  url,
  publishedTime,
  modifiedTime,
  authorName = 'Aura Safety & Editorial Board',
}: {
  title: string;
  description: string;
  url: string;
  publishedTime: string;
  modifiedTime: string;
  authorName?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    mainEntityOfPage: url,
    datePublished: publishedTime,
    dateModified: modifiedTime,
    author: {
      '@type': 'Organization',
      name: authorName,
      url: `${SITE_CONFIG.baseUrl}/about/editorial-board`,
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_CONFIG.name,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_CONFIG.baseUrl}/images/brand/logo.png`,
      },
    },
  };
}

export function getSoftwareApplicationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Aura LGBTQ+ Dating App',
    operatingSystem: 'iOS 16.0+, Android 12.0+',
    applicationCategory: 'LifestyleApplication',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.8',
      ratingCount: '14200',
    },
  };
}

export function getProductSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Aura Premium Plus Membership',
    description: 'Unlimited likes, discrete browse mode, read receipts, and priority matching.',
    brand: {
      '@type': 'Brand',
      name: SITE_CONFIG.name,
    },
    offers: {
      '@type': 'Offer',
      price: '19.99',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: `${SITE_CONFIG.baseUrl}/pricing`,
    },
  };
}
