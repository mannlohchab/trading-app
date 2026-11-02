import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, TextInput } from '@/components/ui/AppText';
import { InstrumentRow, type QuoteLike } from '@/components/markets/InstrumentRow';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { InstrumentRowSkeleton } from '@/components/ui/Skeleton';
import { InsightPalette as P } from '@/constants/theme';
import { useLiveMarket } from '@/hooks/use-live-market';
import { api } from '@/lib/api';

type MarketData = {
  crypto?: QuoteLike[];
  forex?: QuoteLike[];
  constituents: QuoteLike[];
  availability?: { crypto: string; forex: string };
  marketSessions?: { crypto: string; forex: string };
};
const FILTERS = ['All', 'Crypto', 'Forex'];

export default function MarketScreen() {
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const market = useQuery({
    queryKey: ['explore'],
    queryFn: ({ signal }) => api<MarketData>('/api/market/explore', { signal }),
    refetchInterval: 60_000,
  });
  const quotes = market.data
    ? [...(market.data.crypto ?? []), ...(market.data.forex ?? [])]
    : [];
  const status = useLiveMarket(quotes.map(q => `${q.exchange}:${q.symbol}`));
  const query = search.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const visible = quotes.filter(q =>
    (filter === 'All' || (filter === 'Forex' ? q.exchange === 'FOREX' : q.exchange === 'BINANCE')) &&
    `${q.symbol} ${q.name}`.toLowerCase().replace(/[^a-z0-9]/g, '').includes(query));

  return <SafeAreaView style={styles.safe} edges={['top']}>
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.title}>Market</Text>
      <Text style={styles.subtitle}>Explore crypto and forex pairs</Text>
      <Text style={styles.status}>{status}</Text>
    </View>
    <View style={styles.controls}>
      <TextInput accessibilityLabel="Search market pairs" style={styles.search} placeholder="Search Bitcoin, BTC/USDT, EUR/USD…" placeholderTextColor={P.textMuted} value={search} onChangeText={setSearch} autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" />
      <SegmentedTabs tabs={FILTERS} value={filter} onChange={setFilter} variant="insight" />
    </View>
    {market.error && <ErrorBanner message="Unable to load market prices." onRetry={() => void market.refetch()} />}
    <FlatList
      data={visible}
      keyExtractor={quote => `${quote.exchange}:${quote.symbol}`}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.list}
      refreshing={market.isRefetching}
      onRefresh={() => void market.refetch()}
      ListHeaderComponent={<View>
        {filter !== 'Crypto' && market.data?.marketSessions?.forex ? <Text style={styles.notice}>{market.data.marketSessions.forex}</Text> : null}
        {filter !== 'Crypto' && market.data?.availability?.forex ? <Text style={styles.notice}>{market.data.availability.forex}</Text> : null}
        {filter !== 'Forex' && market.data?.availability?.crypto ? <Text style={styles.notice}>{market.data.availability.crypto}</Text> : null}
      </View>}
      ListEmptyComponent={market.isPending ? <View>{[0, 1, 2, 3].map(i => <InstrumentRowSkeleton key={i} />)}</View>
        : market.isError ? undefined : <EmptyState variant="insight" title={query ? 'No matching pairs' : 'No prices available'} subtitle={query ? 'Try another symbol or market filter.' : 'Pull down to refresh market data.'} />}
      renderItem={({ item }) => <InstrumentRow quote={item} />}
    />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: P.bg },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14 },
  title: { color: P.text, fontSize: 26, lineHeight: 34, letterSpacing: -0.3 },
  subtitle: { color: P.textSecondary, fontSize: 14, marginTop: 4 },
  status: { color: P.textMuted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  controls: { paddingHorizontal: 16, gap: 12, paddingBottom: 12 },
  search: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: P.border, backgroundColor: P.card, paddingHorizontal: 12, paddingVertical: 10, color: P.text, fontSize: 14 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  notice: { color: P.textSecondary, fontSize: 11, lineHeight: 16, marginBottom: 8 },
});
