/**
 * Aura Luxury Mobile Palette
 * Inspired by classic editorial design, warm parchment, champagne gold,
 * and restrained Pride accents.
 */
export const colors = {
  // Primary Backgrounds
  background: '#090A0E',        // Premium near-black
  backgroundElevated: '#12141C',// Slightly elevated charcoal surface
  card: '#161922',              // Premium charcoal card
  cardElevated: '#1E222F',      // Elevated charcoal card
  cardMuted: '#13151D',         // Recessed charcoal card
  overlay: 'rgba(9, 10, 14, 0.88)', // Modal overlay

  // Borders & Dividers
  border: '#242835',            // Subtle slate border
  borderSubtle: '#1C1F2A',      // Very subtle divider
  borderFocus: '#D4AF37',       // Refined gold active border

  // Text Hierarchy
  text: '#F5EFE6',              // Warm ivory primary text
  textMuted: '#9DA4B4',         // Muted secondary text
  textSubtle: '#636A7E',        // Low-emphasis tertiary text
  textInverse: '#090A0E',       // Dark text on gold/light buttons

  // Luxury Accents
  gold: '#D4AF37',              // Champagne gold primary accent
  goldLight: '#E8CA6B',         // Highlight gold
  goldDark: '#997E26',          // Subtle gold border/shadow
  goldMuted: 'rgba(212, 175, 55, 0.15)', // Gold tinted badge background

  // Restrained Pride & Semantic Colors
  oxblood: '#702F36',           // Restrained crimson/oxblood
  oxbloodMuted: 'rgba(112, 47, 54, 0.25)',
  emerald: '#10B981',           // Success / Active online / Verified
  emeraldMuted: 'rgba(16, 185, 129, 0.15)',
  amber: '#F59E0B',             // Warning / Pending verification
  amberMuted: 'rgba(245, 158, 11, 0.15)',
  ruby: '#EF4444',              // Error / Pass action / Delete
  rubyMuted: 'rgba(239, 68, 68, 0.15)',
  purple: '#8B5CF6',            // Super spark / Boost accent
  purpleMuted: 'rgba(139, 92, 246, 0.2)',

  // Swipe Action Specific Colors (Red Like button per dating app reference)
  pass: '#252833',
  passIcon: '#9DA4B4',
  like: '#E53935',              // Red Like button
  likeMuted: 'rgba(229, 57, 53, 0.16)',
  superSpark: '#D4AF37',
  rewind: '#C3A15B',
} as const;

export type ColorTheme = typeof colors;
