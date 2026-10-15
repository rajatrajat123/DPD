import type { MetadataRoute } from 'next';
import { SITE_CONFIG, INTENT_CATEGORIES, MARKET_CLEARANCE_REGISTRY } from '@/lib/seo/config';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = SITE_CONFIG.baseUrl;
  const now = new Date();

  // 1. Static Core Landing Pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/dating`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/safety`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/pricing`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/features`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/download`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
  ];

  // 2. High-Intent Demographic Pages (/gay-dating, /lesbian-dating, etc.)
  const intentPages: MetadataRoute.Sitemap = Object.values(INTENT_CATEGORIES).map((intent) => ({
    url: `${baseUrl}/${intent.slug}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.9,
  }));

  // 3. Approved & Cleared International Market Alternates (Only when enabled and deployed)
  const internationalPages: MetadataRoute.Sitemap = [];
  if (SITE_CONFIG.enableRegionalRestrictions) {
    Object.values(MARKET_CLEARANCE_REGISTRY).forEach((market) => {
      if (market.isDatingSearchIndexable && market.code !== 'us') {
        internationalPages.push({
          url: `${baseUrl}/${market.code}/dating`,
          lastModified: now,
          changeFrequency: 'weekly',
          priority: 0.8,
        });

        Object.values(INTENT_CATEGORIES).forEach((intent) => {
          internationalPages.push({
            url: `${baseUrl}/${market.code}/${intent.slug}`,
            lastModified: now,
            changeFrequency: 'weekly',
            priority: 0.8,
          });
        });
      }
    });
  }

  return [...staticPages, ...intentPages, ...internationalPages];
}
