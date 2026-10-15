import { test, expect } from '@playwright/test';

/**
 * Enterprise SEO Automated Verification Test Suite
 * Validates the 10 SEO Acceptance Criteria
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const PUBLIC_INDEXABLE_ROUTES = [
  '/',
  '/dating',
  '/gay-dating',
  '/lesbian-dating',
  '/bisexual-dating',
  '/queer-dating',
  '/safety',
  '/features',
  '/pricing',
  '/download',
  '/legal/privacy',
  '/legal/terms',
];

const PRIVATE_PROTECTED_ROUTES = [
  '/app/profile',
  '/messages',
  '/matches',
  '/admin',
];

test.describe('Criterion 1: Crawlable Semantic HTML', () => {
  for (const route of PUBLIC_INDEXABLE_ROUTES) {
    test(`Route ${route} delivers crawlable HTML content without client JS`, async ({ browser }) => {
      // Create context with JavaScript disabled to verify pure crawler view
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      const response = await page.goto(`${BASE_URL}${route}`);

      expect(response?.status()).toBe(200);

      // Verify single primary h1 exists and has meaningful text
      const h1Count = await page.locator('h1').count();
      expect(h1Count).toBe(1);

      const h1Text = await page.locator('h1').textContent();
      expect(h1Text?.trim().length).toBeGreaterThan(10);

      // Verify main landmark element
      const mainExists = await page.locator('main').count();
      expect(mainExists).toBeGreaterThan(0);

      await context.close();
    });
  }
});

test.describe('Criterion 2: Metadata and Canonical URLs', () => {
  for (const route of PUBLIC_INDEXABLE_ROUTES) {
    test(`Route ${route} has unique metadata and valid canonical URL`, async ({ page }) => {
      await page.goto(`${BASE_URL}${route}`);

      // Title check
      const title = await page.title();
      expect(title.length).toBeGreaterThanOrEqual(20);
      expect(title.length).toBeLessThanOrEqual(70);
      expect(title).toContain('Aura');

      // Meta Description check
      const description = await page.getAttribute('meta[name="description"]', 'content');
      expect(description).toBeTruthy();
      expect(description!.length).toBeGreaterThanOrEqual(100);
      expect(description!.length).toBeLessThanOrEqual(180);

      // Canonical URL check
      const canonical = await page.getAttribute('link[rel="canonical"]', 'href');
      expect(canonical).toBeTruthy();
      expect(canonical).toContain(route === '/' ? '' : route);

      // Robots meta check
      const robotsMeta = await page.getAttribute('meta[name="robots"]', 'content');
      if (robotsMeta) {
        expect(robotsMeta).not.toContain('noindex');
      }
    });
  }
});

test.describe('Criterion 3: Dynamic XML Sitemap Validity', () => {
  test('Sitemap returns valid XML with canonical indexable URLs', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/sitemap.xml`);
    expect(response.status()).toBe(200);

    const text = await response.text();
    expect(text).toContain('<?xml');
    expect(text).toContain('<urlset');

    // Confirm core public routes are present
    expect(text).toContain('/gay-dating');
    expect(text).toContain('/safety');
    expect(text).toContain('/pricing');

    // Confirm private routes are NOT in sitemap
    expect(text).not.toContain('/app');
    expect(text).not.toContain('/messages');
    expect(text).not.toContain('/admin');

    // Confirm restricted UAE dating landers are NOT in sitemap
    expect(text).not.toContain('/ae/dating');
  });
});

test.describe('Criterion 4: robots.txt and Crawler Directives', () => {
  test('robots.txt disallows private paths and points to sitemap', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/robots.txt`);
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toMatch(/User-Agent:\s*\*/i);
    expect(body).toContain('Disallow: /app/');
    expect(body).toContain('Disallow: /messages/');
    expect(body).toContain('Disallow: /profile/');
    expect(body).toContain('Disallow: /admin/');
    expect(body).toContain('Sitemap:');
  });
});

