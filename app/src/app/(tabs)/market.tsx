import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppTopBar } from '@/components/navigation/AppTopBar';
import { Text, TextInput } from '@/components/ui/AppText';
import type { QuoteLike } from '@/components/markets/InstrumentRow';
import { MarketQuoteList } from '@/components/markets/MarketQuoteList';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { InstrumentRowSkeleton } from '@/components/ui/Skeleton';
import { InsightPalette as P } from '@/constants/theme';
import { useLiveMarket } from '@/hooks/use-live-market';
import { fetchTickerList } from '@/lib/marketData';

// Economic calendar, indicators and news have no backend yet; Market shows live Binance prices.
const LISTS = ['Most active', 'Gainers', 'Losers'] as const;
const SORT = { 'Most active': 'volume', Gainers: 'gainers', Losers: 'losers' } as const;

export default function MarketScreen() {
  const [list, setList] = useState<(typeof LISTS)[number]>('Most active');
  return <SafeAreaView style={styles.safe} edges={['top']}>
    <AppTopBar />
    <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>Market</Text><Text style={styles.subtitle}>Live crypto prices from Binance</Text></View>
    <View style={styles.controls}><SegmentedTabs tabs={[...LISTS]} value={list} onChange={value => setList(value as (typeof LISTS)[number])} variant="insight" /></View>
    <MarketPrices sort={SORT[list]} />
  </SafeAreaView>;
}

function MarketPrices({ sort }: { sort: 'volume' | 'gainers' | 'losers' }) {
  const [search, setSearch] = useState('');
  const market = useQuery({
    // 'explore' prefix: live quotes patch every cached list (see liveMarket.updateMarketCaches).
    queryKey: ['explore', sort],
    queryFn: ({ signal }) => fetchTickerList(sort, 50, signal),
    refetchInterval: 60_000,
  });
  const quotes = market.data?.crypto ?? [];
  const status = useLiveMarket(quotes.map(q => `${q.exchange}:${q.symbol}`));
  const query = search.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const matches = (q: QuoteLike) => `${q.symbol} ${q.name}`.toLowerCase().replace(/[^a-z0-9]/g, '').includes(query);
  const sections = market.data ? [
    { key: 'crypto', title: 'Crypto · USDT pairs', data: quotes.filter(matches) },
  ].filter(section => section.data.length || !query) : [];
  const hasRows = sections.some(section => section.data.length);

  return <View style={styles.safe}>
    <View style={styles.controls}>
      <TextInput accessibilityLabel="Search market pairs" style={styles.search} placeholder="Search pairs" placeholderTextColor={P.textMuted} value={search} onChangeText={setSearch} autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" />
      <Text style={styles.status}>{status}</Text>
    </View>
    {market.error && <ErrorBanner message="Unable to load market prices." onRetry={() => void market.refetch()} />}
    {market.isPending ? <View style={styles.list}>{[0, 1, 2, 3].map(i => <InstrumentRowSkeleton key={i} />)}</View>
      : !hasRows && !market.isError ? <EmptyState variant="insight" title={query ? 'No matching pairs' : 'No prices available'} subtitle={query ? 'Try another symbol, like BTC or ETH.' : 'Pull down to refresh market data.'} />
      : <MarketQuoteList sections={sections} refreshing={market.isRefetching} onRefresh={() => void market.refetch()} />}
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: '#FFFFFF' },
  header: { paddingHorizontal: 16, paddingBottom: 14 },
  title: { color: P.text, fontSize: 26, lineHeight: 34, letterSpacing: -0.3 },
  subtitle: { color: P.textSecondary, fontSize: 14, marginTop: 4 },
  status: { color: P.textMuted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  controls: { paddingHorizontal: 16, gap: 12, paddingBottom: 12 },
  search: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: P.border, backgroundColor: P.card, paddingHorizontal: 12, paddingVertical: 10, color: P.text, fontSize: 14 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  notice: { color: P.textSecondary, fontSize: 11, lineHeight: 16, marginBottom: 8 },
});
