import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/AppText';
import { formatIndicatorValue, indicatorNarrative, type indicatorSummary } from '@/lib/indicatorFormat';
import { svgImageSource } from '@/lib/svgImage';

const NAVY = '#0B1A26';
const YELLOW = '#FFF200';
const INK = '#1A1A00';
const TAB = 38;     // height the folder tab rises above the panel
const RADIUS = 22;

type Props = {
  title: string;
  source: string;
  unit: string;
  period?: string;
  noun: string;
  summary: NonNullable<ReturnType<typeof indicatorSummary>>;
};

/** Folder tab: flat on the left, an S-curve rising to a raised tab on the right. */
function folderTab(width: number) {
  const w = Math.round(width), start = Math.round(w * 0.42), rise = 64;
  const path = `M${start - 1},${TAB} L${start},${TAB} C${start + rise * 0.5},${TAB} ${start + rise * 0.5},0 ${start + rise},0 `
    + `L${w - RADIUS},0 Q${w},0 ${w},${RADIUS} L${w},${TAB} Z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${TAB}" viewBox="0 0 ${w} ${TAB}"><path d="${path}" fill="${YELLOW}"/></svg>`;
}

/** Summary card for one indicator: source tab, plain-language summary, name and two key figures. */
export function IndicatorHero({ title, source, unit, period, noun, summary }: Props) {
  const [width, setWidth] = useState(0);
  const tab = useMemo(() => width > 0 ? svgImageSource(folderTab(width), Math.round(width), TAB) : null, [width]);
  const meta = [unit, period].filter(Boolean).join(' · ');

  return (
    <View style={styles.card} accessibilityRole="summary" nativeID="indicator-hero">
      <View style={styles.folder} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
        <View style={styles.tabRow}>
          {tab ? <Image source={tab} style={StyleSheet.absoluteFill} contentFit="fill" accessible={false} /> : null}
          <View style={styles.label}><Text style={styles.labelText} numberOfLines={1}>{source.toUpperCase()}</Text></View>
          <Text style={styles.tabMeta} numberOfLines={1}>{meta}</Text>
        </View>
        <View style={styles.panel}>
          <Text style={styles.narrative}>{indicatorNarrative(summary, unit, noun)}</Text>
        </View>
      </View>

      <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>{title.toUpperCase()}</Text>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatIndicatorValue(String(summary.median), unit)}</Text>
          <Text style={styles.statLabel}>Median</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat}>
          <Text style={styles.statValue} numberOfLines={1}>{summary.count.toLocaleString('en-US')}</Text>
          <Text style={styles.statLabel}>{noun.charAt(0).toUpperCase() + noun.slice(1)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: NAVY, borderRadius: 28, paddingHorizontal: 18, paddingTop: 22, paddingBottom: 24 },
  folder: {},
  tabRow: { height: TAB, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { paddingHorizontal: 18, borderBottomWidth: 2, borderBottomColor: '#FFFFFF', paddingBottom: 3, marginBottom: 6 },
  labelText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', letterSpacing: 0.6 },
  tabMeta: { color: INK, fontSize: 12, fontWeight: '600', paddingRight: 18, maxWidth: '50%', textAlign: 'right' },
  panel: { backgroundColor: YELLOW, borderTopLeftRadius: RADIUS, borderBottomLeftRadius: RADIUS, borderBottomRightRadius: RADIUS, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 22 },
  narrative: { color: '#3A3A16', fontSize: 17, lineHeight: 26 },
  title: { color: '#FFFFFF', fontSize: 21, fontWeight: '700', letterSpacing: 0.4, textAlign: 'center', marginTop: 26 },
  stats: { flexDirection: 'row', alignItems: 'stretch', marginTop: 22 },
  stat: { flex: 1, alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  statValue: { color: '#FFFFFF', fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
  statLabel: { color: '#B8C0C8', fontSize: 15 },
  divider: { width: StyleSheet.hairlineWidth * 2, backgroundColor: '#5B6772' },
});
