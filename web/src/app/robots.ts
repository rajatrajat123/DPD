import type { MetadataRoute } from 'next';
import { SITE_CONFIG } from '@/lib/seo/config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/dating/',
          '/gay-dating',
          '/lesbian-dating',
          '/bisexual-dating',
          '/queer-dating',
          '/safety/',
          '/resources/',
          '/blog/',
          '/pricing',
          '/features',
          '/download',
          '/legal/',
        ],
        disallow: [
          '/app/',
          '/api/',
          '/auth/',
          '/messages/',
          '/matches/',
          '/profile/',
          '/settings/',
          '/account/',
          '/admin/',
          '/affiliate/',
          '/search?*',
          '/*?*filter=*',
          '/*?*sort=*',
        ],
      },
      {
        userAgent: 'Googlebot',
        allow: '/',
        disallow: ['/app/', '/api/', '/auth/', '/messages/', '/matches/', '/profile/'],
      },
    ],
    sitemap: `${SITE_CONFIG.baseUrl}/sitemap.xml`,
    host: SITE_CONFIG.baseUrl,
  };
}
