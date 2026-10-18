import { Platform, TextStyle } from 'react-native';

export const fontFamily = {
  serif: Platform.select({
    ios: 'Georgia',
    android: 'serif',
    default: 'serif',
  }),
  sans: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: 'sans-serif',
  }),
};

export const typography: Record<string, TextStyle> = {
  display: {
    fontFamily: fontFamily.serif,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  h1: {
    fontFamily: fontFamily.serif,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  h2: {
    fontFamily: fontFamily.serif,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  h3: {
    fontFamily: fontFamily.sans,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  bodyLarge: {
    fontFamily: fontFamily.sans,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400',
  },
  body: {
    fontFamily: fontFamily.sans,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
  },
  bodySmall: {
    fontFamily: fontFamily.sans,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
  },
  caption: {
    fontFamily: fontFamily.sans,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  button: {
    fontFamily: fontFamily.sans,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
};
