import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { IndicatorHero } from '@/components/economics/IndicatorHero';
import { Text } from '@/components/ui/AppText';
import { InsightPalette as P } from '@/constants/theme';
import type { EconomicIndicator } from '@/lib/economics';
import { formatIndicatorValue, indicatorChange, indicatorNumber, indicatorSummary, isAggregateEconomy, sortIndicators, type IndicatorSort } from '@/lib/indicatorFormat';

const SORTS: IndicatorSort[] = ['Highest', 'Lowest', 'Biggest move', 'A–Z'];
const SCOPES = ['Countries', 'Regions & groups'] as const;
const BAR = '#3D3D3A';
const BAR_NEGATIVE = '#C2410C';

type Props = { items: EconomicIndicator[]; onOpen: (url: string) => void; source?: string };

/** Ranked, scannable view of one indicator across economies. */
export function IndicatorTable({ items: allItems, onOpen, source = 'World Bank' }: Props) {
  const [sort, setSort] = useState<IndicatorSort>('Highest');
  const [scope, setScope] = useState<(typeof SCOPES)[number]>('Countries');
  // Rank countries separately from regions/income groups ("World" would otherwise top every GDP list).
  const groups = useMemo(() => ({
    Countries: allItems.filter(item => !isAggregateEconomy(item.id)),
    'Regions & groups': allItems.filter(item => isAggregateEconomy(item.id)),
  }), [allItems]);
  const showScopes = groups.Countries.length > 0 && groups['Regions & groups'].length > 0;
  const items = showScopes ? groups[scope] : allItems;
  const sorted = useMemo(() => sortIndicators(items, sort), [items, sort]);
  const summary = useMemo(() => indicatorSummary(items), [items]);
  const unit = items[0]?.unit ?? '';
  const years = [...new Set(items.map(item => item.period))].sort();
  const yearLabel = years.length > 1 ? `${years[0]}–${years.at(-1)}` : years[0];

  return (
    <View style={styles.wrap}>
      {showScopes && (
        <View style={styles.scopes} accessibilityRole="tablist">
          {SCOPES.map(item => (
            <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: scope === item }} onPress={() => setScope(item)}
              style={[styles.scope, scope === item && styles.scopeActive]}>
              <Text style={[styles.scopeText, scope === item && styles.scopeTextActive]}>{item} · {groups[item].length}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {summary && (
        <IndicatorHero title={allItems[0]?.name ?? 'Indicator'} source={source} unit={unit} period={years.at(-1)} summary={summary}
          noun={!showScopes ? 'economies' : scope === 'Countries' ? 'countries' : 'groups'} />
      )}

      <View style={styles.sorts} accessibilityRole="tablist">
        {SORTS.map(item => (
          <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: sort === item }} onPress={() => setSort(item)}
            style={[styles.sort, sort === item && styles.sortActive]}>
            <Text style={[styles.sortText, sort === item && styles.sortTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.tableHead}>
        <Text style={[styles.headText, styles.headLeft]}>Economy</Text>
        <Text style={styles.headText}>{unit}{yearLabel ? ` · ${yearLabel}` : ''}</Text>
      </View>

      {sorted.map((item, index) => {
        const value = indicatorNumber(item.latest);
        const change = indicatorChange(item);
        const width = summary && value !== null && summary.maxAbs > 0 ? Math.max(2, Math.abs(value) / summary.maxAbs * 100) : 0;
        const rank = sort === 'A–Z' ? null : index + 1;
        return (
          <Pressable key={item.id} accessibilityRole="link"
            accessibilityLabel={`${item.country}, ${formatIndicatorValue(item.latest, item.unit)} in ${item.period}${change ? `, ${change.label} from ${item.previousPeriod ?? 'previous year'}` : ''}. Opens World Bank series`}
            onPress={() => onOpen(item.url)} style={({ pressed }) => [styles.row, index === sorted.length - 1 && styles.rowLast, pressed && styles.pressed]}>
            {rank !== null ? <Text style={styles.rank}>{rank}</Text> : null}
            <View style={styles.main}>
              <View style={styles.line}>
                <Text style={styles.country} numberOfLines={1}>{item.country}</Text>
                <Text style={styles.value} numberOfLines={1}>{formatIndicatorValue(item.latest, item.unit)}</Text>
              </View>
              <View style={styles.line}>
                <View style={styles.track}>
                  {width ? <View style={[styles.bar, { width: `${width}%`, backgroundColor: value !== null && value < 0 ? BAR_NEGATIVE : BAR }]} /> : null}
                </View>
                <Text style={styles.change} numberOfLines={1}>
                  {change ? change.label : 'No prior year'}{item.period !== years.at(-1) ? ` · ${item.period}` : ''}
                </Text>
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 8 },
  scopes: { flexDirection: 'row', backgroundColor: P.soft, borderRadius: 12, padding: 3, marginBottom: 12 },
  scope: { flex: 1, minHeight: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  scopeActive: { backgroundColor: P.card, boxShadow: '0 1px 2px rgba(31,31,30,0.08)' },
  scopeText: { color: P.textSecondary, fontSize: 13, fontWeight: '500' },
  scopeTextActive: { color: P.text },
  pressed: { opacity: 0.6 },
  sorts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 16 },
  sort: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center', backgroundColor: P.soft },
  sortActive: { backgroundColor: P.text },
  sortText: { color: P.body, fontSize: 13, fontWeight: '500' },
  sortTextActive: { color: P.onSolid },
  tableHead: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: P.border },
  headText: { color: P.textMuted, fontSize: 12 },
  headLeft: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: P.border },
  rowLast: { borderBottomWidth: 0 },
  rank: { width: 26, color: P.textMuted, fontSize: 13, fontVariant: ['tabular-nums'], textAlign: 'right' },
  main: { flex: 1, gap: 7 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  country: { flex: 1, color: P.text, fontSize: 15, fontWeight: '500' },
  value: { color: P.text, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: P.soft, overflow: 'hidden' },
  bar: { height: 4, borderRadius: 2 },
  change: { color: P.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'], minWidth: 72, textAlign: 'right' },
});
