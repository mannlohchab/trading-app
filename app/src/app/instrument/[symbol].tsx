import { useQuery } from '@tanstack/react-query';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ChartDrawing } from '@/components/charts/chartDrawingTools';
import { TradingChart } from '@/components/charts/TradingChart';
import { SymbolIcon } from '@/components/markets/SymbolIcon';
import { Text } from '@/components/ui/AppText';
import { useLiveMarket, useLiveCandles } from '@/hooks/use-live-market';
import { fetchCandles, fetchTickerList } from '@/lib/marketData';
import { PaperOrderTicket } from '@/components/trading/PaperOrderTicket';
import { formatMarketPrice, marketMetadata, marketSourceLabel } from '@/lib/format';

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
type ChartType = 'candle' | 'line' | 'area';
const CHART_TYPES: { id: ChartType; label: string; icon: SymbolName }[] = [
  { id: 'candle', label: 'Candles', icon: { ios: 'chart.bar.fill', android: 'candlestick_chart', web: 'candlestick_chart' } },
  { id: 'line', label: 'Line', icon: { ios: 'chart.xyaxis.line', android: 'show_chart', web: 'show_chart' } },
  { id: 'area', label: 'Area', icon: { ios: 'chart.line.uptrend.xyaxis', android: 'area_chart', web: 'area_chart' } },
];
const INDICATORS = [
  { id: 'VOL', label: 'Volume' },
  { id: 'MA', label: 'Moving average (20)' },
  { id: 'EMA', label: 'Exponential moving average (20)' },
  { id: 'BB', label: 'Bollinger Bands (20, 2)' },
] as const;
/** Paper accounts settle in USD; USDT is treated 1:1 (see server instruments.ts). */
const SETTLEMENT = new Set(['USD', 'USDT']);

const INK = '#16181D';
const MUTED = '#6B7185';
const LINE = '#E3E6F0';
const UP = '#089981';
const DOWN = '#F23645';

type SymbolName = Extract<SymbolViewProps['name'], object>;
type Sheet = 'symbol' | 'timeframe' | 'type' | 'indicators' | 'settings' | 'order' | null;
type Instrument = { symbol: string; exchange: string; name: string };

function Glyph({ name, size = 22, color = INK }: { name: SymbolName; size?: number; color?: string }) {
  return <SymbolView name={name} size={size} tintColor={color} type="monochrome" accessible={false} />;
}

