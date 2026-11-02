import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';

import { SymbolIcon } from '@/components/markets/SymbolIcon';
import { Palette } from '@/constants/theme';
import { formatPct, formatMarketPrice } from '@/lib/format';
import type { QuoteLike } from '@/components/markets/InstrumentRow';

type Props = {
  quote: QuoteLike;
  delayed?: boolean;
  onLongPress?: () => void;
};

export function WatchlistRow({ quote, delayed, onLongPress }: Props) {
  const up = quote.changePercent >= 0;
  const color = up ? Palette.green : Palette.red;
  const href = {
    pathname: '/instrument/[symbol]' as const,
    params: { symbol: quote.symbol, exchange: quote.exchange, name: quote.name },
  };

  return (
    <Link href={href} asChild>
      <Pressable
        onLongPress={onLongPress}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: Palette.cardHover }]}>
        <SymbolIcon symbol={quote.symbol} exchange={quote.exchange} size={40} />
        <View style={styles.mid}>
          <View style={styles.symbolRow}>
            <Text style={styles.symbol}>{quote.symbol}</Text>
            {delayed ? (
              <View style={styles.delayed}>
                <Text style={styles.delayedText}>D</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.right}>
          <Text style={styles.price}>
            {formatMarketPrice(quote.ltp, quote)}
          </Text>
          <Text style={[styles.change, { color }]}>
            {up ? '+' : ''}
            {formatMarketPrice(quote.change, quote, false)} ({formatPct(quote.changePercent)})
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  mid: { flex: 1 },
  symbolRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  symbol: { color: Palette.text, fontSize: 16, fontWeight: '600' },
  delayed: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Palette.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  delayedText: { color: '#000', fontSize: 10, fontWeight: '900' },
  right: { alignItems: 'flex-end' },
  price: {
    color: Palette.text,
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  change: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
});
