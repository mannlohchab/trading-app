import { StyleSheet, Text, View } from 'react-native';

import type { QuoteLike } from './InstrumentRow';
import { SymbolIcon } from './SymbolIcon';
import { WatchlistMiniChart } from '@/components/charts/WatchlistMiniChart';
import { GlassDirectionIcon, GlassPressable } from '@/components/ui/GlassIcon';
import { formatMarketPrice, formatPct, marketSourceLabel } from '@/lib/format';
import { ApiError } from '@/lib/api';
import { buildWatchlistChart } from '@/lib/marketHistory';
import { DEMO_MODE } from '@/lib/demoMode';
import { useMarketHistory } from '@/hooks/use-market-history';

type Props = {
  quote: QuoteLike;
  width: number;
  onPress: () => void;
  onRemove: () => void;
};

export function HomeQuoteCard({ quote, width, onPress, onRemove }: Props) {
  const historyQuery = useMarketHistory(quote.symbol, quote.exchange);
  const chart = buildWatchlistChart(historyQuery.data, quote, DEMO_MODE);
  const unavailable = historyQuery.error instanceof ApiError && historyQuery.error.status === 503
    || (!DEMO_MODE && historyQuery.data?.isDemo === true);
  const chartMessage = historyQuery.isPending ? 'Loading chart…'
    : unavailable ? 'Live history unavailable'
    : historyQuery.isError ? 'Could not load chart'
    : 'No price history yet';
  const chartWidth = Math.max(1, width - 38);
  const up = quote.changePercent >= 0;
  const changeColor = up ? '#0cba74' : '#e44265';

  return (
    <GlassPressable
      accessibilityRole="button"
      accessibilityLabel={`${quote.name}, ${formatMarketPrice(quote.ltp, quote)}, ${formatPct(quote.changePercent)}`}
      accessibilityHint="Open instrument detail. Long press to remove from watchlist."
      style={({ pressed }) => [styles.card, { width }, pressed && { opacity: 0.75 }]}
      onPress={onPress}
      onLongPress={onRemove}>
      <View style={styles.heading}>
        <SymbolIcon symbol={quote.symbol} exchange={quote.exchange} size={32} />
        <View style={styles.nameWrap}>
          <Text style={styles.name} numberOfLines={1}>{quote.name.split(' ')[0]}</Text>
          <Text style={styles.symbol} numberOfLines={1}>{quote.symbol}</Text>
        </View>
      </View>
      <View style={styles.chart} accessibilityLabel={chart ? `${chart.caption}. Highest plotted price ${formatMarketPrice(chart.peak.value, quote)}.` : chartMessage}>
        {chart ? <WatchlistMiniChart chart={chart} width={chartWidth} metadata={quote} /> : <Text style={styles.chartEmpty}>{chartMessage}</Text>}
        {chart ? <Text style={styles.chartCaption}>{chart.caption}{historyQuery.isError && historyQuery.data ? ' · Update failed' : ''}</Text> : null}
      </View>
      <Text style={styles.price} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatMarketPrice(quote.ltp, quote)}</Text>
      <View style={styles.change}>
        <Text style={[styles.percent, { color: changeColor }]}>{formatPct(quote.changePercent)}</Text>
        <GlassDirectionIcon up={up} size={16} />
      </View>
      <Text style={styles.source}>{marketSourceLabel(quote.source)}{quote.stale ? ' · Last observation' : ''}</Text>
    </GlassPressable>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 258, padding: 18, borderRadius: 18, borderWidth: 1, borderColor: '#dce0e5', backgroundColor: '#fff' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameWrap: { flex: 1 },
  name: { color: '#0F172A', fontSize: 15, fontWeight: '600', letterSpacing: -0.4 },
  symbol: { color: '#777d87', fontSize: 11, marginTop: 3 },
  chart: { height: 96, marginTop: 26, marginBottom: 20, justifyContent: 'center' },
  chartCaption: { position: 'absolute', bottom: -13, left: 0, color: '#9298a1', fontSize: 8 },
  chartEmpty: { color: '#9298a1', fontSize: 11, textAlign: 'center' },
  price: { color: '#0f172a', fontSize: 27, fontWeight: '600', letterSpacing: -1.2 },
  change: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  percent: { fontSize: 12, fontWeight: '500' },
  source: { color: '#8b651f', fontSize: 10, marginTop: 7 },
});
