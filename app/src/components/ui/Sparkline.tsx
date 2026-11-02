import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';

import { Palette } from '@/constants/theme';
import { buildSparkline } from '@/lib/sparkline';

type Props = {
  data?: number[];
  times?: number[];
  label?: string;
  width?: number;
  height?: number;
  positive?: boolean;
  color?: string;
};

export function Sparkline({ data = [], times, label = 'Recent price history', width = 64, height = 36, positive = true, color }: Props) {
  const chart = buildSparkline(data, width, height, times);
  const stroke = color ?? (positive ? Palette.green : Palette.red);
  return (
    <View style={{ width, height, flexShrink: 0 }} pointerEvents="none" accessible
      accessibilityRole="image" accessibilityLabel={chart ? label : 'Price history unavailable'}>
      {chart ? <>
        <View style={[styles.baseline, { top: chart.baseline }]} />
        {chart.segments.map((segment, i) => <View key={i} style={[styles.line, {
          left: segment.left, top: segment.top, width: segment.width,
          backgroundColor: stroke, transform: [{ rotate: `${segment.angle}rad` }],
        }]} />)}
        <View style={[styles.dot, { left: chart.last.x - 2.5, top: chart.last.y - 2.5, backgroundColor: stroke }]} />
      </> : <Text style={styles.empty}>—</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  baseline: { position: 'absolute', left: 3, right: 3, borderTopWidth: 1, borderColor: '#E5E7EE', borderStyle: 'dashed' },
  line: { position: 'absolute', height: 1.8, borderRadius: 1 },
  dot: { position: 'absolute', width: 5, height: 5, borderRadius: 3 },
  empty: { color: Palette.textMuted, textAlign: 'center', lineHeight: 36 },
});
