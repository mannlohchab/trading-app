import { StyleSheet } from 'react-native';

import {
  Colors,
  InsightPalettes,
  Palettes,
  type ColorScheme,
  type InsightPaletteColors,
  type PaletteColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export { useColorScheme };

/** Fintech colours for the active theme. */
export function usePalette(): PaletteColors {
  return Palettes[useColorScheme()];
}

/** Warm Insights/Community colours for the active theme. */
export function useInsightPalette(): InsightPaletteColors {
  return InsightPalettes[useColorScheme()];
}

/** Navigation-style colour roles for the active theme. */
export function useTheme() {
  return Colors[useColorScheme()];
}

/** The object shape `StyleSheet.create` accepts. */
type NamedStyles = Parameters<typeof StyleSheet.create>[0];

/**
 * Themed replacement for a module-level `StyleSheet.create`. Returns a hook; each scheme's sheet is
 * built once and reused, so calling it on every render is cheap.
 *
 *   const useStyles = makeStyles((Palette) => ({ card: { backgroundColor: Palette.card } }));
 *   function Card() { const styles = useStyles(); ... }
 */
export function makeStyles<S extends NamedStyles>(
  factory: (palette: PaletteColors, insight: InsightPaletteColors, scheme: ColorScheme) => S & NamedStyles,
): () => Readonly<S> {
  const sheets: Partial<Record<ColorScheme, Readonly<S>>> = {};
  return function useStyles() {
    const scheme = useColorScheme();
    return (sheets[scheme] ??= StyleSheet.create(factory(Palettes[scheme], InsightPalettes[scheme], scheme)));
  };
}
