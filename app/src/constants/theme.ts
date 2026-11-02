import '@/global.css';

import { Platform } from 'react-native';

/** Light fintech palette inspired by the BullFin home reference */
export const Palette = {
  bg: '#F4F5FB',
  bgElevated: '#FFFFFF',
  card: '#FFFFFF',
  cardHover: '#F7F7FC',
  border: '#ECEEF6',
  borderSubtle: '#F0F1F7',
  text: '#16181D',
  textSecondary: '#8E93A6',
  textMuted: '#B0B4C3',
  green: '#1DB954',
  red: '#F43F5E',
  accent: '#0066FF',
  accentMuted: '#EEF4FF',
  yellow: '#F0B90B',
  orange: '#FF9800',
  overlay: 'rgba(17,18,28,0.4)',
  pill: '#F3F4F8',
} as const;

export const Colors = {
  light: {
    text: '#0B0E11',
    background: '#F5F7FA',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E8ECF1',
    textSecondary: '#5E6673',
    border: '#DCE1E8',
    green: Palette.green,
    red: Palette.red,
    accent: Palette.accent,
    card: '#FFFFFF',
  },
  dark: {
    text: Palette.text,
    background: Palette.bg,
    backgroundElement: Palette.card,
    backgroundSelected: Palette.cardHover,
    textSecondary: Palette.textSecondary,
    border: Palette.border,
    green: Palette.green,
    red: Palette.red,
    accent: Palette.accent,
    card: Palette.card,
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 960;