function IconButton({ label, onPress, children, selected }: { label: string; onPress: () => void; children: ReactNode; selected?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

export default function InstrumentScreen() {
  const params = useLocalSearchParams<{ symbol: string; exchange?: string; name?: string }>();
  const symbol = String(params.symbol ?? 'BTCUSDT').toUpperCase();
  const exchange = String(params.exchange ?? 'BINANCE').toUpperCase();
  const drawingStore = useRef<Record<string, ChartDrawing[]>>({});
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [chartType, setChartType] = useState<ChartType>('candle');
  const [indicators, setIndicators] = useState<string[]>(['VOL']);
  const [chartHeight, setChartHeight] = useState(0);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [drawingMenuRequest, setDrawingMenuRequest] = useState(0);
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderBusy, setOrderBusy] = useState(false);

  const loadCandles = useLiveCandles(symbol, exchange, timeframe);
  const candlesQuery = useQuery({
    queryKey: ['candles', symbol, exchange, timeframe],
    refetchInterval: 60_000,
    retry: false,
    queryFn: ({ signal }) => loadCandles(() => fetchCandles(symbol, timeframe, 500, signal)),
  });

  const feedStatus = useLiveMarket([`${exchange}:${symbol}`]);
  const metadata = { ...marketMetadata({ symbol, exchange }), ...candlesQuery.data };
  const candles = candlesQuery.data?.candles ?? [];
  const lastPrice = candles.at(-1)?.close;
  const tradable = SETTLEMENT.has(metadata.currency);
  const sourceLabel = `${marketSourceLabel(candlesQuery.data?.source)} · ${metadata.currency} · ${feedStatus}`;
  const activeType = CHART_TYPES.find(item => item.id === chartType)!;

  // Pair switcher: the 50 most active USDT pairs.
  const instrumentsQuery = useQuery({
    queryKey: ['explore', 'volume', 'switcher'],
    enabled: sheet === 'symbol',
    queryFn: async ({ signal }) => (await fetchTickerList('volume', 50, signal)).crypto.map(({ symbol, exchange, name }) => ({ symbol, exchange, name })),
  });

  function openOrder(next: 'BUY' | 'SELL') {
    setSide(next);
    setSheet('order');
  }

  function switchInstrument(item: Instrument) {
    setSheet(null);
    if (item.symbol === symbol && item.exchange === exchange) return;
    router.setParams({ symbol: item.symbol, exchange: item.exchange, name: item.name });
  }

  function toggleIndicator(id: string) {
    setIndicators(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  }

  const timeframeOptions = (
    <View style={styles.grid}>
      {TIMEFRAMES.map(item => (
        <Pressable key={item} accessibilityRole="button" accessibilityLabel={`${item} candles`} accessibilityState={{ selected: timeframe === item }}
          style={[styles.chip, timeframe === item && styles.chipActive]} onPress={() => { setTimeframe(item); if (sheet === 'timeframe') setSheet(null); }}>
          <Text style={[styles.chipText, timeframe === item && styles.chipTextActive]}>{item}</Text>
        </Pressable>
      ))}
    </View>
  );
  const typeOptions = CHART_TYPES.map(item => (
    <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: chartType === item.id }} style={styles.option}
      onPress={() => { setChartType(item.id); if (sheet === 'type') setSheet(null); }}>
      <Glyph name={item.icon} size={22} color={chartType === item.id ? INK : MUTED} />
      <Text style={[styles.optionText, chartType === item.id && styles.optionTextActive]}>{item.label}</Text>
      {chartType === item.id ? <Glyph name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={20} /> : null}
    </Pressable>
  ));
  const indicatorOptions = INDICATORS.map(item => (
    <Pressable key={item.id} accessibilityRole="switch" accessibilityState={{ checked: indicators.includes(item.id) }} style={styles.option} onPress={() => toggleIndicator(item.id)}>
      <Text style={[styles.optionText, indicators.includes(item.id) && styles.optionTextActive]}>{item.label}</Text>
      <View style={[styles.checkbox, indicators.includes(item.id) && styles.checkboxOn]}>
        {indicators.includes(item.id) ? <Glyph name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={14} color="#FFFFFF" /> : null}
      </View>
    </Pressable>
  ));

  return (
    <SafeAreaView style={styles.safe} edges={fullscreen ? ['top'] : ['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      {!fullscreen && (
        <View style={styles.header}>
          <IconButton label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/markets')}>
            <Glyph name={{ ios: 'chevron.left', android: 'arrow_back_ios_new', web: 'arrow_back_ios_new' }} size={22} />
          </IconButton>
          <Pressable accessibilityRole="button" accessibilityLabel={`${symbol}. Switch pair`} onPress={() => setSheet('symbol')}
            style={({ pressed }) => [styles.titleButton, pressed && styles.pressed]}>
            <Text style={styles.title} numberOfLines={1}>{symbol}</Text>
            <Glyph name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={20} />
          </Pressable>
          <View style={styles.flex} />
          <IconButton label="Chart settings" onPress={() => setSheet('settings')}>
            <Glyph name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} size={24} />
          </IconButton>
        </View>
      )}

      <View style={styles.chart} onLayout={event => setChartHeight(event.nativeEvent.layout.height)}>
        {candles.length ? chartHeight > 0 ? (
          <TradingChart key={`${exchange}:${symbol}:${timeframe}`} pricePrecision={metadata.pricePrecision} currency={metadata.currency}
            candles={candles} chartType={chartType} indicators={indicators} height={chartHeight} symbol={symbol}
            exchange={exchange} timeframe={timeframe} drawingMenuRequest={drawingMenuRequest}
            drawingKey={`${exchange}:${symbol}:${timeframe}`} drawingStore={drawingStore} />
        ) : null : (
          <View style={styles.empty}>
            {candlesQuery.isPending ? <ActivityIndicator color={INK} /> : null}
            <Text style={styles.muted}>{candlesQuery.isPending ? 'Loading chart…' : 'Price history is unavailable'}</Text>
            {candlesQuery.isError ? <Pressable accessibilityRole="button" onPress={() => void candlesQuery.refetch()}><Text style={styles.link}>Retry</Text></Pressable> : null}
          </View>
        )}
        {fullscreen && (
          <Pressable accessibilityRole="button" accessibilityLabel="Exit full screen" onPress={() => setFullscreen(false)} style={styles.exitFullscreen}>
            <Glyph name={{ ios: 'arrow.down.right.and.arrow.up.left', android: 'fullscreen_exit', web: 'fullscreen_exit' }} size={22} />
          </Pressable>
        )}
      </View>

      {!fullscreen && (
        <>
          <View style={styles.toolbar}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${symbol}. Switch pair`} onPress={() => setSheet('symbol')} style={({ pressed }) => [styles.toolPair, pressed && styles.pressed]}>
              <SymbolIcon symbol={symbol} exchange={exchange} size={22} />
              <Text style={styles.toolText} numberOfLines={1}>{symbol}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Timeframe ${timeframe}. Change timeframe`} onPress={() => setSheet('timeframe')} style={({ pressed }) => [styles.toolTimeframe, pressed && styles.pressed]}>
              <Text style={styles.toolText}>{timeframe}</Text>
            </Pressable>
            <View style={styles.flex} />
            <IconButton label="Drawing tools" onPress={() => setDrawingMenuRequest(n => n + 1)}>
              <Glyph name={{ ios: 'pencil.tip', android: 'edit', web: 'edit' }} />
            </IconButton>
            <IconButton label="Indicators" onPress={() => setSheet('indicators')}>
              <Glyph name={{ ios: 'waveform.path.ecg', android: 'ssid_chart', web: 'ssid_chart' }} />
            </IconButton>
            <IconButton label={`Chart type: ${activeType.label}`} onPress={() => setSheet('type')}>
              <Glyph name={activeType.icon} />
            </IconButton>
            <IconButton label="Full screen" onPress={() => { setSheet(null); setFullscreen(true); }}>
              <Glyph name={{ ios: 'arrow.up.left.and.arrow.down.right', android: 'fullscreen', web: 'fullscreen' }} />
            </IconButton>
          </View>

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Buy ${symbol}`} disabled={!tradable} onPress={() => openOrder('BUY')}
              style={({ pressed }) => [styles.tradeButton, { backgroundColor: UP }, !tradable && styles.tradeDisabled, pressed && styles.pressed]}>
              <Text style={styles.tradeText}>Buy</Text>
            </Pressable>
            <View style={styles.accountPill} accessibilityLabel="Paper account in US dollars">
              <Text style={styles.accountTop}>Paper</Text>
              <Text style={styles.accountBottom}>USD</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Sell ${symbol}`} disabled={!tradable} onPress={() => openOrder('SELL')}
              style={({ pressed }) => [styles.tradeButton, { backgroundColor: DOWN }, !tradable && styles.tradeDisabled, pressed && styles.pressed]}>
              <Text style={styles.tradeText}>Sell</Text>
            </Pressable>
          </View>
          {!tradable ? <Text style={styles.tradeNote}>{symbol} is quoted in {metadata.currency}; paper trading settles in USDT, so this pair is view-only.</Text> : null}
        </>
      )}

      {sheet && (
        <View style={StyleSheet.absoluteFill}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.backdrop} onPress={() => { if (!orderBusy) setSheet(null); }} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap} pointerEvents="box-none">
            <SafeAreaView edges={['bottom']} style={styles.sheet}>
              <View style={styles.grabber} />
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>
                  {sheet === 'symbol' ? 'Switch pair' : sheet === 'timeframe' ? 'Timeframe' : sheet === 'type' ? 'Chart type'
                    : sheet === 'indicators' ? 'Indicators' : sheet === 'settings' ? 'Chart settings' : `${side === 'BUY' ? 'Buy' : 'Sell'} ${symbol}`}
                </Text>
                <IconButton label="Close" onPress={() => { if (!orderBusy) setSheet(null); }}><Glyph name={{ ios: 'xmark', android: 'close', web: 'close' }} size={20} color={MUTED} /></IconButton>
              </View>
              <ScrollView style={styles.sheetBody} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
                {sheet === 'symbol' && (instrumentsQuery.isPending ? <ActivityIndicator color={INK} /> : (instrumentsQuery.data ?? []).map(item => (
                  <Pressable key={`${item.exchange}:${item.symbol}`} accessibilityRole="button" accessibilityState={{ selected: item.symbol === symbol }}
                    style={styles.option} onPress={() => switchInstrument(item)}>
                    <SymbolIcon symbol={item.symbol} exchange={item.exchange} size={30} />
                    <View style={styles.flex}><Text style={styles.optionTextActive}>{item.symbol}</Text><Text style={styles.optionHint}>{item.name} · {item.exchange}</Text></View>
                    {item.symbol === symbol ? <Glyph name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={20} /> : null}
                  </Pressable>
                )))}
                {sheet === 'timeframe' && timeframeOptions}
                {sheet === 'type' && typeOptions}
                {sheet === 'indicators' && indicatorOptions}
                {sheet === 'settings' && (
                  <>
                    <Text style={styles.section}>Timeframe</Text>{timeframeOptions}
                    <Text style={styles.section}>Chart type</Text>{typeOptions}
                    <Text style={styles.section}>Indicators</Text>{indicatorOptions}
                    <Text style={styles.sourceNote}>{sourceLabel}</Text>
                  </>
                )}
                {sheet === 'order' && <PaperOrderTicket key={symbol + ':' + exchange} symbol={symbol} exchange={exchange} initialSide={side} onBusyChange={setOrderBusy} />}
              </ScrollView>
            </SafeAreaView>
          </KeyboardAvoidingView>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.55 },
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 4 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  titleButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 4, flexShrink: 1 },
  title: { fontSize: 22, fontWeight: '700', color: INK, letterSpacing: -0.4, flexShrink: 1 },
  chart: { flex: 1, minHeight: 0, borderTopWidth: 1, borderTopColor: LINE },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { fontSize: 13, color: MUTED },
  link: { fontSize: 14, fontWeight: '600', color: INK, padding: 12, textDecorationLine: 'underline' },
  exitFullscreen: { position: 'absolute', right: 12, bottom: 12, width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 4, minHeight: 52, borderTopWidth: 1, borderTopColor: LINE },
  toolPair: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingRight: 8, flexShrink: 1 },
  toolTimeframe: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 10 },
  toolText: { fontSize: 16, color: INK, fontWeight: '500' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  tradeButton: { flex: 1, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  tradeDisabled: { opacity: 0.35 },
  tradeText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  accountPill: { flex: 1, height: 50, borderRadius: 25, backgroundColor: '#F0F1F7', alignItems: 'center', justifyContent: 'center' },
  accountTop: { fontSize: 14, color: INK },
  accountBottom: { fontSize: 11, color: MUTED, marginTop: 1 },
  tradeNote: { fontSize: 11, color: MUTED, textAlign: 'center', paddingHorizontal: 20, paddingBottom: 6 },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(17,18,28,0.4)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '82%', width: '100%', maxWidth: 520, alignSelf: 'center' },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#C9CEDB', marginTop: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 8 },
  sheetTitle: { fontSize: 18, fontWeight: '600', color: INK },
  sheetBody: { flexGrow: 0 },
  sheetContent: { paddingHorizontal: 20, paddingBottom: 20, gap: 4 },
  section: { fontSize: 12, fontWeight: '600', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 14, marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minWidth: 56, minHeight: 44, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#F0F1F7', alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: INK },
  chipText: { fontSize: 14, color: '#3A4050', fontWeight: '500' },
  chipTextActive: { color: '#FFFFFF' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, borderBottomWidth: 1, borderBottomColor: LINE },
  optionText: { flex: 1, fontSize: 15, color: '#3A4050' },
  optionTextActive: { fontSize: 15, color: INK, fontWeight: '600' },
  optionHint: { fontSize: 12, color: MUTED, marginTop: 2 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#C9CEDB', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: INK, borderColor: INK },
  sourceNote: { fontSize: 12, color: MUTED, marginTop: 14, lineHeight: 17 },
  sideSwitch: { flexDirection: 'row', backgroundColor: '#F0F1F7', borderRadius: 12, padding: 4, marginTop: 4, marginBottom: 6 },
  sideOption: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  sideText: { fontSize: 15, fontWeight: '600', color: '#3A4050' },
  sideTextActive: { color: '#FFFFFF' },
  orderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 40 },
  orderLabel: { fontSize: 14, color: MUTED },
  orderValue: { fontSize: 14, color: INK, fontWeight: '600', fontVariant: ['tabular-nums'] },
  qtyInput: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: '#F4F5FB', paddingHorizontal: 14, fontSize: 18, color: INK, fontVariant: ['tabular-nums'] },
  success: { fontSize: 13, color: UP, marginTop: 8 },
  error: { fontSize: 13, color: DOWN, marginTop: 8 },
  placeButton: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
});
