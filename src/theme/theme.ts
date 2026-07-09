export type ThemeColors = {
  background: string;
  card: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  accent: string;
  danger: string;
  warning: string;
  inputBackground: string;
  chipBackground: string;
  modalBackdrop: string;
};

export const lightColors: ThemeColors = {
  background: '#ffffff',
  card: '#f5f5f5',
  text: '#1a1a1a',
  textSecondary: '#666666',
  textMuted: '#999999',
  border: '#cccccc',
  accent: '#0a7d32',
  danger: '#c0392b',
  warning: '#d9822b',
  inputBackground: '#ffffff',
  chipBackground: '#eeeeee',
  modalBackdrop: 'rgba(0,0,0,0.4)',
};

/** Converts a #rrggbb hex color to an rgba() string, for APIs (like chart-kit) that only accept rgba functions. */
export function hexToRgba(hex: string, opacity: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export const darkColors: ThemeColors = {
  background: '#0b1220',
  card: '#161f2e',
  text: '#f0f0f0',
  textSecondary: '#a0a8b8',
  textMuted: '#7a8394',
  border: '#2a3548',
  accent: '#2ecc71',
  danger: '#ff6b5e',
  warning: '#f0a94e',
  inputBackground: '#1c2536',
  chipBackground: '#1c2536',
  modalBackdrop: 'rgba(0,0,0,0.65)',
};
