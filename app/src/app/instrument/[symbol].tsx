import { useQuery } from '@tanstack/react-query';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StatusBar } from 'expo-status-bar';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ChartDrawing } from '@/components/charts/chartDrawingTools';
import { TradingChart, type DrawingAction, type DrawingCommand, type DrawingState } from '@/components/charts/TradingChart';
import { SymbolIcon } from '@/components/markets/SymbolIcon';
import { Text } from '@/components/ui/AppText';
import { useLiveMarket, useLiveCandles } from '@/hooks/use-live-market';
import { fetchCandles, fetchTickerList } from '@/lib/marketData';
import { marketAssets } from '@/lib/marketAssets';
import { PaperOrderTicket } from '@/components/trading/PaperOrderTicket';
import { marketMetadata, marketSourceLabel } from '@/lib/format';
import { fetchChartTrades } from '@/lib/paperTrading';
import { useAuth } from '@/store/auth';
import { Fonts } from '@/constants/theme';

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
  { id: 'MACD', label: 'MACD (12, 26, 9)' },
  { id: 'MA', label: 'Moving average (20)' },
  { id: 'RSI', label: 'RSI (14)' },
  { id: 'EMA', label: 'Exponential moving average (20)' },
  { id: 'ATR', label: 'ATR (14)' },
  { id: 'ST', label: 'Supertrend (10, 3)' },
  { id: 'BB', label: 'Bollinger Bands (20, 2)' },
  { id: 'SESSION', label: 'Trading session' },
] as const;
/** Paper accounts settle in USD; USDT is treated 1:1 (see server instruments.ts). */
const SETTLEMENT = new Set(['USD', 'USDT']);
const NO_TRADES: { time: number; price: number; side: 'BUY' | 'SELL' }[] = [];

// Light chart theme.
const BG = '#FFFFFF';
const SURFACE = '#F0F3FA';
const BORDER = '#E0E3EB';
const TEXT = '#131722';
/** Strongest text: selected options and titles. */
const STRONG = '#131722';
/** Text and icons on coloured buttons. */
const ON_COLOR = '#FFFFFF';
const MUTED = '#787B86';
const ACCENT = '#2962FF';
const UP = '#089981';
/** This screen follows trading-terminal typography (sans) rather than the app's serif default. */
const SANS = Fonts.sans;
const DOWN = '#F23645';

/** Full names for the quote side of a pair, as in "XRP / U.S. Dollar". */
const QUOTE_NAMES: Record<string, string> = {
  USD: 'U.S. Dollar', USDT: 'TetherUS', USDC: 'USD Coin', FDUSD: 'First Digital USD', EUR: 'Euro', GBP: 'British Pound',
  JPY: 'Japanese Yen', BTC: 'Bitcoin', ETH: 'Ethereum', BNB: 'BNB', TRY: 'Turkish Lira',
};

function pairTitle(symbol: string, exchange: string) {
  const assets = marketAssets(symbol, exchange);
  return assets ? `${assets[0]} / ${QUOTE_NAMES[assets[1]] ?? assets[1]}` : symbol;
}

/** Timeframe as shown in the toolbar: minutes stay lower-case, hours and up are upper-case ("15m", "1H", "1D"). */
const timeframeLabel = (tf: string) => (tf.endsWith('m') ? tf : tf.toUpperCase());

type SymbolName = Extract<SymbolViewProps['name'], object>;
type Sheet = 'symbol' | 'timeframe' | 'indicators' | 'more' | 'order' | null;

const NO_DRAWINGS: DrawingState = { activeTool: 'cursor', canUndo: false, canRedo: false, hidden: false, count: 0 };
type Instrument = { symbol: string; exchange: string; name: string };

function Glyph({ name, size = 24, color = TEXT }: { name: SymbolName; size?: number; color?: string }) {
  return <SymbolView name={name} size={size} tintColor={color} type="monochrome" accessible={false} />;
}

