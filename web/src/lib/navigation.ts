export interface NavItem {
  label: string;
  href: string;
  description?: string;
  badge?: string;
  isExternal?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * Public Primary Navigation (Luxury Editorial Standard)
 * Clean, uncluttered, focused on discovery, philosophy, trust, and membership.
 */
export const PRIMARY_PUBLIC_NAV: NavItem[] = [
  { label: 'How It Works', href: '/how-it-works' },
  { label: 'Safety & Privacy', href: '/safety' },
  { label: 'Membership', href: '/pricing' },
];

/**
 * Curated Community SEO Hubs
 * Retained for rich SEO crawlability and direct intent landing pages,
 * accessible through contextual links, the communities menu, and the footer.
 */
export const COMMUNITY_HUBS: NavItem[] = [
  {
    label: 'Gay Dating',
    href: '/gay-dating',
    description: 'Intentional gay matchmaking built on mutual values, verified profiles, and discretion.',
  },
  {
    label: 'Lesbian & WLW',
    href: '/lesbian-dating',
    description: 'A bot-free, verified haven for queer women seeking authentic romance and community.',
  },
  {
    label: 'Bisexual Dating',
    href: '/bisexual-dating',
    description: 'Date freely without stereotypes or biphobia, supported by nuanced visibility controls.',
  },
  {
    label: 'Queer & Non-Binary',
    href: '/queer-dating',
    description: 'Gender-affirming matchmaking welcoming all identities on the expansive spectrum.',
  },
  {
    label: 'Intentional Relationships',
    href: '/dating',
    description: 'Lifestyle-aligned matchmaking filtered by relationship structure and dealbreakers.',
  },
];

/**
 * Authenticated App Navigation
 */
export const APP_NAV_ITEMS: NavItem[] = [
  { label: 'Discover', href: '/app/discovery' },
  { label: 'Matches', href: '/app/matches' },
  { label: 'Messages', href: '/app/messages' },
  { label: 'Profile', href: '/app/profile' },
];

/**
 * Footer Crawlable Taxonomy & Legal Navigation
 */
export const FOOTER_SECTIONS: NavSection[] = [
  {
    title: 'Curated Communities',
    items: [
      { label: 'Gay Dating App', href: '/gay-dating' },
      { label: 'Lesbian & WLW Dating', href: '/lesbian-dating' },
      { label: 'Bisexual Dating Community', href: '/bisexual-dating' },
      { label: 'Queer & Non-Binary Dating', href: '/queer-dating' },
      { label: 'Intentional Relationships', href: '/dating' },
    ],
  },
  {
    title: 'Trust & Privacy',
    items: [
      { label: 'Dating Safety Guide', href: '/safety' },
      { label: 'Discretion & Traveler Mode', href: '/safety#discretion' },
      { label: 'Photo Verification Standards', href: '/safety#verification' },
      { label: 'Crisis Support Resources', href: '/safety#resources' },
    ],
  },
  {
    title: 'Platform',
    items: [
      { label: 'How It Works', href: '/how-it-works' },
      { label: 'Features & Architecture', href: '/features' },
      { label: 'Membership Tiers', href: '/pricing' },
      { label: 'Download iOS & Android', href: '/download' },
    ],
  },
  {
    title: 'Legal & Ethics',
    items: [
      { label: 'Privacy Policy (GDPR/CCPA)', href: '/legal/privacy' },
      { label: 'Terms of Service', href: '/legal/terms' },
      { label: 'Age Assurance Policy (18+)', href: '/legal/terms#age' },
    ],
  },
];
