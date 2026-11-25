import '@/global.css';

import { Platform } from 'react-native';

export type ColorScheme = 'light' | 'dark';

/** Light fintech surfaces. Accent stays the brand blue. */
const LightPalette = {
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
  /** Labels and icons on an `accent`, `green` or `red` fill. */
  onAccent: '#FFFFFF',
  /** Accent-coloured text on `accentMuted` or plain surfaces. */
  accentText: '#0052D6',
  success: '#059669',
  greenMuted: '#ECFDF3',
  redMuted: '#FEF2F2',
  purple: '#6F47E9',
  purpleMuted: '#F3EEFF',
  /** A near-black fill in light mode that flips to near-white in dark mode, with `onInverse` labels. */
  inverse: '#16181D',
  onInverse: '#FFFFFF',
  shadow: '#000000',
  chartBg: '#FFFFFF',
  chartText: '#131722',
  chartMuted: '#787B86',
  chartGrid: '#E0E3EB',
  chartCrosshair: '#9598A1',
  chartUp: '#089981',
  chartDown: '#F23645',
  chartLine: '#2962FF',
};

export type PaletteColors = { readonly [K in keyof typeof LightPalette]: string };

/** Dark fintech surfaces: cool near-black layers, brighter brand blue for contrast. */
const DarkPalette: PaletteColors = {
  bg: '#0B0D12',
  bgElevated: '#12151C',
  card: '#151922',
  cardHover: '#1B202B',
  border: '#262B37',
  borderSubtle: '#1E232E',
  text: '#ECEEF4',
  textSecondary: '#A0A6B8',
  textMuted: '#6E7487',
  green: '#22C55E',
  red: '#F43F5E',
  accent: '#3D8BFF',
  accentMuted: '#14223D',
  yellow: '#E5A823',
  orange: '#F59E0B',
  overlay: 'rgba(0,0,0,0.6)',
  pill: '#1E2330',
  onAccent: '#FFFFFF',
  accentText: '#7DB0FF',
  success: '#34D399',
  greenMuted: '#0F2418',
  redMuted: '#2A1418',
  purple: '#A78BFA',
  purpleMuted: '#221A38',
  inverse: '#ECEEF4',
  onInverse: '#0B0D12',
  shadow: '#000000',
  chartBg: '#12151C',
  chartText: '#D1D4DC',
  chartMuted: '#8A8F9C',
  chartGrid: '#232733',
  chartCrosshair: '#5D6270',
  chartUp: '#26A69A',
  chartDown: '#F6465D',
  chartLine: '#4A7DFF',
};

/** Warm light theme for Insights and Community. `onSolid` labels sit on `text` fills. */
const LightInsightPalette = {
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
};

export type InsightPaletteColors = { readonly [K in keyof typeof LightInsightPalette]: string };

/** Warm dark theme for Insights and Community. */
const DarkInsightPalette: InsightPaletteColors = {
  bg: '#141413',
  bgElevated: '#1C1C1A',
  card: '#1C1C1A',
  soft: '#262624',
  border: '#2E2E2B',
  borderSubtle: '#262624',
  text: '#EDEDEA',
  body: '#CFCFCA',
  textSecondary: '#A3A39E',
  textMuted: '#7D7D78',
  accent: '#EDEDEA',
  accentMuted: '#262624',
  red: '#F87171',
  yellow: '#EDEDEA',
  onSolid: '#141413',
};

export const Palettes: Record<ColorScheme, PaletteColors> = { light: LightPalette, dark: DarkPalette };
export const InsightPalettes: Record<ColorScheme, InsightPaletteColors> = { light: LightInsightPalette, dark: DarkInsightPalette };

function navigationColors(p: PaletteColors) {
  return {
    text: p.text,
    background: p.bg,
    backgroundElement: p.card,
    backgroundSelected: p.cardHover,
    textSecondary: p.textSecondary,
    border: p.border,
    green: p.green,
    red: p.red,
    accent: p.accent,
    card: p.card,
  };
}

export const Colors = {
  light: navigationColors(LightPalette),
  dark: navigationColors(DarkPalette),
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
