/**
 * Aura Luxury Mobile Palette & Multi-Theme System
 * Supported themes: Midnight Gold, Pride Spectrum, Youth Pop, Lavender, and Ocean.
 */

export type ThemeId = 'midnight-gold' | 'pride-spectrum' | 'youth-pop' | 'lavender' | 'ocean';

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  tagline: string;
  badgeEmoji: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  cardColor: string;
}

export const midnightGoldTheme = {
  // Primary Backgrounds
  background: '#090A0E',
  backgroundElevated: '#12141C',
  card: '#161922',
  cardElevated: '#1E222F',
  cardMuted: '#13151D',
  overlay: 'rgba(9, 10, 14, 0.88)',

  // Borders & Dividers
  border: '#242835',
  borderSubtle: '#1C1F2A',
  borderFocus: '#D4AF37',

  // Text Hierarchy
  text: '#F5EFE6',
  textMuted: '#9DA4B4',
  textSubtle: '#636A7E',
  textInverse: '#090A0E',

  // Luxury Accents
  gold: '#D4AF37',
  goldLight: '#E8CA6B',
  goldDark: '#997E26',
  goldMuted: 'rgba(212, 175, 55, 0.15)',

  // Semantic Colors
  oxblood: '#702F36',
  oxbloodMuted: 'rgba(112, 47, 54, 0.25)',
  emerald: '#10B981',
  emeraldMuted: 'rgba(16, 185, 129, 0.15)',
  amber: '#F59E0B',
  amberMuted: 'rgba(245, 158, 11, 0.15)',
  ruby: '#EF4444',
  rubyMuted: 'rgba(239, 68, 68, 0.15)',
  purple: '#8B5CF6',
  purpleMuted: 'rgba(139, 92, 246, 0.2)',

  // Swipe Action Colors
  pass: '#252833',
  passIcon: '#9DA4B4',
  like: '#E53935',
  likeMuted: 'rgba(229, 57, 53, 0.16)',
  superSpark: '#D4AF37',
  rewind: '#C3A15B',

  // Aliases
  textPrimary: '#F5EFE6',
  primaryRed: '#E53935',
} as const;

export const prideSpectrumTheme = {
  background: '#0D0B18',
  backgroundElevated: '#171329',
  card: '#1F1936',
  cardElevated: '#2A2249',
  cardMuted: '#151125',
  overlay: 'rgba(13, 11, 24, 0.90)',

  border: '#35295C',
  borderSubtle: '#241C3E',
  borderFocus: '#EC4899',

  text: '#FDF2F8',
  textMuted: '#C4B5FD',
  textSubtle: '#7C6F9E',
  textInverse: '#0D0B18',

  gold: '#EC4899',
  goldLight: '#F472B6',
  goldDark: '#DB2777',
  goldMuted: 'rgba(236, 72, 153, 0.18)',

  oxblood: '#9D174D',
  oxbloodMuted: 'rgba(157, 23, 77, 0.25)',
  emerald: '#10B981',
  emeraldMuted: 'rgba(16, 185, 129, 0.15)',
  amber: '#F59E0B',
  amberMuted: 'rgba(245, 158, 11, 0.15)',
  ruby: '#EF4444',
  rubyMuted: 'rgba(239, 68, 68, 0.15)',
  purple: '#A855F7',
  purpleMuted: 'rgba(168, 85, 247, 0.2)',

  pass: '#241C3E',
  passIcon: '#C4B5FD',
  like: '#EC4899',
  likeMuted: 'rgba(236, 72, 153, 0.2)',
  superSpark: '#FBBF24',
  rewind: '#A855F7',

  textPrimary: '#FDF2F8',
  primaryRed: '#EC4899',
} as const;

export const youthPopTheme = {
  background: '#0C0E1A',
  backgroundElevated: '#141829',
  card: '#1A2038',
  cardElevated: '#242C4D',
  cardMuted: '#111424',
  overlay: 'rgba(12, 14, 26, 0.90)',

  border: '#2A3459',
  borderSubtle: '#1E2540',
  borderFocus: '#FF5376',

  text: '#F0F4FF',
  textMuted: '#94A3B8',
  textSubtle: '#64748B',
  textInverse: '#0C0E1A',

  gold: '#FF5376',
  goldLight: '#FF7593',
  goldDark: '#E03257',
  goldMuted: 'rgba(255, 83, 118, 0.18)',

  oxblood: '#BE123C',
  oxbloodMuted: 'rgba(190, 18, 60, 0.25)',
  emerald: '#10B981',
  emeraldMuted: 'rgba(16, 185, 129, 0.15)',
  amber: '#FFE066',
  amberMuted: 'rgba(255, 224, 102, 0.18)',
  ruby: '#FF3366',
  rubyMuted: 'rgba(255, 51, 102, 0.18)',
  purple: '#818CF8',
  purpleMuted: 'rgba(129, 140, 248, 0.2)',

  pass: '#212842',
  passIcon: '#94A3B8',
  like: '#FF5376',
  likeMuted: 'rgba(255, 83, 118, 0.2)',
  superSpark: '#FFE066',
  rewind: '#38BDF8',

  textPrimary: '#F0F4FF',
  primaryRed: '#FF5376',
} as const;