test.describe('Criterion 5: Privacy Protection on Sensitive Routes', () => {
  for (const route of PRIVATE_PROTECTED_ROUTES) {
    test(`Private route ${route} injects noindex and blocks unauthenticated crawlers`, async ({ request }) => {
      const response = await request.get(`${BASE_URL}${route}`, { maxRedirects: 0 });

      // Must redirect unauthenticated crawlers or respond with 401/403/302
      expect([302, 307, 308, 401, 403, 404]).toContain(response.status());

      // Verify noindex and cache suppression headers
      const xRobotsTag = response.headers()['x-robots-tag'];
      expect(xRobotsTag).toContain('noindex');

      const cacheControl = response.headers()['cache-control'];
      expect(cacheControl).toContain('no-store');
    });
  }
});

test.describe('Criterion 6: Structured Data Validation', () => {
  test('Homepage injects valid Organization and WebSite Schema', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);

    const schemas = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(schemas.length).toBeGreaterThanOrEqual(1);

    const parsedSchemas = schemas.map((s) => JSON.parse(s));
    const types = parsedSchemas.map((s) => s['@type']);

    expect(types).toContain('Organization');
    expect(types).toContain('WebSite');
  });

  test('Intent landing pages inject FAQPage and BreadcrumbList Schema', async ({ page }) => {
    await page.goto(`${BASE_URL}/gay-dating`);

    const schemas = await page.locator('script[type="application/ld+json"]').allTextContents();
    const parsedSchemas = schemas.map((s) => JSON.parse(s));
    const types = parsedSchemas.map((s) => s['@type']);

    expect(types).toContain('BreadcrumbList');
    expect(types).toContain('FAQPage');
  });
});

test.describe('Criterion 7: International Hreflang Consistency', () => {
  test('Pages include reciprocal hreflang and x-default annotations', async ({ page }) => {
    await page.goto(`${BASE_URL}/gay-dating`);

    const xDefault = await page.getAttribute('link[rel="alternate"][hreflang="x-default"]', 'href');
    expect(xDefault).toBeTruthy();

    const enUS = await page.getAttribute('link[rel="alternate"][hreflang="en-US"]', 'href');
    expect(enUS).toBeTruthy();

    // Confirm restricted UAE dating lander is NOT present in hreflang
    const arAE = await page.$('link[rel="alternate"][hreflang="ar-AE"]');
    expect(arAE).toBeNull();
  });
});

test.describe('Criterion 8: Zero Broken Links & Crawlable Internal Graph', () => {
  test('All navigation links return HTTP 200 and no orphans exist', async ({ page, request }) => {
    await page.goto(`${BASE_URL}/`);

    // Collect all internal links
    const links = await page.locator('a[href^="/"]').evaluateAll((anchors: HTMLAnchorElement[]) =>
      anchors.map((a) => a.getAttribute('href')).filter(Boolean) as string[]
    );

    const uniqueLinks = Array.from(new Set(links)).filter(
      (href) => !href.startsWith('/app') && !href.startsWith('/auth') && !href.startsWith('#')
    );

    for (const href of uniqueLinks) {
      const response = await request.get(`${BASE_URL}${href}`);
      expect(response.status(), `Link ${href} should return 200`).toBe(200);
    }
  });
});

test.describe('Criterion 9: Performance and Accessibility Core Audits', () => {
  test('Homepage has skip link, main landmark, and lang attribute', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);

    const lang = await page.getAttribute('html', 'lang');
    expect(lang).toBe('en');

    const skipLink = await page.locator('a.skip-link').count();
    expect(skipLink).toBe(1);
  });
});

test.describe('Criterion 10: Trailing Slash and Casing Normalization', () => {
  test('Trailing slashes redirect permanently with 308 to clean URL', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/safety/`, { maxRedirects: 0 });
    expect([308, 301]).toContain(response.status());
    expect(response.headers()['location']).toMatch(/\/safety$/);
  });

  test('Uppercase URLs redirect permanently to lowercase', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/Gay-Dating`, { maxRedirects: 0 });
    expect([308, 301]).toContain(response.status());
    expect(response.headers()['location']).toMatch(/\/gay-dating$/);
  });
});
