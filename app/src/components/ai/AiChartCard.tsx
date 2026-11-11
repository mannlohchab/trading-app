import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { Text } from '@/components/ui/AppText';
import { InsightPalette as P } from '@/constants/theme';
import { layoutChart, lineSegments, type AiChart, type ChartPoint } from '@/lib/aiCharts';
import { formatMarketPrice } from '@/lib/format';
import { pairName } from '@/lib/marketData';

const PLOT_HEIGHT = 170;
const UP = '#089981', DOWN = '#F23645';
const LINE_COLORS: Record<string, string> = { SMA20: '#F7A21B', SMA50: '#8E24AA', EMA20: '#2962FF' };
const LEVEL_COLORS = { resistance: DOWN, support: UP };

function Polyline({ points, color, thickness = 1.5 }: { points: ChartPoint[]; color: string; thickness?: number }) {
  return <>{lineSegments(points).map((s, i) => (
    <View key={i} style={[styles.segment, { left: s.left, top: s.top, width: s.width, height: thickness, backgroundColor: color, transform: [{ rotate: `${s.angle}rad` }] }]} />
  ))}</>;
}

const timeLabel = (ms: number, timeframe: string) => new Date(ms).toLocaleString('en-US', /^(1d|1w|1M)$/.test(timeframe)
  ? { day: 'numeric', month: 'short' }
  : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/** A chart the assistant drew from real candles. Tap to open the full interactive chart. */
export const AiChartCard = memo(function AiChartCard({ chart }: { chart: AiChart }) {
  const [width, setWidth] = useState(0);
  const layout = useMemo(() => (width > 0 ? layoutChart(chart, width, PLOT_HEIGHT) : null), [chart, width]);
  const meta = { exchange: chart.exchange, symbol: chart.symbol, pricePrecision: chart.pricePrecision };
  const price = (v: number) => formatMarketPrice(v, meta, false);
  const first = chart.candles[0]![0], last = chart.candles[chart.candles.length - 1]![0];
  const name = pairName(chart.symbol);
  const up = chart.changePercent >= 0;
  const summary = `${name} ${chart.timeframe} chart, ${chart.candles.length} candles. Last close ${price(chart.lastClose)}, ${up ? 'up' : 'down'} ${Math.abs(chart.changePercent)}% over the chart.`
    + chart.levels.map(l => ` ${l.label} ${price(l.price)}.`).join('');

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={summary} accessibilityHint="Opens the full chart"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={() => router.push({ pathname: '/instrument/[symbol]', params: { symbol: chart.symbol, exchange: chart.exchange, timeframe: chart.timeframe } })}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.title} numberOfLines={1}>{name} <Text style={styles.muted}>· {chart.symbol} · {chart.timeframe}</Text></Text>
          <Text style={styles.muted}>{chart.exchange} · {chart.candles.length} candles</Text>
        </View>
        <View style={styles.priceBox}>
          <Text style={styles.price}>{price(chart.lastClose)}</Text>
          <Text style={[styles.change, { color: up ? UP : DOWN }]}>{up ? '+' : ''}{chart.changePercent.toFixed(2)}%</Text>
        </View>
      </View>

      <View style={styles.chartRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={styles.plot} onLayout={e => setWidth(e.nativeEvent.layout.width)} pointerEvents="none">
          {layout && <>
            {layout.ticks.map(t => <View key={t.y} style={[styles.grid, { top: t.y }]} />)}
            {chart.chartType === 'candle'
              ? layout.candles.map((c, i) => (
                <View key={i}>
                  <View style={[styles.wick, { left: c.x - 0.5, top: c.wickTop, height: Math.max(1, c.wickBottom - c.wickTop), backgroundColor: c.up ? UP : DOWN }]} />
                  <View style={[styles.body, { left: c.x - c.width / 2, width: c.width, top: c.bodyTop, height: c.bodyHeight, backgroundColor: c.up ? UP : DOWN }]} />
                </View>))
              : <Polyline points={layout.close} color={P.text} thickness={2} />}
            {layout.lines.map(l => l.runs.map((run, i) => <Polyline key={`${l.id}-${i}`} points={run} color={LINE_COLORS[l.id] ?? P.textSecondary} />))}
            {layout.levels.map(l => (
              <View key={l.kind} style={[styles.level, { top: l.y, borderColor: LEVEL_COLORS[l.kind] }]} />
            ))}
          </>}
        </View>
        <View style={styles.axis}>
          {layout?.ticks.map(t => <Text key={t.y} style={[styles.axisText, { top: t.y - 7 }]} numberOfLines={1}>{price(t.price)}</Text>)}
        </View>
      </View>
      <View style={styles.timeAxis}>
        <Text style={styles.axisLabel}>{timeLabel(first, chart.timeframe)}</Text>
        <Text style={styles.axisLabel}>{timeLabel(last, chart.timeframe)}</Text>
      </View>

      {(chart.lines.length > 0 || chart.levels.length > 0) && <View style={styles.legend}>
        {chart.lines.map(l => <View key={l.id} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: LINE_COLORS[l.id] ?? P.textSecondary }]} /><Text style={styles.legendText}>{l.label}</Text>
        </View>)}
        {chart.levels.map(l => <View key={l.kind} style={styles.legendItem}>
          <View style={[styles.swatch, styles.dashed, { borderColor: LEVEL_COLORS[l.kind] }]} />
          <Text style={styles.legendText}>{l.label} {price(l.price)}</Text>
        </View>)}
      </View>}
      <Text style={styles.open}>Open full chart ›</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.85 },
  card: { marginTop: 6, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: P.border, backgroundColor: P.card, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { color: P.text, fontSize: 14, fontWeight: '600' },
  muted: { color: P.textMuted, fontSize: 11, fontWeight: '400' },
  priceBox: { alignItems: 'flex-end' },
  price: { color: P.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  change: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  chartRow: { flexDirection: 'row', height: PLOT_HEIGHT },
  plot: { flex: 1, overflow: 'hidden' },
  grid: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: P.border },
  wick: { position: 'absolute', width: 1 },
  body: { position: 'absolute', borderRadius: 1 },
  segment: { position: 'absolute', borderRadius: 1 },
  level: { position: 'absolute', left: 0, right: 0, height: 0, borderTopWidth: 1, borderStyle: 'dashed' },
  axis: { width: 62, marginLeft: 6 },
  axisText: { position: 'absolute', right: 0, color: P.textMuted, fontSize: 10, fontVariant: ['tabular-nums'] },
  timeAxis: { flexDirection: 'row', justifyContent: 'space-between', marginRight: 68 },
  axisLabel: { color: P.textMuted, fontSize: 10 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 12, height: 2, borderRadius: 1 },
  dashed: { height: 0, borderTopWidth: 1.5, borderStyle: 'dashed', backgroundColor: 'transparent' },
  legendText: { color: P.body, fontSize: 11 },
  open: { color: P.textSecondary, fontSize: 12, fontWeight: '500' },
});
