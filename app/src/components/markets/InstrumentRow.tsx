import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SymbolIcon } from '@/components/markets/SymbolIcon';
import { PriceChange } from '@/components/ui/PriceChange';
import { Sparkline } from '@/components/ui/Sparkline';
import { Palette } from '@/constants/theme';
import { useMarketHistory } from '@/hooks/use-market-history';
import { buildHistoryChart, buildWatchlistChart } from '@/lib/marketHistory';
import { formatMarketPrice, marketSourceLabel } from '@/lib/format';
import { DEMO_MODE } from '@/lib/demoMode';

export type QuoteLike = {
  currency?: string;
  pricePrecision?: number;
  stale?: boolean;
  assetClass?: 'crypto' | 'forex';
  symbol: string;
  exchange: string;
  name: string;
  ltp: number;
  change: number;
  changePercent: number;
  sparkline?: number[];
  source?: 'demo' | 'binance' | 'twelvedata';
  asOf?: number;
};

type Props = {
  quote: QuoteLike;
  onRemove?: () => void;
};

export function InstrumentRow({ quote, onRemove }: Props) {
  const [rowWidth, setRowWidth] = useState(324);
  const compact = rowWidth < 320;
  const historyQuery = useMarketHistory(quote.symbol, quote.exchange);
  const history = buildHistoryChart(historyQuery.data, DEMO_MODE);
  const fallback = history ? null : buildWatchlistChart(undefined, quote, DEMO_MODE);
  const source = history ? historyQuery.data?.source : quote.source;
  const caption = history ? `${source === 'demo' ? 'Demo · ' : ''}1D`
    : fallback ? (source === 'demo' ? 'Demo' : 'Recent') : historyQuery.isPending ? 'Loading' : 'No history';
  return (
    <View style={styles.wrap} onLayout={event => setRowWidth(event.nativeEvent.layout.width)}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${quote.name} chart`}
        onPress={() => router.push({ pathname: '/instrument/[symbol]', params: { symbol: quote.symbol, exchange: quote.exchange, name: quote.name } })}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <View style={[styles.row, onRemove && { paddingRight: 32 }]}>
          <View style={styles.identity}>
            <SymbolIcon symbol={quote.symbol} exchange={quote.exchange} size={32} />
            <View style={styles.names}>
              <Text style={styles.symbol} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{quote.symbol}</Text>
              <Text style={styles.name} numberOfLines={1}>{quote.name}</Text>
            </View>
          </View>
          <View style={styles.chart}>
            <Sparkline data={history?.points.map(point => point.value) ?? fallback?.points.map(point => point.value)}
              times={history?.points.map(point => point.time)} label={history ? `${history.sessionDate}, five-minute closing prices` : caption}
              width={compact ? 48 : 64} height={36} positive={quote.changePercent >= 0} />
            <Text style={styles.chartCaption}>{caption}</Text>
          </View>
          <View style={[styles.right, { width: compact ? 82 : 96 }]}>
            <Text style={styles.ltp} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {formatMarketPrice(quote.ltp, quote, false)}
            </Text>
            <Text style={styles.chartCaption}>{quote.currency ?? (quote.exchange === 'FOREX' ? quote.symbol.slice(-3) : 'USDT')} · {quote.stale ? 'Last price' : marketSourceLabel(source)}</Text>
            <PriceChange change={quote.change} changePercent={quote.changePercent} compact />
          </View>
        </View>
      </Pressable>
      {onRemove ? <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${quote.symbol}`}
        onPress={onRemove} style={styles.removeBtn} hitSlop={8}>
        <Text style={styles.removeText}>×</Text>
      </Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', marginBottom: 10 },
  button: { borderRadius: 16, borderWidth: 1, borderColor: '#ECECF3', backgroundColor: '#fff', overflow: 'hidden' },
  pressed: { backgroundColor: '#F6F3FD' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 18, minHeight: 80 },
  identity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9 },
  names: { flex: 1, minWidth: 0, gap: 5 },
  chart: { alignItems: 'center', flexShrink: 0, gap: 5 },
  chartCaption: { color: '#8F96A4', fontSize: 8 },
  symbol: { color: Palette.text, fontSize: 13, fontWeight: '600', letterSpacing: -0.2 },
  name: { color: '#858998', fontSize: 11 },
  right: { alignItems: 'flex-end', flexShrink: 0, gap: 5 },
  ltp: { color: '#1E293B', fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'], letterSpacing: -0.3 },
  removeBtn: { position: 'absolute', right: 6, top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 6, zIndex: 2 },
  removeText: { color: Palette.textMuted, fontSize: 22, fontWeight: '400', lineHeight: 24 },
});
