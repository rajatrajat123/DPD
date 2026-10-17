import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  ThemeId,
  ThemeMeta,
  ColorTheme,
  THEME_REGISTRY,
  THEME_METAS,
  midnightGoldTheme,
  colors,
} from './colors';
import { secureStorage } from '../services/storage/secureStore';

const THEME_STORAGE_KEY = 'aura_active_theme';

interface ThemeContextValue {
  themeId: ThemeId;
  colors: ColorTheme;
  themeMeta: ThemeMeta;
  themes: ThemeMeta[];
  setTheme: (id: ThemeId) => Promise<void>;
  isLoaded: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeId: 'midnight-gold',
  colors: midnightGoldTheme,
  themeMeta: THEME_METAS[0],
  themes: THEME_METAS,
  setTheme: async () => {},
  isLoaded: false,
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeId, setThemeIdState] = useState<ThemeId>('midnight-gold');
  const [isLoaded, setIsLoaded] = useState(false);
  const userSelectedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const saved = await secureStorage.getItem(THEME_STORAGE_KEY);
        // An older async storage read must never overwrite a newer user selection in this session
        if (mounted && !userSelectedRef.current && saved && THEME_REGISTRY[saved as ThemeId]) {
          const validSaved = saved as ThemeId;
          setThemeIdState(validSaved);
          Object.assign(colors, THEME_REGISTRY[validSaved]);
        }
      } catch (err) {
        if (__DEV__) {
          console.warn('[ThemeContext] Failed to load saved theme from storage:', err);
        }
      } finally {
        if (mounted) {
          setIsLoaded(true);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const setTheme = useCallback(async (newThemeId: ThemeId) => {
    if (!THEME_REGISTRY[newThemeId]) return;
    userSelectedRef.current = true;
    setThemeIdState(newThemeId);
    Object.assign(colors, THEME_REGISTRY[newThemeId]);
    try {
      await secureStorage.setItem(THEME_STORAGE_KEY, newThemeId);
    } catch (err) {
      if (__DEV__) {
        console.warn('[ThemeContext] Failed to persist theme to storage:', err);
      }
      throw err;
    }
  }, []);

  const currentColors = THEME_REGISTRY[themeId] || midnightGoldTheme;
  const currentMeta = THEME_METAS.find((m) => m.id === themeId) || THEME_METAS[0];

  // Guarantee the static colors object is always synchronized with the active theme
  Object.assign(colors, currentColors);

  return (
    <ThemeContext.Provider
      value={{
        themeId,
        colors: currentColors,
        themeMeta: currentMeta,
        themes: THEME_METAS,
        setTheme,
        isLoaded,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export function useThemeColors(): ColorTheme {
  const { colors: activeColors } = useTheme();
  return activeColors;
}
