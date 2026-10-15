# SEO Analytics, Monitoring & CI/CD Regression Harness

## 1. Webmaster Tools Integration & Automated Submission

### 1.1 Google Search Console (GSC) Setup
- **Domain Verification**: Conducted via DNS TXT record or HTML meta tag (`<meta name="google-site-verification" content="..." />`).
- **Automated Sitemap Ingestion**: Configured in root deployment script to notify Google via the Search Console API whenever production builds are deployed or high-volume content updates occur.
- **Reporting Metrics Tracked**:
  - Daily impressions, clicks, average CTR, and average position by search query.
  - Coverage / Page Indexing status (monitoring `Crawled - currently not indexed`, `Discovered - currently not indexed`, and `Excluded by ‘noindex’ tag`).
  - Core Web Vitals mobile and desktop field data alerts.

### 1.2 Bing Webmaster Tools & IndexNow Integration
- **IndexNow Protocol**: Instant notification dispatched to Microsoft Bing and Yandex when new editorial guides, safety articles, or approved city hubs are published or updated:
  ```typescript
  // POST to https://api.indexnow.org/IndexNow
  {
    "host": "www.example.com",
    "key": "AURA_INDEXNOW_KEY",
    "keyLocation": "https://www.example.com/AURA_INDEXNOW_KEY.txt",
    "urlList": [
      "https://www.example.com/gay-dating",
      "https://www.example.com/safety/first-date"
    ]
  }
  ```

---

## 2. Privacy-Preserving Organic Attribution Engine

### 2.1 Attribution Architecture
Attribution tracking must comply with strict privacy policies: **no PII, sexual orientation, or exact location data is ever tied to marketing analytics streams.**

```
[Organic Google Search]
         |
         v
[Landing Page: /gay-dating?utm_source=google&utm_medium=organic]
         |
         +---> Client parses non-sensitive campaign params:
         |     - source: 'google'
         |     - medium: 'organic'
         |     - landing_path: '/gay-dating'
         |     - timestamp: 1730000000
         |
         v
[Stored in SessionStorage (Anonymized Campaign Context)]
         |
         v
[User Clicks "Create Free Account"]
         |
         v
[Registration Completed]
         |
         +---> Emits backend conversion event:
               {
                 "event": "user_registered",
                 "acquisition_channel": "organic_search",
                 "first_touch_landing": "/gay-dating",
                 "touchpoint_count": 1
               }
```

---

## 3. Automated CI/CD Regression Testing Suite

SEO validation is incorporated directly into the automated build pipeline. Any PR that degrades SEO or breaks privacy barriers fails the build.

### 3.1 Test Architecture Components
1. **Playwright SEO Test Suite (`tests/seo.spec.ts`)**:
   - Asserts HTTP 200 on all public canonical URLs.
   - Asserts HTTP 404 or redirect on disabled markets (e.g. `/en-ae/dating`).
   - Asserts `X-Robots-Tag: noindex, nofollow` on `/app/*`, `/messages/*`, `/profile/*`.
   - Asserts presence and length of `<title>` (30-65 chars) and `<meta name="description">` (120-165 chars).
   - Asserts matching `<link rel="canonical">` matches current pathname.
   - Asserts Schema.org JSON-LD scripts are valid and conform to schema.
   - Crawls all internal links to guarantee zero 404 broken links.
2. **Lighthouse CI (`@lhci/cli`)**:
   - Runs headless Chrome against production server.
   - Enforces scores:
     - `categories:performance`: `>= 0.95`
     - `categories:accessibility`: `>= 0.98`
     - `categories:best-practices`: `1.0`
     - `categories:seo`: `1.0`
3. **Dead Link & Redirect Checker**:
   - Runs `muffet` or custom crawl script to ensure no orphaned pages or redirect loops.
