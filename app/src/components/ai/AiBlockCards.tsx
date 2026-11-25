import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { Text } from '@/components/ui/AppText';
import { makeStyles, usePalette } from '@/hooks/use-theme';
import type { AiMarketAnalysis, AiMarketList, AiStrategyDraft, AiTicker } from '@/lib/aiBlocks';
import { formatMarketPrice } from '@/lib/format';
import { pairName } from '@/lib/marketData';

export const AiTickerCard = memo(function AiTickerCard({ ticker }: { ticker: AiTicker }) {
  const styles = useStyles();
  const { chartUp: UP, chartDown: DOWN } = usePalette();
  const change = Number(ticker.priceChangePercent);
  const up = Number.isFinite(change) ? change >= 0 : true;
  const name = pairName(ticker.symbol);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name} ${ticker.lastPrice}`}
      onPress={() => router.push({ pathname: '/instrument/[symbol]', params: { symbol: ticker.symbol, exchange: ticker.exchange } })}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.flex}>
        <Text style={styles.title} numberOfLines={1}>{name}</Text>
        <Text style={styles.muted}>{ticker.symbol} · {ticker.exchange}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.price}>{ticker.lastPrice}</Text>
        <Text style={{ color: up ? UP : DOWN, fontSize: 12, fontWeight: '700' }}>
          {Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : ticker.priceChangePercent}
        </Text>
      </View>
    </Pressable>
  );
});

export const AiMarketListCard = memo(function AiMarketListCard({ list }: { list: AiMarketList }) {
  const styles = useStyles();
  const { chartUp: UP, chartDown: DOWN } = usePalette();
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{list.title}</Text>
      {list.tickers.slice(0, 8).map(t => (
        <Pressable
          key={t.symbol}
          onPress={() => router.push({ pathname: '/instrument/[symbol]', params: { symbol: t.symbol, exchange: t.exchange } })}
          style={styles.row}>
          <Text style={styles.rowLabel} numberOfLines={1}>{pairName(t.symbol)}</Text>
          <Text style={styles.rowPx}>{t.lastPrice}</Text>
          <Text style={{ color: Number(t.priceChangePercent) >= 0 ? UP : DOWN, fontWeight: '700', fontSize: 12, width: 64, textAlign: 'right' }}>
            {Number(t.priceChangePercent) >= 0 ? '+' : ''}{Number(t.priceChangePercent).toFixed(2)}%
          </Text>
        </Pressable>
      ))}
    </View>
  );
});

export const AiAnalysisCard = memo(function AiAnalysisCard({ analysis }: { analysis: AiMarketAnalysis }) {
  const styles = useStyles();
  const { chartUp: UP, chartDown: DOWN } = usePalette();
  const meta = { exchange: analysis.exchange, symbol: analysis.symbol, pricePrecision: 2 };
  const price = (v?: number) => (v == null ? '—' : formatMarketPrice(v, meta, false));
  const up = (analysis.changePercent ?? 0) >= 0;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/instrument/[symbol]', params: { symbol: analysis.symbol, exchange: analysis.exchange, timeframe: analysis.timeframe } })}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <Text style={styles.title}>{pairName(analysis.symbol)} · {analysis.timeframe}</Text>
      <Text style={styles.muted}>{analysis.trend ? `Trend: ${analysis.trend}` : analysis.exchange}</Text>
      <View style={styles.grid}>
        <Stat label="Last" value={price(analysis.lastClose)} />
        <Stat label="Change" value={analysis.changePercent == null ? '—' : `${up ? '+' : ''}${analysis.changePercent.toFixed(2)}%`} color={up ? UP : DOWN} />
        <Stat label="RSI" value={analysis.rsi14 == null ? '—' : `${analysis.rsi14.toFixed(1)}${analysis.rsiState ? ` (${analysis.rsiState})` : ''}`} />
        <Stat label="S / R" value={`${price(analysis.support)} / ${price(analysis.resistance)}`} />
      </View>
    </Pressable>
  );
});

export const AiStrategyDraftCard = memo(function AiStrategyDraftCard({ draft }: { draft: AiStrategyDraft }) {
  const styles = useStyles();
  return (
    <View style={styles.card} accessibilityRole="summary">
      <Text style={styles.title}>{draft.name ?? 'Strategy draft'}</Text>
      <Text style={styles.muted}>{draft.savedStrategyId ? 'Saved' : 'Ready to save'} · {draft.draftId}</Text>
      {draft.summary.map((line, i) => (
        <Text key={i} style={styles.rule}>• {line}</Text>
      ))}
    </View>
  );
});

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : null]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((_Palette, P) => ({
  card: {
    marginTop: 10, padding: 14, borderRadius: 16, gap: 6,
    backgroundColor: P.card, borderWidth: 1, borderColor: P.border,
  },
  pressed: { opacity: 0.75 },
  flex: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end' },
  title: { color: P.text, fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  muted: { color: P.textMuted, fontSize: 12 },
  price: { color: P.text, fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.border },
  rowLabel: { flex: 1, color: P.text, fontSize: 13, fontWeight: '600' },
  rowPx: { color: P.body, fontSize: 13, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  stat: { width: '46%', flexGrow: 1 },
  statLabel: { color: P.textMuted, fontSize: 11, fontWeight: '600' },
  statValue: { color: P.text, fontSize: 13, fontWeight: '600', marginTop: 2 },
  rule: { color: P.body, fontSize: 13, lineHeight: 18, marginTop: 2 },
}));
