import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';

import { formatMarketPrice, type PriceMetadata } from '@/lib/format';
import { buildWatchlistChart, watchlistLineSegments } from '@/lib/marketHistory';

type Props = {
  chart: NonNullable<ReturnType<typeof buildWatchlistChart>>;
  width: number;
  metadata?: PriceMetadata;
};

export function WatchlistMiniChart({ chart, width, metadata }: Props) {
  const color = chart.positive ? '#0bc66a' : '#dc3574';
  const peakX = chart.peak.x / 160 * width;
  const labelWidth = Math.min(70, width);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false}>
      {watchlistLineSegments(chart.points, width).map((segment, i) => (
        <View key={i} style={[styles.line, {
          left: segment.left, top: segment.top, width: segment.width,
          backgroundColor: color, transform: [{ rotate: `${segment.angle}rad` }],
        }]} />
      ))}
      <View style={[styles.dot, { left: peakX - 3.5, top: chart.peak.y - 3.5, backgroundColor: color }]} />
      <View style={[styles.bubble, {
        width: labelWidth, left: Math.max(0, Math.min(width - labelWidth, peakX - labelWidth / 2)), top: chart.peak.y - 30,
      }]}>
        <Text style={styles.bubbleText} numberOfLines={1} adjustsFontSizeToFit>{formatMarketPrice(chart.peak.value, metadata, false)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { position: 'absolute', height: 1.8, borderRadius: 1 },
  dot: { position: 'absolute', width: 7, height: 7, borderRadius: 4, borderWidth: 1.5, borderColor: '#FFFFFF' },
  bubble: { position: 'absolute', height: 22, justifyContent: 'center', alignItems: 'center', borderRadius: 11,
    paddingHorizontal: 8, backgroundColor: '#16181D' },
  bubbleText: { color: '#FFFFFF', fontSize: 9, fontWeight: '500' },
});
