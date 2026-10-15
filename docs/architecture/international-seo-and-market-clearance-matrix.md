# International SEO & Market Clearance Architecture

## 1. Global Market Taxonomy

The platform targets multi-regional expansion across North America, Europe, and international markets. Due to differing legal statutes regarding LGBTQ+ rights, internationalization is split into **Fully Approved Tier 1 Markets** and **Restricted / High-Risk Jurisdictions**.

### 1.1 Supported URL Locales

| Locale Code | Target Country / Region | Target Language | Currency | Indexable Dating Hubs |
| :--- | :--- | :--- | :--- | :--- |
| `en-US` | United States (Global Fallback) | English | USD ($) | Enabled (`/dating`, `/gay-dating`, etc.) |
| `en-GB` | United Kingdom | English | GBP (£) | Enabled (`/en-gb/dating`, etc.) |
| `de-DE` | Germany / Austria / Switzerland | German | EUR (€) | Enabled (`/de-de/dating`, etc.) |
| `fr-FR` | France / Belgium | French | EUR (€) | Enabled (`/fr-fr/dating`, etc.) |
| `es-ES` | Spain | Spanish | EUR (€) | Enabled (`/es-es/dating`, etc.) |
| `en-AE` | United Arab Emirates | English | AED (د.إ) | **GATED / RESTRICTED (Safety Info Only)** |
| `ar-AE` | United Arab Emirates | Arabic (RTL) | AED (د.إ) | **GATED / RESTRICTED (Safety Info Only)** |

---

## 2. Market Clearance Gatekeeper Protocol (UAE & High-Risk Jurisdictions)

> [!CAUTION]
> Under United Arab Emirates federal and emirate laws (e.g. Federal Decree Law No. 31/2021 Promulgating the Penal Code), consensual same-sex relations carry severe criminal sanctions. Promoting matchmaking or commercial dating services in this space exposes users and personnel to serious legal jeopardy.
>
> In strict accordance with platform requirements:
> **"Do not automatically publish or enable country-specific pages until the market's legal, operational, safety, and availability requirements have been reviewed."**

### 2.1 The Market Clearance Pipeline

Every regional market definition in code possesses an explicit clearance state:

```typescript
export interface MarketConfig {
  code: string;
  name: string;
  defaultLocale: string;
  currency: string;
  legalStatus: 'CLEARED_LEGAL' | 'RESTRICTED_SAFETY_ONLY' | 'BLOCKED_UNAVAILABLE';
  isDatingSearchIndexable: boolean;
  requiresDiscreteMode: boolean;
  advisoryMessage?: string;
}
```

```
[New Country / Locale Proposed]
                |
                v
  [1. Legal & Human Rights Review]
       - Penal code assessment
       - Cybercrime laws
       - Anti-LGBTQ+ enforcement risk
                |
                v
  [2. Operational & Payment Review]
       - Local payment gateways compliance
       - Local SMS verification safety
                |
                v
  [3. Safety Infrastructure Review]
       - Discrete app icon support
       - Emergency panic wipe button
       - Local crisis helpline integration
                |
       +--------+--------+
       |                 |
    PASSED            FAILED / HIGH RISK (e.g., UAE)
       |                 |
       v                 v
[Set status to:       [Set status to:
 'CLEARED_LEGAL']      'RESTRICTED_SAFETY_ONLY']
       |                 |
       |                 +--> Dating matchmaking routes return 404
       |                 +--> Sitemap excludes commercial pages
       |                 +--> Route renders Digital Privacy & Travel
       |                      Safety Advisory exclusively
       v
[Public SEO Landers Published]
```

### 2.2 UAE Market Specific Routing Behavior
When a user or crawler visits an `en-AE` or `ar-AE` route:
- `/en-ae/dating`, `/en-ae/gay-dating`: **Returns HTTP 404 (Not Found)** or redirects to global safety page.
- `/en-ae/safety`: **Returns 200 OK with discrete travel and digital safety guidelines**. Zero commercial dating copy, zero profile matching, zero misleading marketing claims.
- robots.txt and sitemaps exclude all UAE commercial URLs.

---

## 3. Hreflang Implementation & Reciprocal Annotations

Every indexable localized page includes self-referential and reciprocal `hreflang` tags across `<head>` and XML sitemaps:

```html
<!-- Canonical on US English -->
<link rel="canonical" href="https://www.example.com/gay-dating" />

<!-- Bidirectional Hreflang Tags -->
<link rel="alternate" hreflang="en-US" href="https://www.example.com/gay-dating" />
<link rel="alternate" hreflang="en-GB" href="https://www.example.com/en-gb/gay-dating" />
<link rel="alternate" hreflang="de-DE" href="https://www.example.com/de-de/gay-dating" />
<link rel="alternate" hreflang="fr-FR" href="https://www.example.com/fr-fr/gay-dating" />
<link rel="alternate" hreflang="x-default" href="https://www.example.com/gay-dating" />
```

### Anti-Duplication Rule:
English-speaking countries (e.g., US and UK) must never share identical programmatic text with only city names swapped. UK pages specifically address UK LGBTQ+ culture, Stonewall partnerships, NHS sexual health resources, and localized pricing in GBP (£).
