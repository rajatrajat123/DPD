import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  ThemeId,
  ThemeMeta,
  ColorTheme,
  THEME_REGISTRY,
  THEME_METAS,
  midnightGoldTheme,
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

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const saved = await secureStorage.getItem(THEME_STORAGE_KEY);
        if (mounted && saved && THEME_REGISTRY[saved as ThemeId]) {
          setThemeIdState(saved as ThemeId);
        }
      } catch {
        // Fallback to default theme
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
    setThemeIdState(newThemeId);
    try {
      await secureStorage.setItem(THEME_STORAGE_KEY, newThemeId);
    } catch {
      // Retain in memory
    }
  }, []);

  const currentColors = THEME_REGISTRY[themeId] || midnightGoldTheme;
  const currentMeta = THEME_METAS.find((m) => m.id === themeId) || THEME_METAS[0];

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
