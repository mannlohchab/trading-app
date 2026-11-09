import '@/global.css';

import { Platform } from 'react-native';

/** Light fintech surfaces. Accent stays the brand blue. */
export const Palette = {
  bg: '#F4F5FB',
  bgElevated: '#FFFFFF',
  card: '#FFFFFF',
  cardHover: '#F7F7FC',
  border: '#E3E6F0',
  borderSubtle: '#ECEEF6',
  text: '#16181D',
  textSecondary: '#6B7185',
  textMuted: '#9A9FB0',
  green: '#16A34A',
  red: '#E11D48',
  accent: '#0066FF',
  accentMuted: '#EEF4FF',
  yellow: '#C98A00',
  orange: '#E68A00',
  overlay: 'rgba(17,18,28,0.4)',
  pill: '#F0F1F7',
} as const;

/** Warm light theme for Insights and Community. `onSolid` labels sit on `text` fills. */
export const InsightPalette = {
  bg: '#F7F7F5',
  bgElevated: '#FFFFFF',
  card: '#FFFFFF',
  soft: '#EDEDEA',
  border: '#E6E6E2',
  borderSubtle: '#EDEDEA',
  text: '#1F1F1E',
  body: '#3D3D3A',
  textSecondary: '#6B6B67',
  textMuted: '#8A8A86',
  accent: '#1F1F1E',
  accentMuted: '#EDEDEA',
  red: '#DC2626',
  yellow: '#1F1F1E',
  onSolid: '#FFFFFF',
} as const;

const lightColors = {
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
} as const;

// The app ships a single light theme regardless of the device setting.
export const Colors = {
  light: lightColors,
  dark: lightColors,
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

// The AI welcome heading's serif family is the default throughout the app.
export const AppFont = Fonts.serif;

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
