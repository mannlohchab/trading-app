import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';

import { Palette } from '@/constants/theme';
import { formatPct } from '@/lib/format';

type Props = {
  change: number;
  changePercent: number;
  compact?: boolean;
};

export function PriceChange({ change, changePercent, compact }: Props) {
  const positive = changePercent >= 0;
  const color = positive ? Palette.green : Palette.red;
  return (
    <View style={styles.wrap}>
      {!compact && (
        <Text style={[styles.text, { color }]}>
          {positive ? '+' : ''}
          {change.toFixed(2)}
        </Text>
      )}
      <Text style={[styles.text, { color }]}>{formatPct(changePercent)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-end', gap: 2 },
  text: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