export const lavenderTheme = {
  background: '#110D1B',
  backgroundElevated: '#1A1429',
  card: '#221B36',
  cardElevated: '#2E2449',
  cardMuted: '#161124',
  overlay: 'rgba(17, 13, 27, 0.90)',

  border: '#3B2E5C',
  borderSubtle: '#281F3E',
  borderFocus: '#C084FC',

  text: '#F5F3FF',
  textMuted: '#C4B5FD',
  textSubtle: '#7E6F9F',
  textInverse: '#110D1B',

  gold: '#C084FC',
  goldLight: '#D8B4FE',
  goldDark: '#A855F7',
  goldMuted: 'rgba(192, 132, 252, 0.18)',

  oxblood: '#86198F',
  oxbloodMuted: 'rgba(134, 25, 143, 0.25)',
  emerald: '#10B981',
  emeraldMuted: 'rgba(16, 185, 129, 0.15)',
  amber: '#FBBF24',
  amberMuted: 'rgba(251, 191, 36, 0.15)',
  ruby: '#F43F5E',
  rubyMuted: 'rgba(244, 63, 94, 0.15)',
  purple: '#C084FC',
  purpleMuted: 'rgba(192, 132, 252, 0.2)',

  pass: '#281F3E',
  passIcon: '#C4B5FD',
  like: '#E879F9',
  likeMuted: 'rgba(232, 121, 249, 0.2)',
  superSpark: '#FDE047',
  rewind: '#C084FC',

  textPrimary: '#F5F3FF',
  primaryRed: '#E879F9',
} as const;

export const oceanTheme = {
  background: '#07131E',
  backgroundElevated: '#0E1F30',
  card: '#132B42',
  cardElevated: '#1B3B59',
  cardMuted: '#0A1927',
  overlay: 'rgba(7, 19, 30, 0.90)',

  border: '#1E4366',
  borderSubtle: '#142F48',
  borderFocus: '#06B6D4',

  text: '#F0FDF4',
  textMuted: '#93C5FD',
  textSubtle: '#4B749F',
  textInverse: '#07131E',

  gold: '#06B6D4',
  goldLight: '#67E8F9',
  goldDark: '#0891B2',
  goldMuted: 'rgba(6, 182, 212, 0.18)',

  oxblood: '#1E3A8A',
  oxbloodMuted: 'rgba(30, 58, 138, 0.25)',
  emerald: '#10B981',
  emeraldMuted: 'rgba(16, 185, 129, 0.15)',
  amber: '#38BDF8',
  amberMuted: 'rgba(56, 189, 248, 0.18)',
  ruby: '#EF4444',
  rubyMuted: 'rgba(239, 68, 68, 0.15)',
  purple: '#38BDF8',
  purpleMuted: 'rgba(56, 189, 248, 0.2)',

  pass: '#142F48',
  passIcon: '#93C5FD',
  like: '#06B6D4',
  likeMuted: 'rgba(6, 182, 212, 0.2)',
  superSpark: '#38BDF8',
  rewind: '#67E8F9',

  textPrimary: '#F0FDF4',
  primaryRed: '#06B6D4',
} as const;

export type ColorTheme = {
  // Primary Backgrounds
  background: string;
  backgroundElevated: string;
  card: string;
  cardElevated: string;
  cardMuted: string;
  overlay: string;

  // Borders & Dividers
  border: string;
  borderSubtle: string;
  borderFocus: string;

  // Text Hierarchy
  text: string;
  textMuted: string;
  textSubtle: string;
  textInverse: string;

  // Luxury Accents
  gold: string;
  goldLight: string;
  goldDark: string;
  goldMuted: string;

  // Semantic Colors
  oxblood: string;
  oxbloodMuted: string;
  emerald: string;
  emeraldMuted: string;
  amber: string;
  amberMuted: string;
  ruby: string;
  rubyMuted: string;
  purple: string;
  purpleMuted: string;

  // Swipe Action Colors
  pass: string;
  passIcon: string;
  like: string;
  likeMuted: string;
  superSpark: string;
  rewind: string;

  // Aliases
  textPrimary: string;
  primaryRed: string;
};

export const THEME_REGISTRY: Record<ThemeId, ColorTheme> = {
  'midnight-gold': midnightGoldTheme,
  'pride-spectrum': prideSpectrumTheme,
  'youth-pop': youthPopTheme,
  'lavender': lavenderTheme,
  'ocean': oceanTheme,
};

export const THEME_METAS: ThemeMeta[] = [
  {
    id: 'midnight-gold',
    name: 'Midnight Gold',
    tagline: 'Luxury Champagne & Obsidian',
    badgeEmoji: '✨',
    primaryColor: '#D4AF37',
    secondaryColor: '#E8CA6B',
    backgroundColor: '#090A0E',
    cardColor: '#161922',
  },
  {
    id: 'pride-spectrum',
    name: 'Pride Spectrum',
    tagline: 'Inclusive Rainbow Radiance',
    badgeEmoji: '🌈',
    primaryColor: '#EC4899',
    secondaryColor: '#A855F7',
    backgroundColor: '#0D0B18',
    cardColor: '#1F1936',
  },
  {
    id: 'youth-pop',
    name: 'Youth Pop',
    tagline: 'Electric Neon & Coral Energy',
    badgeEmoji: '⚡',
    primaryColor: '#FF5376',
    secondaryColor: '#FFE066',
    backgroundColor: '#0C0E1A',
    cardColor: '#1A2038',
  },
  {
    id: 'lavender',
    name: 'Lavender',
    tagline: 'Dreamy Twilight Mauve',
    badgeEmoji: '🪻',
    primaryColor: '#C084FC',
    secondaryColor: '#E9D5FF',
    backgroundColor: '#110D1B',
    cardColor: '#221B36',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    tagline: 'Abyssal Navy & Bioluminescent Cyan',
    badgeEmoji: '🌊',
    primaryColor: '#06B6D4',
    secondaryColor: '#38BDF8',
    backgroundColor: '#07131E',
    cardColor: '#132B42',
  },
];

// Default export maintains compatibility with existing static imports
export const colors: ColorTheme = midnightGoldTheme;
