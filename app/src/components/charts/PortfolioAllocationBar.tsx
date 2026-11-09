import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/AppText';
import { Palette } from '@/constants/theme';
import { formatUsd } from '@/lib/format';
import { buildPortfolioBreakdown, type PortfolioAllocationInput } from '@/lib/portfolioAllocation';

type Props = { portfolio?: PortfolioAllocationInput; loading?: boolean };

const percent = (share: number) => `${(share * 100).toFixed(share > 0 && share < 0.001 ? 2 : 1)}%`;

/** Portfolio split as one segmented bar: each holding, then cash. Tap a segment or legend item to focus it. */
export function PortfolioAllocationBar({ portfolio, loading }: Props) {
  const breakdown = useMemo(() => buildPortfolioBreakdown(portfolio), [portfolio]);
  const [selectedKey, setSelectedKey] = useState<string>();
  const selected = breakdown?.segments.find(segment => segment.key === selectedKey);
  const toggle = (key: string) => setSelectedKey(current => current === key ? undefined : key);
  const hasSegments = Boolean(breakdown && breakdown.segments.length);

  const value = selected ? selected.value : breakdown?.total;
  const caption = loading && !breakdown ? 'Loading portfolio…'
    : !breakdown ? 'Allocation unavailable until every position has a price'
    : selected ? selected.label : 'Total paper portfolio';

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <Text style={styles.title}>Allocation</Text>
        {hasSegments ? <Text style={styles.count}>{breakdown!.segments.length} {breakdown!.segments.length === 1 ? 'part' : 'parts'}</Text> : null}
      </View>

      <View style={styles.valueRow}>
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {value == null ? '—' : formatUsd(value, 0)}
        </Text>
        {selected ? <Text style={styles.caption} numberOfLines={1}>
          <Text style={[styles.share, { color: selected.color }]}>{percent(selected.share)}</Text> of portfolio
        </Text> : null}
      </View>
      <Text style={styles.subcaption} numberOfLines={2}>{caption}</Text>

      <View style={styles.bar} accessibilityRole="summary"
        accessibilityLabel={hasSegments ? breakdown!.segments.map(s => `${s.label} ${percent(s.share)}`).join(', ') : caption}>
        {hasSegments ? breakdown!.segments.map(segment => (
          <Pressable key={segment.key} onPress={() => toggle(segment.key)}
            accessibilityRole="button" accessibilityState={{ selected: selectedKey === segment.key }}
            accessibilityLabel={`${segment.label}, ${formatUsd(segment.value)}, ${percent(segment.share)} of portfolio`}
            style={({ pressed }) => [styles.segment, {
              flexGrow: segment.share, backgroundColor: segment.color,
              opacity: selectedKey && selectedKey !== segment.key ? 0.3 : pressed ? 0.8 : 1,
            }]} />
        )) : <View style={[styles.segment, styles.placeholder]} />}
      </View>

      {hasSegments ? (
        <View style={styles.legend}>
          {breakdown!.segments.map(segment => (
            <Pressable key={segment.key} onPress={() => toggle(segment.key)} hitSlop={4}
              accessibilityRole="button" accessibilityState={{ selected: selectedKey === segment.key }}
              accessibilityLabel={`${segment.label}, ${percent(segment.share)}`}
              style={({ pressed }) => [styles.legendItem, selectedKey && selectedKey !== segment.key && styles.dimmed, pressed && styles.dimmed]}>
              <View style={[styles.dot, { backgroundColor: segment.color }]} />
              <Text style={styles.legendLabel} numberOfLines={1}>{segment.label}</Text>
              <Text style={styles.legendShare}>{percent(segment.share)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.divider} />
      <Text style={styles.footnote}>
        How your paper portfolio is split across open positions and available cash. Tap a colour to see its value.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 18, padding: 18 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: Palette.textSecondary, fontSize: 15 },
  count: { color: Palette.textMuted, fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: Palette.pill, overflow: 'hidden' },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 8 },
  value: { color: Palette.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.6, fontVariant: ['tabular-nums'], flexShrink: 1 },
  share: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  caption: { color: Palette.textSecondary, fontSize: 13 },
  subcaption: { color: Palette.textMuted, fontSize: 12, marginTop: 2 },
  bar: { flexDirection: 'row', gap: 4, height: 44, marginTop: 18 },
  // Tiny holdings stay visible and tappable.
  segment: { flexBasis: 0, minWidth: 8, borderRadius: 8 },
  placeholder: { flexGrow: 1, backgroundColor: Palette.pill },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 10, marginTop: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 24 },
  dimmed: { opacity: 0.45 },
  dot: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { color: Palette.text, fontSize: 13, maxWidth: 120 },
  legendShare: { color: Palette.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Palette.border, marginTop: 18, marginBottom: 12 },
  footnote: { color: Palette.textMuted, fontSize: 12, lineHeight: 18 },
});
