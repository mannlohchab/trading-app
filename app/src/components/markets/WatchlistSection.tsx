import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';

import { WatchlistRow } from '@/components/markets/WatchlistRow';
import type { QuoteLike } from '@/components/markets/InstrumentRow';
import { GlassIcon, GlassPressable } from '@/components/ui/GlassIcon';
import { Palette } from '@/constants/theme';

type Props = {
  title: string;
  quotes: QuoteLike[];
  expanded: boolean;
  onToggle: () => void;
  delayed?: boolean;
  onRemove?: (symbol: string) => void;
};

export function WatchlistSection({ title, quotes, expanded, onToggle, delayed, onRemove }: Props) {
  return (
    <View>
      <GlassPressable onPress={onToggle} style={styles.header} accessibilityRole="button" accessibilityState={{ expanded }}>
        <Text style={styles.title}>{title}</Text>
        <GlassIcon name="down" size={20} rotation={expanded ? 0 : -90} />
      </GlassPressable>
      {expanded
        ? quotes.map((q) => (
            <WatchlistRow
              key={`${q.exchange}-${q.symbol}`}
              quote={q}
              delayed={delayed || q.stale}
              onLongPress={onRemove ? () => onRemove(`${q.exchange}:${q.symbol}`) : undefined}
            />
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  title: { color: Palette.text, fontSize: 20, fontWeight: '700' },
});
