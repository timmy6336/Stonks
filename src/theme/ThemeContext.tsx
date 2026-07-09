import React, { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';
import { darkColors, lightColors, type ThemeColors } from './theme';

type ThemeContextValue = {
  colors: ThemeColors;
  scheme: 'light' | 'dark';
};

const ThemeContext = createContext<ThemeContextValue>({ colors: lightColors, scheme: 'light' });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = scheme === 'dark' ? darkColors : lightColors;
  return <ThemeContext.Provider value={{ colors, scheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
