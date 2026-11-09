import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/AppText';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { EmptyState } from '@/components/ui/EmptyState';
import { InsightPalette as P } from '@/constants/theme';
import { IndicatorTable } from '@/components/economics/IndicatorTable';
import { api } from '@/lib/api';
import { calendarDate, economicTime, economicValue, type EconomicCalendarEvent, type EconomicData, type EconomicIndicator, type EconomicNews, type EconomicsMode } from '@/lib/economics';

const INDICATORS = [
  { key: 'growth', name: 'GDP growth' }, { key: 'inflation', name: 'Inflation' }, { key: 'unemployment', name: 'Unemployment' },
  { key: 'gdp', name: 'GDP' }, { key: 'interest', name: 'Real interest rate' },
];
type Item = EconomicCalendarEvent | EconomicIndicator | EconomicNews;
export function EconomicsPanel({ mode }: { mode: EconomicsMode }) {
  const [calendarSource, setCalendarSource] = useState('Releases');
  const [offset, setOffset] = useState(0);
  const [span, setSpan] = useState('7 days');
  const [impact, setImpact] = useState('All impact');
  const [indicator, setIndicator] = useState('growth');
  const [search, setSearch] = useState('');
  const [linkError, setLinkError] = useState('');
  const start = calendarDate(offset), end = calendarDate(offset + (span === 'Today' ? 0 : 6));
  const source = calendarSource === 'Releases' ? 'releases' : 'forex';
  const params = mode === 'Calendar' ? `calendar?${new URLSearchParams({ start, end, source })}`
    : mode === 'Indicators' ? `indicators?indicator=${indicator}` : 'news';
  const query = useQuery({
    queryKey: ['economics', params],
    queryFn: ({ signal }) => api<EconomicData<Item>>(`/api/economics/${params}`, { signal }),
    staleTime: 300_000, retry: false,
  });
  const data = query.data;
  const needle = search.trim().toLowerCase();
  const items = (data?.items ?? []).filter(item => {
    const content = 'event' in item ? `${item.event} ${item.country} ${item.currency ?? ''}` : 'latest' in item ? `${item.country} ${item.name}` : `${item.title} ${item.publisher} ${item.country ?? ''}`;
    return content.toLowerCase().includes(needle) && (mode !== 'Calendar' || impact !== 'High impact' || ('importance' in item && item.importance === 3));
  });
  async function open(url: string) {
    setLinkError('');
    try { await Linking.openURL(url); } catch { setLinkError('Could not open the source link. Please try again.'); }
  }
  const controls = <View style={styles.controls}>
    {mode === 'Calendar' && <>
      <SegmentedTabs tabs={['Releases', 'Forex week']} value={calendarSource} onChange={setCalendarSource} variant="insight" />
      {source === 'releases' && <>
        <SegmentedTabs tabs={['Today', '7 days']} value={span} onChange={value => { setSpan(value); setOffset(0); }} variant="insight" />
        <View style={styles.dateRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous dates" style={styles.dateButton} onPress={() => setOffset(value => value - (span === 'Today' ? 1 : 7))}><Text style={styles.link}>‹</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Return to current dates" onPress={() => setOffset(0)} style={styles.dateLabel}><Text style={styles.small}>{start}{end !== start ? ` – ${end}` : ''} (UTC)</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Next dates" style={styles.dateButton} onPress={() => setOffset(value => value + (span === 'Today' ? 1 : 7))}><Text style={styles.link}>›</Text></Pressable>
        </View>
      </>}
      <SegmentedTabs tabs={['All impact', 'High impact']} value={impact} onChange={setImpact} variant="insight" />
    </>}
    {mode === 'Indicators' && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {INDICATORS.map(item => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: indicator === item.key }} style={[styles.chip, indicator === item.key && styles.chipSelected]} onPress={() => setIndicator(item.key)}><Text style={[styles.small, indicator === item.key && styles.white]}>{item.name}</Text></Pressable>)}
    </ScrollView>}
    <TextInput accessibilityLabel={`Search ${mode.toLowerCase()}`} value={search} onChangeText={setSearch} style={styles.search} autoCorrect={false} placeholder={mode === 'Calendar' ? 'Search country code, currency or event…' : mode === 'Indicators' ? 'Search country or economy…' : 'Search headlines or publisher…'} placeholderTextColor={P.textMuted} />
    {data && <View style={styles.sourceBox}>
      <Pressable accessibilityRole="link" onPress={() => void open(data.sourceUrl)}><Text style={styles.source}>Source: {data.source}{data.isDemo ? ' · Demo data' : ''} ↗</Text></Pressable>
      <Text style={styles.small}>{data.notice}</Text>
      <Text style={[styles.small, data.stale && styles.warning]}>{data.stale ? 'Saved data · refresh failed · ' : 'Retrieved '}{economicTime(data.fetchedAt)}</Text>
      {data.truncated && <Text style={styles.warning}>{mode === 'Calendar' ? 'Partial results. Narrow the dates to see more releases.' : 'Partial coverage. Open the source for the complete dataset.'}</Text>}
      {mode === 'Calendar' && <Text style={styles.small}>Release times are shown in your local timezone.</Text>}
    </View>}
    {query.error && <ErrorBanner message={query.error.message} onRetry={() => void query.refetch()} />}
    {linkError ? <ErrorBanner message={linkError} /> : null}
  </View>;
  // Indicators render as one ranked table (footer) rather than a card per economy.
  const indicatorTable = mode === 'Indicators' && items.length > 0;
  return <FlatList
    style={styles.flex}
    data={indicatorTable ? [] : items}
    ListFooterComponent={indicatorTable ? <IndicatorTable items={items as EconomicIndicator[]} source={data?.source} onOpen={url => void open(url)} /> : undefined}
    keyExtractor={item => item.id}
    keyboardShouldPersistTaps="handled"
    refreshing={query.isRefetching}
    onRefresh={() => void query.refetch()}
    contentContainerStyle={styles.list}
    ListHeaderComponent={controls}
    ListEmptyComponent={indicatorTable ? undefined : query.isPending ? <ActivityIndicator color={P.text} style={styles.loading} /> : query.isError ? undefined : <EmptyState variant="insight" title="No matching data" subtitle="Try another filter or pull down to refresh." />}
    renderItem={({ item }) => <View style={styles.card}>
      {'event' in item ? <>
        <Text style={styles.meta}>{item.country}{item.currency && item.currency !== item.country ? ` · ${item.currency}` : ''} · {item.importance === 3 ? 'High impact' : item.importance === 2 ? 'Medium impact' : item.importance === 1 ? 'Low impact' : 'Impact not rated'}</Text>
        <Text style={styles.title}>{item.event}</Text>
        <Text style={styles.small}>{economicTime(item.date, item.day)}{item.estimated && item.date ? ' · Estimated' : ''}</Text>
        {item.reference ? <Text style={styles.small}>Period: {item.reference}</Text> : null}
        {item.status ? <Text style={[styles.small, item.status === 'cancelled' && styles.warning]}>Status: {item.status}</Text> : null}
        <View style={styles.values}>{[['Actual', item.actual], ['Forecast', item.forecast], ['Previous', item.previous]].map(([label, value]) => <View key={label} style={styles.valueCell}><Text style={styles.meta}>{label}</Text><Text style={styles.value}>{economicValue(value)}</Text></View>)}</View>
        {item.unit ? <Text style={styles.small}>Unit: {item.unit}</Text> : null}
        {item.dataStale && <Text style={styles.warning}>Source marks this release as stale.</Text>}
        {item.source ? <Text style={styles.small}>{item.source}</Text> : null}
        {(item.sourceUrl || item.url) && <Pressable accessibilityRole="link" style={styles.sourceButton} onPress={() => void open((item.sourceUrl || item.url)!)}><Text style={styles.source}>View source ↗</Text></Pressable>}
      </> : 'latest' in item ? <>
        <Text style={styles.meta}>{item.country}</Text><Text style={styles.title}>{item.name}</Text>
        <View style={styles.values}><View style={styles.valueCell}><Text style={styles.meta}>Latest · {item.period}</Text><Text style={styles.value}>{economicValue(item.latest)}</Text></View><View style={styles.valueCell}><Text style={styles.meta}>Previous{item.previousPeriod ? ` · ${item.previousPeriod}` : ''}</Text><Text style={styles.value}>{economicValue(item.previous)}</Text></View></View>
        <Text style={styles.small}>{item.unit}</Text>
        <Pressable accessibilityRole="link" style={styles.sourceButton} onPress={() => void open(item.url)}><Text style={styles.source}>World Bank series ↗</Text></Pressable>
      </> : <>
        <Text style={styles.meta}>{item.publisher}{item.country ? ` · ${item.country}` : ''}</Text>
        <Text style={styles.title}>{item.title}</Text><Text style={styles.small}>Indexed {economicTime(item.date)}</Text>
        <Pressable accessibilityRole="link" style={styles.sourceButton} onPress={() => void open(item.url)}><Text style={styles.source}>Read article ↗</Text></Pressable>
      </>}
    </View>}
  />;
}
const styles = StyleSheet.create({
  flex: { flex: 1 }, list: { paddingBottom: 24 }, controls: { paddingHorizontal: 16, gap: 12, paddingBottom: 16 },
  search: { minHeight: 44, borderWidth: 1, borderColor: P.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: P.card, color: P.text, fontSize: 14 },
  chips: { gap: 8 }, chip: { minHeight: 40, justifyContent: 'center', borderWidth: 1, borderColor: P.border, paddingHorizontal: 12, borderRadius: 20, backgroundColor: P.card }, chipSelected: { backgroundColor: P.text }, white: { color: P.onSolid },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, dateButton: { width: 40, minHeight: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: P.soft, borderRadius: 8 }, dateLabel: { flex: 1, alignItems: 'center', minHeight: 44, justifyContent: 'center' }, link: { color: P.text, fontSize: 24 },
  sourceBox: { gap: 6 }, source: { color: P.text, fontSize: 12, textDecorationLine: 'underline' }, sourceButton: { minHeight: 40, justifyContent: 'center' }, small: { color: P.textSecondary, fontSize: 12, lineHeight: 18 }, warning: { color: '#A23E3E', fontSize: 12, lineHeight: 18 },
  card: { marginHorizontal: 16, marginBottom: 12, padding: 16, borderRadius: 16, backgroundColor: P.card, borderWidth: 1, borderColor: P.border, gap: 7 },
  meta: { color: P.textMuted, fontSize: 12, lineHeight: 17 }, title: { color: P.text, fontSize: 17, fontWeight: '600', lineHeight: 23 },
  values: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: P.border, marginTop: 4 }, valueCell: { flex: 1, gap: 5 }, value: { color: P.text, fontSize: 16, lineHeight: 22 }, loading: { padding: 32 },
});
