import { memo, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/AppText';
import { InsightPalette as P } from '@/constants/theme';
import type { AiBacktestResult } from '@/lib/aiBlocks';
import { pairName } from '@/lib/marketData';

const UP = '#089981', DOWN = '#F23645';
const PLOT_H = 88;

function fmt(v: string | number | null | undefined, digits = 2) {
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toFixed(digits);
}

function EquitySpark({ points }: { points: { time: number; equity: string }[] }) {
  const [width, setWidth] = useState(0);
  const path = useMemo(() => {
    if (width <= 0 || points.length < 2) return null;
    const values = points.map(p => Number(p.equity)).filter(Number.isFinite);
    if (values.length < 2) return null;
    const min = Math.min(...values), max = Math.max(...values);
    const span = Math.max(max - min, Math.abs(max) * 0.001, 1e-9);
    const step = width / (values.length - 1);
    return values.map((v, i) => ({
      x: i * step,
      y: ((max - v) / span) * (PLOT_H - 8) + 4,
    }));
  }, [points, width]);
  const up = points.length >= 2 && Number(points.at(-1)!.equity) >= Number(points[0]!.equity);

  return (
    <View style={styles.spark} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      {path?.slice(1).map((p, i) => {
        const a = path[i]!;
        const length = Math.hypot(p.x - a.x, p.y - a.y);
        const angle = Math.atan2(p.y - a.y, p.x - a.x);
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: (a.x + p.x - length) / 2,
              top: (a.y + p.y) / 2 - 1,
              width: length,
              height: 2,
              backgroundColor: up ? UP : DOWN,
              transform: [{ rotate: `${angle}rad` }],
            }}
          />
        );
      })}
    </View>
  );
}

/** Engine-backed backtest summary: metrics, equity sparkline, recent trades. */
export const AiBacktestCard = memo(function AiBacktestCard({ result }: { result: AiBacktestResult }) {
  const m = result.metrics;
  const ret = Number(m.totalReturnPercent);
  const up = Number.isFinite(ret) ? ret >= 0 : true;
  const name = pairName(result.market.symbol);
  const trades = result.trades.slice(-8).reverse();

  return (
    <View style={styles.card} accessibilityRole="summary" accessibilityLabel={`Backtest of ${name} on ${result.market.timeframe}`}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.title}>Backtest · {name}</Text>
          <Text style={styles.muted}>{result.market.symbol} · {result.market.timeframe} · {result.engine.name}</Text>
        </View>
        <Text style={[styles.return, { color: up ? UP : DOWN }]}>
          {Number.isFinite(ret) ? `${ret >= 0 ? '+' : ''}${fmt(ret)}%` : '—'}
        </Text>
      </View>

      {result.equityCurve.length > 1 ? <EquitySpark points={result.equityCurve} /> : null}

      <View style={styles.metrics}>
        <Metric label="Trades" value={String(m.totalTrades ?? '—')} />
        <Metric label="Win rate" value={m.winRatePercent == null ? '—' : `${fmt(m.winRatePercent)}%`} />
        <Metric label="Max DD" value={m.maxDrawdownPercent == null ? '—' : `${fmt(m.maxDrawdownPercent)}%`} />
        <Metric label="Net P/L" value={fmt(m.netProfit)} />
        <Metric label="Final eq." value={fmt(m.finalEquity, 0)} />
        <Metric label="vs B&H" value={m.buyAndHoldReturnPercent == null ? '—' : `${fmt(m.buyAndHoldReturnPercent)}%`} />
      </View>

      {result.warnings.length ? (
        <Text style={styles.warn} numberOfLines={2}>{result.warnings.map(w => w.message).join(' · ')}</Text>
      ) : null}

      {trades.length ? (
        <View style={styles.trades}>
          <Text style={styles.section}>Recent trades</Text>
          {trades.map((t, i) => {
            const profit = Number(t.profit);
            const good = Number.isFinite(profit) ? profit >= 0 : true;
            return (
              <View key={i} style={styles.tradeRow}>
                <Text style={styles.tradeSide}>{t.side ?? '—'}</Text>
                <Text style={styles.tradePx} numberOfLines={1}>{t.entryPrice ?? '—'} → {t.exitPrice ?? '—'}</Text>
                <Text style={[styles.tradePnL, { color: good ? UP : DOWN }]}>{fmt(t.profit)}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <Text style={styles.disclaimer}>Historical engine run on closed candles — not a prediction.</Text>
    </View>
  );
});

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 10, padding: 14, borderRadius: 16,
    backgroundColor: P.card, borderWidth: 1, borderColor: P.border, gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  title: { color: P.text, fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  muted: { color: P.textMuted, fontSize: 12, marginTop: 2 },
  return: { fontSize: 18, fontWeight: '700', letterSpacing: -0.4 },
  spark: { height: PLOT_H, borderRadius: 10, backgroundColor: P.soft, overflow: 'hidden' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { width: '30%', minWidth: 90, flexGrow: 1, paddingVertical: 6 },
  metricLabel: { color: P.textMuted, fontSize: 11, fontWeight: '600' },
  metricValue: { color: P.text, fontSize: 14, fontWeight: '600', marginTop: 2 },
  warn: { color: P.textSecondary, fontSize: 12, lineHeight: 16 },
  trades: { gap: 6 },
  section: { color: P.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  tradeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tradeSide: { width: 42, color: P.text, fontSize: 11, fontWeight: '700' },
  tradePx: { flex: 1, color: P.body, fontSize: 12 },
  tradePnL: { fontSize: 12, fontWeight: '700' },
  disclaimer: { color: P.textMuted, fontSize: 11, lineHeight: 14 },
});
