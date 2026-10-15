export interface MarketPolicy {
  code: string;
  name: string;
  defaultLocale: string;
  currency: string;
  currencySymbol: string;
  legalStatus: 'CLEARED_LEGAL' | 'RESTRICTED_SAFETY_ONLY' | 'BLOCKED_UNAVAILABLE';
  isDatingSearchIndexable: boolean;
  requiresDiscreteMode: boolean;
  advisoryNote?: string;
}

export interface IntentCategory {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  heading: string;
  subheading: string;
  heroCopy: string;
  faqs: Array<{ question: string; answer: string }>;
}

export const SITE_CONFIG = {
  name: 'Aura Dating',
  tagline: 'Authentic, Safe LGBTQ+ Connections',
  baseUrl: process.env.NEXT_PUBLIC_SITE_URL || 'https://www.auradating.com',
  defaultOgImage: 'https://assets.auradating.com/seo/aura-og-card-1200x630.jpg',
  twitterHandle: '@AuraDatingApp',
  supportEmail: 'safety@auradating.com',
  companyLegalName: 'Aura Social Technologies, Inc.',
  googleSiteVerification: 'GSC_VERIFICATION_TOKEN_AURA_PROD',
  bingSiteVerification: 'BING_VERIFICATION_TOKEN_AURA_PROD',
  /**
   * Region-specific restrictions are disabled by default until applicable
   * product, legal, and safety requirements have been reviewed and approved.
   */
  enableRegionalRestrictions: false,
};

/**
 * Global Markets Clearance Matrix.
 * Markets are strictly locked until legal and safety audits are completed.
 */
export const MARKET_CLEARANCE_REGISTRY: Record<string, MarketPolicy> = {
  us: {
    code: 'us',
    name: 'United States',
    defaultLocale: 'en-US',
    currency: 'USD',
    currencySymbol: '$',
    legalStatus: 'CLEARED_LEGAL',
    isDatingSearchIndexable: true,
    requiresDiscreteMode: false,
  },
  uk: {
    code: 'uk',
    name: 'United Kingdom',
    defaultLocale: 'en-GB',
    currency: 'GBP',
    currencySymbol: '£',
    legalStatus: 'CLEARED_LEGAL',
    isDatingSearchIndexable: true,
    requiresDiscreteMode: false,
  },
  de: {
    code: 'de',
    name: 'Germany',
    defaultLocale: 'de-DE',
    currency: 'EUR',
    currencySymbol: '€',
    legalStatus: 'CLEARED_LEGAL',
    isDatingSearchIndexable: true,
    requiresDiscreteMode: false,
  },
  fr: {
    code: 'fr',
    name: 'France',
    defaultLocale: 'fr-FR',
    currency: 'EUR',
    currencySymbol: '€',
    legalStatus: 'CLEARED_LEGAL',
    isDatingSearchIndexable: true,
    requiresDiscreteMode: false,
  },
  ae: {
    code: 'ae',
    name: 'United Arab Emirates',
    defaultLocale: 'en-AE',
    currency: 'AED',
    currencySymbol: 'د.إ',
    legalStatus: 'RESTRICTED_SAFETY_ONLY',
    isDatingSearchIndexable: false, // Strictly false: matchmaking indexing blocked
    requiresDiscreteMode: true,
    advisoryNote:
      'Matchmaking is disabled in this region to protect user safety under local legal frameworks. Only digital privacy and international travel safety resources are displayed.',
  },
};

/**
 * Dedicated Public Intent Landing Pages
 */
export const INTENT_CATEGORIES: Record<string, IntentCategory> = {
  'gay-dating': {
    slug: 'gay-dating',
    title: 'Gay Dating',
    metaTitle: 'Gay Dating App for Authentic Connections',
    metaDescription:
      'Join Aura, the premier gay dating app built for meaningful relationships, authentic profiles, verified safety, and shared community values.',
    heading: 'Gay Dating Reimagined for Authentic Connections',
    subheading: 'Move beyond superficial swipes with photo verification and intentional matchmaking.',
    heroCopy:
      'Aura provides a safe, discrete, and affirming space for gay men seeking genuine connections, deep relationships, and vibrant community.',
    faqs: [
      {
        question: 'How does Aura protect the privacy of gay members?',
        answer:
          'Aura enforces strict photo verification, granular privacy controls, discrete icon mode, and zero third-party data selling. Your exact GPS coordinates are never displayed.',
      },
      {
        question: 'Is Aura designed for serious relationships or casual dating?',
        answer:
          'Aura features dedicated relationship-intent filters so you only connect with men looking for the same relationship goals as you.',
      },
    ],
  },
  'lesbian-dating': {
    slug: 'lesbian-dating',
    title: 'Lesbian Dating',
    metaTitle: 'Lesbian & WLW Dating App',
    metaDescription:
      'A welcoming, safe space for lesbian, queer, and wlw women to meet, date, and build lasting relationships with verified profiles.',
    heading: 'Lesbian & Queer Women Dating Built on Trust',
    subheading: 'Find your person in an inclusive, bot-free community crafted specifically for queer women.',
    heroCopy:
      'Whether you are looking for long-term love, queer companionship, or local community events, Aura puts woman-aligned safety first.',
    faqs: [
      {
        question: 'How does Aura prevent catfishing on lesbian dating pages?',
        answer:
          'Every profile must undergo mandatory selfie verification and multi-step moderation before receiving the verified badge.',
      },
    ],
  },
  'bisexual-dating': {
    slug: 'bisexual-dating',
    title: 'Bisexual Dating',
    metaTitle: 'Bisexual Dating App | Affirming Community',
    metaDescription:
      'Meet open-minded partners on Aura, the bisexual-affirming dating platform designed without assumptions or biphobic stereotypes.',
    heading: 'A Dating Space That Truly Understands Bisexuality',
    subheading: 'Date whoever you want without intrusive questions or assumptions.',
    heroCopy:
      'Celebrate your full identity with custom visibility controls, poly-friendly indicators, and genuine community support.',
    faqs: [
      {
        question: 'Can I customize who sees my profile?',
        answer:
          'Yes. Aura allows members to tailor their discovery preferences and choose exactly who can view their profile.',
      },
    ],
  },
  'queer-dating': {
    slug: 'queer-dating',
    title: 'Queer Dating',
    metaTitle: 'Queer & Non-Binary Dating App',
    metaDescription:
      'A truly inclusive dating app welcoming all genders and orientations. Experience gender-affirming profiles and compassionate matching.',
    heading: 'Inclusive Queer Dating for Every Gender & Orientation',
    subheading: 'Celebrate diversity with robust pronoun selection, identity tags, and safe community norms.',
    heroCopy:
      'Aura was built from the ground up to celebrate the entire LGBTQ+ spectrum, providing gender-affirming options and strict anti-harassment protections.',
    faqs: [
      {
        question: 'Does Aura support non-binary and trans identities?',
        answer:
          'Absolutely. We offer over 50 gender identities, custom pronouns, and zero-tolerance policies against deadnaming or harassment.',
      },
    ],
  },
};
