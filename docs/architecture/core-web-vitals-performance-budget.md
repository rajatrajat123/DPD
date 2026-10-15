# Core Web Vitals & Performance Engineering Budget

## 1. Google Core Web Vitals Thresholds (Mobile 4G)

Google uses the 75th percentile of real-world user metrics collected via Chrome User Experience Report (CrUX) to assess search rankings.

| Metric | Target (Good) | Warning | Failure Threshold | Architecture Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **LCP (Largest Contentful Paint)** | **<= 2.0s** | 2.1s - 2.5s | > 2.5s | SSG / ISR pre-rendered HTML; Next.js `<Image priority>` for hero visuals; AVIF/WebP; Edge CDN caching |
| **INP (Interaction to Next Paint)** | **<= 150ms** | 151ms - 200ms | > 200ms | Server Components by default; Zero heavy hydration; interactive features deferred to click |
| **CLS (Cumulative Layout Shift)** | **<= 0.05** | 0.06 - 0.10 | > 0.10 | Strict `aspect-ratio` on images; `next/font` zero-shift metric fallback; reserved header heights |
| **TTFB (Time to First Byte)** | **<= 200ms** | 201ms - 400ms | > 400ms | Static Edge replication; Brotli pre-compression |
| **FCP (First Contentful Paint)** | **<= 1.0s** | 1.1s - 1.8s | > 1.8s | Inlined critical CSS styles; no blocking external scripts |

---

## 2. Front-End Performance Budgets

To prevent performance regressions during sprint cycles, hard bundle limits are enforced in CI/CD:

```json
{
  "resourceSizes": [
    {
      "resourceType": "document",
      "budget": 30
    },
    {
      "resourceType": "script",
      "budget": 85
    },
    {
      "resourceType": "stylesheet",
      "budget": 25
    },
    {
      "resourceType": "image",
      "budget": 350
    },
    {
      "resourceType": "font",
      "budget": 60
    },
    {
      "resourceType": "total",
      "budget": 550
    }
  ],
  "resourceCounts": [
    {
      "resourceType": "script",
      "budget": 8
    },
    {
      "resourceType": "third-party",
      "budget": 4
    }
  ]
}
```

---

## 3. Engineering Implementation Details

### 3.1 Zero-CLS Typography via `next/font`
Fonts are configured in `src/app/layout.tsx` using `next/font/google`:
- Self-hosted automatically by Next.js during build (zero third-party requests to Google Fonts servers).
- Injected font metric adjustments (`size-adjust`, `ascent-override`, `descent-override`) eliminate layout shifts between system fallbacks and loaded web fonts.

### 3.2 Dynamic Component Lazy Loading
Non-critical below-the-fold UI elements (e.g. interactive FAQ accordions, video modals, cookie preference banners) are loaded dynamically using `next/dynamic`:

```typescript
import dynamic from 'next/dynamic';

const DynamicFaqAccordion = dynamic(
  () => import('@/components/FaqAccordion').then((mod) => mod.FaqAccordion),
  { ssr: true, loading: () => <div className="faq-skeleton" /> }
);
```

### 3.3 Third-Party Script Quarantine
Analytics and tag managers are strictly quarantined to prevent blocking page rendering:
- Loaded using `next/script` with `strategy="lazyOnload"`.
- Third-party scripts are forbidden on initial paint.
