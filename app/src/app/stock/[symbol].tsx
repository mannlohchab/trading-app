import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StockPreviewChart } from '@/components/charts/StockPreviewChart';
import { SymbolIcon } from '@/components/markets/SymbolIcon';
import { GlassIcon, GlassPressable } from '@/components/ui/GlassIcon';
import type { QuoteLike } from '@/components/markets/InstrumentRow';
import { api } from '@/lib/api';
import { useLiveMarket } from '@/hooks/use-live-market';
import { DEMO_MODE } from '@/lib/demoMode';
import { formatCompact, formatMarketPrice, formatPct, marketMetadata, marketSourceLabel } from '@/lib/format';
import type { HistoryResponse } from '@/lib/marketHistory';
import { buildPreviewChart, PREVIEW_RANGES, type PreviewRange } from '@/lib/stockPreview';

type DetailQuote = QuoteLike & { open?: number; high?: number; low?: number; close?: number; volume?: number };
const date = (time: number) => new Date(time * 1000).toLocaleDateString('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

export default function StockDetailScreen() {
  const params = useLocalSearchParams<{ symbol: string; exchange?: string; name?: string }>();
  const symbol = String(params.symbol ?? 'BTCUSDT').toUpperCase();
  const exchange = String(params.exchange ?? 'BINANCE').toUpperCase();
  const [range, setRange] = useState<PreviewRange>('1D');
  const timeframe = PREVIEW_RANGES.find(item => item.label === range)!.timeframe;
  const quoteQuery = useQuery({
    queryKey: ['quote', symbol, exchange],
    queryFn: ({ signal }) => api<{ quote: DetailQuote; isDemo: boolean }>(`/api/market/quote/${encodeURIComponent(symbol)}?exchange=${encodeURIComponent(exchange)}`, { signal, auth: false }),
    refetchInterval: 60_000,
  });
  const historyQuery = useQuery({
    queryKey: ['stock-preview-history', symbol, exchange, timeframe],
    queryFn: ({ signal }) => api<HistoryResponse>(`/api/market/candles/${encodeURIComponent(symbol)}?exchange=${encodeURIComponent(exchange)}&timeframe=${timeframe}&liveOnly=true`, { signal, auth: false }),
    staleTime: exchange === 'FOREX' ? 300_000 : 60_000,
    refetchInterval: exchange === 'FOREX' ? 300_000 : 60_000,
    retry: false,
  });
  const chart = useMemo(() => buildPreviewChart(historyQuery.data, range, DEMO_MODE), [historyQuery.data, range]);
  const quote = quoteQuery.data && (quoteQuery.data.isDemo === false || DEMO_MODE) ? quoteQuery.data.quote : undefined;
  const up = (quote?.changePercent ?? 0) >= 0;
  const chartSource = historyQuery.data?.source ?? historyQuery.data?.candles.find(c => c.source)?.source;
  const feedStatus = useLiveMarket([`${exchange}:${symbol}`]);
  const metadata = {...marketMetadata({symbol,exchange}), ...quote, symbol, exchange};
  const price = (value?: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? formatMarketPrice(value, metadata) : '—';
  const stats = [
    ['Open', price(quote?.open)], [exchange === 'BINANCE' ? '24h open' : 'Prev. close', price(quote?.close)],
    ['Day high', price(quote?.high)], ['Day low', price(quote?.low)],
    ['Volume', quote?.volume != null && Number.isFinite(quote.volume) && quote.volume >= 0 ? formatCompact(quote.volume) : '—'],
    ['Exchange', exchange],
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable style={styles.back} accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/markets')}>
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <Text style={styles.title}>Instrument Detail</Text>
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.identity}>
            <SymbolIcon symbol={symbol} exchange={exchange} size={34} />
            <View style={styles.nameWrap}>
              <Text style={styles.name} numberOfLines={2}>{quote?.name ?? params.name ?? symbol}</Text>
              <Text style={styles.symbol}>{symbol} · {exchange}</Text>
            </View>
            <View style={styles.priceWrap}>
              <Text style={styles.price} numberOfLines={1} adjustsFontSizeToFit>{price(quote?.ltp)}</Text>
              <Text style={styles.currency}>{metadata.currency}</Text>
              {quote ? <Text style={[styles.change, { color: up ? '#09a571' : '#d74563' }]}>{quote.change > 0 ? '+' : ''}{formatMarketPrice(quote.change, metadata, false)} ({formatPct(quote.changePercent)})</Text> : null}
            </View>
          </View>
          <View style={styles.sourceRow}>
            <Text style={styles.source}>{feedStatus}</Text>
            <Text style={styles.source}>{quote ? `${marketSourceLabel(quote.source)}${quote.stale ? ' · Last observation / stale' : ''}` : quoteQuery.isPending ? 'Loading quote…' : 'Quote unavailable'}</Text>
            {quote?.asOf ? <Text style={styles.asOf}>As of {new Date(quote.asOf * 1000).toLocaleString('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} UTC</Text> : null}
          </View>
          {quoteQuery.isError ? <Pressable accessibilityRole="button" onPress={() => void quoteQuery.refetch()}><Text style={styles.retry}>{quote ? 'Quote refresh failed' : 'Could not load quote'} · Retry</Text></Pressable> : null}
          <View style={styles.ranges}>
            {PREVIEW_RANGES.map(item => <Pressable key={item.label} style={[styles.range, range === item.label && styles.rangeActive]} onPress={() => setRange(item.label)} accessibilityRole="button" accessibilityState={{ selected: range === item.label }} accessibilityLabel={`Show ${item.label} price history`}>
              <Text style={[styles.rangeText, range === item.label && styles.rangeTextActive]}>{item.label}</Text>
            </Pressable>)}
          </View>
          {chart ? <StockPreviewChart key={`${symbol}-${exchange}-${range}`} chart={chart} metadata={metadata} /> : <View style={styles.chartEmpty}>
            {historyQuery.isPending ? <ActivityIndicator color="#0578e9" /> : null}
            <Text style={styles.emptyText}>{historyQuery.isPending ? 'Loading price history…' : historyQuery.isError ? 'Price history is temporarily unavailable' : 'Not enough price history for this range'}</Text>
            {historyQuery.isError ? <Pressable onPress={() => void historyQuery.refetch()} accessibilityRole="button"><Text style={styles.retry}>Try again</Text></Pressable> : null}
          </View>}
          {chart ? <View style={styles.historyInfo}>
            <Text style={styles.historyCaption}>{date(chart.start)}{date(chart.start) !== date(chart.end) ? ` – ${date(chart.end)}` : ''} · {timeframe} candles</Text>
            <Text style={styles.historyCaption}>{marketSourceLabel(chartSource)} · Drag to inspect</Text>
            {historyQuery.isError ? <Text style={styles.retry}>History refresh failed · showing last loaded prices</Text> : null}
          </View> : null}
          <View style={styles.stats}>
            {stats.map(([label, value]) => <View style={styles.stat} key={label}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text></View>)}
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <GlassPressable style={({ pressed }) => [styles.openButton, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityHint="Open the full chart with timeframes, indicators and paper trading tools" onPress={() => router.push({ pathname: '/instrument/[symbol]', params: { symbol, exchange, name: quote?.name ?? params.name ?? symbol } })}>
            <Image source={require('@/assets/images/market-glow.svg')} style={[StyleSheet.absoluteFill, { opacity: 0.6 }]} contentFit="fill" accessible={false} pointerEvents="none" />
            <Text style={styles.openText}>Open chart</Text><GlassIcon name="chart" size={24} tone="purple" />
          </GlassPressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  page: { flex: 1, width: '100%', maxWidth: 620, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 },
  back: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: '#e4e5ed', alignItems: 'center', justifyContent: 'center' },
  backGlyph: { fontSize: 30, lineHeight: 32, color: '#1d2532' },
  title: { fontSize: 20, fontWeight: '600', color: '#101620' },
  headerSpacer: { width: 44 },
  content: { paddingHorizontal: 20, paddingBottom: 28 },
  identity: { backgroundColor: '#fff', padding: 16, borderRadius: 19, borderWidth: 1, borderColor: '#e3e5ed', flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', minHeight: 94, boxShadow: '0 2px 5px rgba(27,39,62,0.025)' },
  nameWrap: { flex: 1 },
  name: { color: '#0f141d', fontSize: 20, fontWeight: '600', letterSpacing: -0.5 },
  symbol: { color: '#7e8592', fontSize: 13, marginTop: 5 },
  priceWrap: { alignItems: 'flex-start', width: '100%', marginTop: 4 },
  price: { color: '#0e131c', fontSize: 32, fontWeight: '600', letterSpacing: -0.6 },
  currency: { color: '#9299a7', fontSize: 12, marginTop: 2 },
  change: { fontSize: 14, fontWeight: '500', marginTop: 4 },
  sourceRow: { gap: 4, paddingTop: 10, paddingBottom: 19 },
  source: { color: '#6e7690', fontSize: 12 },
  asOf: { color: '#8f939d', fontSize: 12 },
  ranges: { padding: 4, borderRadius: 10, borderWidth: 1, borderColor: '#e5e5ee', flexDirection: 'row', gap: 4 },
  range: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  rangeActive: { backgroundColor: '#fff', boxShadow: '0 2px 5px rgba(25,47,88,0.09)' },
  rangeText: { fontSize: 14, color: '#414655' },
  rangeTextActive: { color: '#0578e9', fontWeight: '600' },
  chartEmpty: { height: 245, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { color: '#838a9e', fontSize: 14, textAlign: 'center' },
  retry: { color: '#0578e9', fontSize: 13, paddingVertical: 8 },
  historyInfo: { marginTop: 12, gap: 4, marginBottom: 20 },
  historyCaption: { color: '#9096a5', fontSize: 12 },
  stats: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eeedf3', borderRadius: 18, padding: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  stat: { width: '46%', gap: 6 },
  statLabel: { color: '#515665', fontSize: 13 },
  statValue: { color: '#222534', fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  footer: { paddingHorizontal: 20, paddingBottom: 18, paddingTop: 12 },
  openButton: { backgroundColor: '#fff', borderRadius: 14, minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1, borderColor: '#C7D5F6', overflow: 'hidden', boxShadow: '0 3px 9px rgba(68,101,177,0.10)' },
  openText: { color: '#4B62A4', fontSize: 17, fontWeight: '600' },
});
