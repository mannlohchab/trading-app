import { useQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ChartDrawing } from '@/components/charts/chartDrawingTools';
import { TradingChart, type ChartCandle } from '@/components/charts/TradingChart';
import { GlassIcon, GlassPressable } from '@/components/ui/GlassIcon';
import { useLiveMarket, useLiveCandles } from '@/hooks/use-live-market';
import { marketMetadata, marketSourceLabel } from '@/lib/format';
import { api } from '@/lib/api';

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'] as const;
const CHART_TYPES = ['candle', 'line', 'area'] as const;
const INDICATORS = ['MA', 'EMA', 'BB', 'VOL'] as const;

export default function InstrumentScreen() {
  const params = useLocalSearchParams<{ symbol: string; exchange?: string }>();
  const symbol = String(params.symbol ?? 'BTCUSDT').toUpperCase();
  const exchange = String(params.exchange ?? 'BINANCE').toUpperCase();
  const drawingStore = useRef<Record<string, ChartDrawing[]>>({});
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>('5m');
  const [chartType, setChartType] = useState<(typeof CHART_TYPES)[number]>('candle');
  const [indicators, setIndicators] = useState<string[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [chartHeight, setChartHeight] = useState(0);

  const loadCandles = useLiveCandles(symbol, exchange, timeframe);
  const candlesQuery = useQuery({
    queryKey: ['candles', symbol, exchange, timeframe],
    refetchInterval: exchange === 'FOREX' ? 300_000 : 60_000,
    retry: false,
    queryFn: ({ signal }) => loadCandles(() => api<{
      candles: ChartCandle[];
      source?: 'angelone' | 'yahoo' | 'demo' | 'binance' | 'twelvedata';
      pricePrecision?: number;
      currency?: string;
    }>(`/api/market/candles/${encodeURIComponent(symbol)}?exchange=${encodeURIComponent(exchange)}&timeframe=${timeframe}&fresh=true`, { signal })),
  });

  const feedStatus = useLiveMarket([`${exchange}:${symbol}`]);
  const metadata = {...marketMetadata({symbol,exchange}), ...candlesQuery.data};
  const source = candlesQuery.data?.source;
  const sourceLabel = `${marketSourceLabel(source)} · ${metadata.currency} · ${feedStatus}`;

  function toggleIndicator(indicator: string) {
    setIndicators(previous => previous.includes(indicator)
      ? previous.filter(item => item !== indicator)
      : [...previous, indicator]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.toolbar}>
        <Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/markets')}>
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
        <View style={styles.identity}>
          <Text style={styles.symbol} numberOfLines={1}>{symbol} <Text style={styles.timeframe}>{timeframe}</Text></Text>
          <Text style={styles.source}>{sourceLabel}</Text>
        </View>
        <GlassPressable style={[styles.iconButton, toolsOpen && styles.selected]} accessibilityRole="button" accessibilityLabel="Chart settings" accessibilityState={{ expanded: toolsOpen }} onPress={() => setToolsOpen(open => !open)}>
          <GlassIcon name="analytics" size={26} tone="purple" />
        </GlassPressable>
      </View>

      <View style={styles.chart} onLayout={event => setChartHeight(event.nativeEvent.layout.height)}>
        {candlesQuery.data?.candles.length ? chartHeight > 0 ? (
          <TradingChart key={`${exchange}:${symbol}:${timeframe}`} pricePrecision={metadata.pricePrecision} currency={metadata.currency} candles={candlesQuery.data.candles} chartType={chartType} indicators={indicators} height={chartHeight} symbol={symbol} drawingKey={`${exchange}:${symbol}:${timeframe}`} drawingStore={drawingStore} />
        ) : null : (
          <View style={styles.empty}>
            {candlesQuery.isPending ? <ActivityIndicator color="#8370ED" /> : null}
            <Text style={styles.muted}>{candlesQuery.isPending ? 'Loading chart…' : 'Price history is unavailable'}</Text>
            {candlesQuery.isError ? <Pressable accessibilityRole="button" onPress={() => void candlesQuery.refetch()}><Text style={styles.retry}>Retry</Text></Pressable> : null}
          </View>
        )}
        {toolsOpen ? (
          <View style={styles.settings}>
            <View style={styles.settingsHeader}>
              <Text style={styles.heading}>Chart settings</Text>
              <Pressable accessibilityRole="button" onPress={() => setToolsOpen(false)}><Text style={styles.retry}>Done</Text></Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.settingsContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.label}>Timeframe</Text>
              <View style={styles.row}>
                {TIMEFRAMES.map(item => (
                  <Pressable key={item} style={[styles.pill, timeframe === item && styles.selected]} accessibilityRole="button" accessibilityLabel={`${item} candles`} accessibilityState={{ selected: timeframe === item }} onPress={() => setTimeframe(item)}>
                    <Text style={[styles.pillText, timeframe === item && styles.selectedText]}>{item}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.label}>Chart type</Text>
              <View style={styles.row}>
                {CHART_TYPES.map(item => (
                  <Pressable key={item} style={[styles.pill, chartType === item && styles.selected]} accessibilityRole="button" accessibilityState={{ selected: chartType === item }} onPress={() => setChartType(item)}>
                    <Text style={[styles.pillText, chartType === item && styles.selectedText]}>{item === 'candle' ? 'Candlesticks' : item === 'line' ? 'Line' : 'Area'}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.label}>Indicators</Text>
              <View style={styles.row}>
                {INDICATORS.map(item => (
                  <Pressable key={item} style={[styles.pill, indicators.includes(item) && styles.selected]} accessibilityRole="button" accessibilityState={{ selected: indicators.includes(item) }} onPress={() => toggleIndicator(item)}>
                    <Text style={[styles.pillText, indicators.includes(item) && styles.selectedText]}>{item}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#EAE5F2' },
  iconButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 12 },
  backGlyph: { fontSize: 30, lineHeight: 34, color: '#6E579C' },
  identity: { flex: 1 },
  symbol: { fontSize: 16, fontWeight: '600', color: '#352C45' },
  timeframe: { fontSize: 13, fontWeight: '500', color: '#7657BA' },
  source: { fontSize: 11, color: '#787184', marginTop: 2 },
  chart: { flex: 1, minHeight: 0 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { fontSize: 13, color: '#787184' },
  retry: { fontSize: 14, fontWeight: '600', color: '#7657BA', padding: 12 },
  settings: { position: 'absolute', bottom: 12, left: 12, right: 12, maxWidth: 440, maxHeight: '90%', backgroundColor: '#fff', borderWidth: 1, borderColor: '#E4DAF2', borderRadius: 18, boxShadow: '0 4px 24px rgba(83,62,125,0.14)' },
  settingsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 4, borderBottomWidth: 1, borderBottomColor: '#F0ECF5' },
  heading: { fontSize: 16, fontWeight: '600', color: '#352C45' },
  settingsContent: { padding: 16, gap: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#514363' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { minWidth: 44, minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderRadius: 10, backgroundColor: '#F8F6FC', borderWidth: 1, borderColor: '#EAE5F2' },
  selected: { backgroundColor: '#F1ECFC', borderColor: '#CBB9EE' },
  pillText: { fontSize: 13, color: '#756B86' },
  selectedText: { color: '#6E579C', fontWeight: '600' },
});