function IconButton({ label, onPress, children, disabled }: { label: string; onPress: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled}
      onPress={onPress} hitSlop={4} style={({ pressed }) => [styles.iconButton, disabled && styles.disabled, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

const check: SymbolName = { ios: 'checkmark', android: 'check', web: 'check' };

export default function InstrumentScreen() {
  const params = useLocalSearchParams<{ symbol: string; exchange?: string; name?: string; timeframe?: string }>();
  const symbol = String(params.symbol ?? 'BTCUSDT').toUpperCase();
  const exchange = String(params.exchange ?? 'BINANCE').toUpperCase();
  const drawingStore = useRef<Record<string, ChartDrawing[]>>({});
  // Links (e.g. an AI chart card) may open the chart on a given timeframe.
  const [timeframe, setTimeframe] = useState<Timeframe>(() => TIMEFRAMES.find(tf => tf === params.timeframe) ?? '15m');
  const [chartType, setChartType] = useState<ChartType>('candle');
  const [indicators, setIndicators] = useState<string[]>(['VOL']);
  const [chartHeight, setChartHeight] = useState(0);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [drawingCommand, setDrawingCommand] = useState<DrawingCommand>();
  const [drawing, setDrawing] = useState<DrawingState>(NO_DRAWINGS);
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderBusy, setOrderBusy] = useState(false);

  const userId = useAuth(s => s.user?.id);
  const loadCandles = useLiveCandles(symbol, exchange, timeframe);
  const candlesQuery = useQuery({
    queryKey: ['candles', symbol, exchange, timeframe],
    refetchInterval: 60_000,
    retry: false,
    queryFn: ({ signal }) => loadCandles(() => fetchCandles(symbol, timeframe, 500, signal)),
  });

  const tradesQuery = useQuery({
    queryKey: ['paper-orders', 'chart', userId, exchange, symbol],
    enabled: Boolean(userId),
    refetchInterval: 15_000,
    queryFn: ({ signal }) => fetchChartTrades(userId!, symbol, exchange, signal),
  });

  const feedStatus = useLiveMarket([`${exchange}:${symbol}`]);
  const metadata = { ...marketMetadata({ symbol, exchange }), ...candlesQuery.data };
  const candles = candlesQuery.data?.candles ?? [];
  const tradable = SETTLEMENT.has(metadata.currency);
  const sourceLabel = `${marketSourceLabel(candlesQuery.data?.source)} · ${metadata.currency} · ${feedStatus}`;
  const drawingKey = `${exchange}:${symbol}:${timeframe}`;

  // Pair switcher: the 50 most active USDT pairs.
  const instrumentsQuery = useQuery({
    queryKey: ['explore', 'volume', 'switcher'],
    enabled: sheet === 'symbol',
    queryFn: async ({ signal }) => (await fetchTickerList('volume', 50, signal)).crypto.map(({ symbol, exchange, name }) => ({ symbol, exchange, name })),
  });

  const onDrawingState = useCallback((next: DrawingState) => {
    setDrawing(previous => (Object.keys(next) as (keyof DrawingState)[]).every(key => previous[key] === next[key]) ? previous : next);
  }, []);

  /** Sends a command to the chart; each gets a fresh id so repeats (and double delivery) are told apart. */
  function sendDrawing(action: DrawingAction) {
    setDrawingCommand(previous => ({ ...action, id: (previous?.id ?? 0) + 1 }));
  }



  function close() {
    if (router.canGoBack()) router.back(); else router.replace('/(tabs)/markets');
  }

  function openOrder(next: 'BUY' | 'SELL') {
    setSide(next);
    setSheet('order');
  }

  function switchInstrument(item: Instrument) {
    setSheet(null);
    if (item.symbol === symbol && item.exchange === exchange) return;
    setDrawing(NO_DRAWINGS);
    router.setParams({ symbol: item.symbol, exchange: item.exchange, name: item.name });
  }

  function chooseTimeframe(item: Timeframe) {
    if (item !== timeframe) setDrawing(NO_DRAWINGS);
    setTimeframe(item);
    if (sheet === 'timeframe') setSheet(null);
  }

  function toggleIndicator(id: string) {
    setIndicators(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  }

  const timeframeOptions = (
    <View style={styles.grid}>
      {TIMEFRAMES.map(item => (
        <Pressable key={item} accessibilityRole="button" accessibilityLabel={`${item} candles`} accessibilityState={{ selected: timeframe === item }}
          style={[styles.chip, timeframe === item && styles.chipActive]} onPress={() => chooseTimeframe(item)}>
          <Text style={[styles.chipText, timeframe === item && styles.chipTextActive]}>{timeframeLabel(item)}</Text>
        </Pressable>
      ))}
    </View>
  );
  const typeOptions = CHART_TYPES.map(item => (
    <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: chartType === item.id }} style={styles.option}
      onPress={() => setChartType(item.id)}>
      <Glyph name={item.icon} size={22} color={chartType === item.id ? STRONG : MUTED} />
      <Text style={[styles.optionText, chartType === item.id && styles.optionTextActive]}>{item.label}</Text>
      {chartType === item.id ? <Glyph name={check} size={20} color={ACCENT} /> : null}
    </Pressable>
  ));
  const indicatorOptions = INDICATORS.map(item => (
    <Pressable key={item.id} accessibilityRole="switch" accessibilityState={{ checked: indicators.includes(item.id) }} style={styles.option} onPress={() => toggleIndicator(item.id)}>
      <Text style={[styles.optionText, indicators.includes(item.id) && styles.optionTextActive]}>{item.label}</Text>
      <View style={[styles.checkbox, indicators.includes(item.id) && styles.checkboxOn]}>
        {indicators.includes(item.id) ? <Glyph name={check} size={14} color={ON_COLOR} /> : null}
      </View>
    </Pressable>
  ));

  const sheetTitle = sheet === 'symbol' ? 'Switch pair' : sheet === 'timeframe' ? 'Timeframe' : sheet === 'indicators' ? 'Indicators'
    : sheet === 'more' ? 'Chart settings' : `${side === 'BUY' ? 'Buy' : 'Sell'} ${symbol}`;

  return (
    <SafeAreaView style={styles.safe} edges={fullscreen ? ['top'] : ['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="dark" />

      <View style={styles.chart} onLayout={event => setChartHeight(event.nativeEvent.layout.height)}>
        {candles.length ? chartHeight > 0 ? (
          <TradingChart key={drawingKey} pricePrecision={metadata.pricePrecision} currency={metadata.currency}
            candles={candles} chartType={chartType} indicators={indicators} height={chartHeight} symbol={symbol}
            exchange={exchange} timeframe={timeframe} title={pairTitle(symbol, exchange)}
            drawingCommand={drawingCommand} onDrawingState={onDrawingState}
            drawingKey={drawingKey} drawingStore={drawingStore} trades={tradesQuery.data ?? NO_TRADES} />
        ) : null : (
          <View style={styles.empty}>
            {candlesQuery.isPending ? <ActivityIndicator color={TEXT} /> : null}
            <Text style={styles.muted}>{candlesQuery.isPending ? 'Loading chart…' : 'Price history is unavailable'}</Text>
            {candlesQuery.isError ? <Pressable accessibilityRole="button" onPress={() => void candlesQuery.refetch()}><Text style={styles.link}>Retry</Text></Pressable> : null}
          </View>
        )}
        {/* Sits beside the pair name the chart draws at its top-left. */}
        <Pressable accessibilityRole="button" accessibilityLabel="Close chart" onPress={close} hitSlop={8}
          style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
          <Glyph name={{ ios: 'xmark', android: 'close', web: 'close' }} size={20} color={TEXT} />
        </Pressable>
        {fullscreen && (
          <Pressable accessibilityRole="button" accessibilityLabel="Exit full screen" onPress={() => setFullscreen(false)} style={styles.exitFullscreen}>
            <Glyph name={{ ios: 'arrow.down.right.and.arrow.up.left', android: 'fullscreen_exit', web: 'fullscreen_exit' }} size={22} />
          </Pressable>
        )}
      </View>

      {!fullscreen && (
        <>
          <View style={styles.toolbar}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${symbol}. Switch pair`} onPress={() => setSheet('symbol')}
              style={({ pressed }) => [styles.toolPair, pressed && styles.pressed]}>
              <Text style={styles.toolSymbol} numberOfLines={1}>{symbol}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Timeframe ${timeframe}. Change timeframe`} onPress={() => setSheet('timeframe')}
              style={({ pressed }) => [styles.toolTimeframe, pressed && styles.pressed]}>
              <Text style={styles.toolSymbol}>{timeframeLabel(timeframe)}</Text>
            </Pressable>
            <View style={styles.flex} />
            {/* Opens the drawing toolbar inside the chart (which also has its own pencil button). */}
            <IconButton label={drawing.activeTool === 'cursor' ? 'Drawing tools' : 'Drawing tools, a tool is selected'} onPress={() => sendDrawing({ type: 'toggle-drawing-tools' })}>
              <Glyph name={{ ios: 'pencil', android: 'edit', web: 'edit' }} color={drawing.activeTool === 'cursor' ? TEXT : ACCENT} />
            </IconButton>
            <IconButton label="Indicators" onPress={() => setSheet('indicators')}>
              <Glyph name={{ ios: 'waveform.path.ecg', android: 'ssid_chart', web: 'ssid_chart' }} />
            </IconButton>
            <IconButton label="More chart options" onPress={() => setSheet('more')}>
              <Glyph name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} />
            </IconButton>
            <View style={styles.divider} />
            <IconButton label="Undo drawing" disabled={!drawing.canUndo} onPress={() => sendDrawing({ type: 'drawing-undo' })}>
              <Glyph name={{ ios: 'arrow.uturn.backward', android: 'undo', web: 'undo' }} />
            </IconButton>
            <IconButton label="Redo drawing" disabled={!drawing.canRedo} onPress={() => sendDrawing({ type: 'drawing-redo' })}>
              <Glyph name={{ ios: 'arrow.uturn.forward', android: 'redo', web: 'redo' }} />
            </IconButton>
          </View>

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Sell ${symbol}`} disabled={!tradable} onPress={() => openOrder('SELL')}
              style={({ pressed }) => [styles.tradeButton, { backgroundColor: DOWN }, !tradable && styles.tradeDisabled, pressed && styles.pressed]}>
              <Text style={styles.tradeText}>Sell</Text>
            </Pressable>
            <View style={styles.account} accessibilityLabel="Paper account in US dollars">
              <Text style={styles.accountTop}>Paper</Text>
              <Text style={styles.accountBottom}>USD</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Buy ${symbol}`} disabled={!tradable} onPress={() => openOrder('BUY')}
              style={({ pressed }) => [styles.tradeButton, { backgroundColor: UP }, !tradable && styles.tradeDisabled, pressed && styles.pressed]}>
              <Text style={styles.tradeText}>Buy</Text>
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
                <Text style={styles.sheetTitle}>{sheetTitle}</Text>
                <IconButton label="Close" onPress={() => { if (!orderBusy) setSheet(null); }}><Glyph name={{ ios: 'xmark', android: 'close', web: 'close' }} size={20} color={MUTED} /></IconButton>
              </View>
              <ScrollView style={styles.sheetBody} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
                {sheet === 'symbol' && (instrumentsQuery.isPending ? <ActivityIndicator color={TEXT} /> : (instrumentsQuery.data ?? []).map(item => (
                  <Pressable key={`${item.exchange}:${item.symbol}`} accessibilityRole="button" accessibilityState={{ selected: item.symbol === symbol }}
                    style={styles.option} onPress={() => switchInstrument(item)}>
                    <SymbolIcon symbol={item.symbol} exchange={item.exchange} size={30} />
                    <View style={styles.flex}><Text style={styles.optionTextActive}>{item.symbol}</Text><Text style={styles.optionHint}>{item.name} · {item.exchange}</Text></View>
                    {item.symbol === symbol ? <Glyph name={check} size={20} color={ACCENT} /> : null}
                  </Pressable>
                )))}
                {sheet === 'timeframe' && timeframeOptions}
                {sheet === 'indicators' && indicatorOptions}
                {sheet === 'more' && (
                  <>
                    <Text style={styles.section}>Chart type</Text>{typeOptions}
                    <Text style={styles.section}>Timeframe</Text>{timeframeOptions}
                    <Text style={styles.section}>Indicators</Text>{indicatorOptions}
                    <Pressable accessibilityRole="button" style={[styles.option, styles.optionLast]} onPress={() => { setSheet(null); setFullscreen(true); }}>
                      <Glyph name={{ ios: 'arrow.up.left.and.arrow.down.right', android: 'fullscreen', web: 'fullscreen' }} size={22} color={MUTED} />
                      <Text style={styles.optionText}>Full screen</Text>
                    </Pressable>
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
  disabled: { opacity: 0.35 },
  safe: { flex: 1, backgroundColor: BG },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  chart: { flex: 1, minHeight: 0, backgroundColor: BG },
  closeButton: { position: 'absolute', left: 10, top: 10, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(240,243,250,0.95)' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { fontFamily: SANS, fontSize: 13, color: MUTED },
  link: { fontFamily: SANS, fontSize: 14, fontWeight: '600', color: TEXT, padding: 12, textDecorationLine: 'underline' },
  exitFullscreen: { position: 'absolute', right: 70, bottom: 36, width: 44, height: 44, borderRadius: 22, backgroundColor: SURFACE, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 4, minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER, backgroundColor: BG },
  toolPair: { minHeight: 44, justifyContent: 'center', paddingRight: 14, flexShrink: 1 },
  toolTimeframe: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 6 },
  toolSymbol: { fontFamily: SANS, fontSize: 18, color: TEXT, fontWeight: '500', letterSpacing: 0.2 },
  divider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: BORDER, marginHorizontal: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  tradeButton: { flex: 1, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tradeDisabled: { opacity: 0.35 },
  tradeText: { fontFamily: SANS, color: ON_COLOR, fontSize: 16, fontWeight: '600' },
  account: { minWidth: 64, height: 44, borderRadius: 8, backgroundColor: SURFACE, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  accountTop: { fontFamily: SANS, fontSize: 13, color: TEXT },
  accountBottom: { fontFamily: SANS, fontSize: 10, color: MUTED, marginTop: 1 },
  tradeNote: { fontFamily: SANS, fontSize: 11, color: MUTED, textAlign: 'center', paddingHorizontal: 20, paddingBottom: 6 },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(19,23,34,0.35)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: BG, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '82%', width: '100%', maxWidth: 520, alignSelf: 'center' },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#C9CEDB', marginTop: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 8 },
  sheetTitle: { fontFamily: SANS, fontSize: 18, fontWeight: '600', color: STRONG },
  sheetBody: { flexGrow: 0 },
  sheetContent: { paddingHorizontal: 20, paddingBottom: 20, gap: 4 },
  section: { fontFamily: SANS, fontSize: 12, fontWeight: '600', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 14, marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minWidth: 56, minHeight: 44, paddingHorizontal: 12, borderRadius: 8, backgroundColor: SURFACE, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: ACCENT },
  chipText: { fontFamily: SANS, fontSize: 14, color: TEXT, fontWeight: '500' },
  chipTextActive: { color: ON_COLOR },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  optionLast: { borderBottomWidth: 0, marginTop: 8 },
  optionText: { fontFamily: SANS, flex: 1, fontSize: 15, color: TEXT },
  optionTextActive: { fontFamily: SANS, flex: 1, fontSize: 15, color: STRONG, fontWeight: '600' },
  optionHint: { fontFamily: SANS, fontSize: 12, color: MUTED, marginTop: 2 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#B2B5BE', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  sourceNote: { fontFamily: SANS, fontSize: 12, color: MUTED, marginTop: 14, lineHeight: 17 },
});
