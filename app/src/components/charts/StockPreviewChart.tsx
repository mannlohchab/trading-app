import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatMarketPrice, type PriceMetadata } from '@/lib/format';
import { buildPreviewChart, nearestChartPoint, previewLineSegments } from '@/lib/stockPreview';

type Chart = NonNullable<ReturnType<typeof buildPreviewChart>>;
const CHART_HEIGHT = 210;

export function StockPreviewChart({ chart, metadata }: { chart: Chart; metadata?: PriceMetadata }) {
  const [width, setWidth] = useState(280);
  const [selectedTime, setSelectedTime] = useState<number>();
  const selected = chart.points.find(p => p.time === selectedTime) ?? chart.points[chart.points.length - 1];
  const segments = useMemo(() => previewLineSegments(chart.points, width, CHART_HEIGHT), [chart, width]);
  function selectAt(x: number) {
    setSelectedTime(nearestChartPoint(chart.points, x / Math.max(width, 1) * 100).time);
  }
  const tickTime = new Date(selected.time * 1000).toLocaleString('en-US', {
    timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  function axisLabel(time: number) {
    return new Date(time * 1000).toLocaleString('en-US', chart.end - chart.start < 86_400
      ? { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false }
      : { timeZone: 'UTC', day: 'numeric', month: 'short' });
  }
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Price history</Text>
      <View style={styles.chart}>
        <View style={styles.axis}>
          {[1, 0.66, 0.33, 0].map(fraction => <Text key={fraction} style={styles.axisText}>{formatMarketPrice(chart.min + (chart.max - chart.min) * fraction, metadata, false)}</Text>)}
        </View>
        <View
          style={styles.plot}
          onLayout={event => setWidth(event.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={event => selectAt(event.nativeEvent.locationX)}
          onResponderMove={event => selectAt(event.nativeEvent.locationX)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`Historical closing price ${formatMarketPrice(selected.value, metadata)}, ${tickTime} UTC`}
          accessibilityHint="Drag to inspect prices, or swipe up and down to select the next and previous observation."
          accessibilityActions={[{ name: 'increment', label: 'Next price' }, { name: 'decrement', label: 'Previous price' }]}
          onAccessibilityAction={event => {
            const offset = event.nativeEvent.actionName === 'increment' ? 1 : -1;
            const index = chart.points.indexOf(selected);
            setSelectedTime(chart.points[Math.max(0, Math.min(chart.points.length - 1, index + offset))].time);
          }}>
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {[0, 33, 66, 100].map(top => <View key={top} style={[styles.grid, { top: `${top}%` }]} />)}
            {segments.map((segment, i) => <View key={i} style={[styles.line, {
              left: segment.left, top: segment.top, width: segment.width, transform: [{ rotate: `${segment.angle}rad` }],
            }]} />)}
            <View style={[styles.cursor, { left: `${selected.x}%`, top: `${selected.y}%` }]} />
            <View style={[styles.dot, { left: `${selected.x}%`, top: `${selected.y}%` }]} />
            <View style={[styles.bubble, { left: Math.max(0, Math.min(width - 92, selected.x / 100 * width - 46)), top: Math.max(-24, selected.y / 100 * CHART_HEIGHT - 37) }]}>
              <Text style={styles.bubbleText} numberOfLines={1} adjustsFontSizeToFit>{formatMarketPrice(selected.value, metadata)}</Text>
            </View>
          </View>
        </View>
      </View>
      <View style={styles.timeAxis}>
        {[chart.start, chart.points[Math.floor(chart.points.length / 2)].time, chart.end].map((time, i) => <Text key={i} style={styles.axisText}>{axisLabel(time)}</Text>)}
      </View>
      <Text style={styles.selected}>{tickTime} UTC · Close {formatMarketPrice(selected.value, metadata)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 18, padding: 14, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ECE8F5' },
  heading: { fontSize: 16, fontWeight: '600', color: '#514363' },
  chart: { flexDirection: 'row', height: CHART_HEIGHT, marginTop: 34, marginBottom: 14 },
  axis: { width: 68, justifyContent: 'space-between', paddingRight: 8, marginTop: -5, marginBottom: -5 },
  axisText: { color: '#616375', fontSize: 12, fontVariant: ['tabular-nums'] },
  plot: { flex: 1, marginRight: 5, backgroundColor: '#FCFAFF' },
  line: { position: 'absolute', height: 2, borderRadius: 1, backgroundColor: '#8370ED' },
  timeAxis: { flexDirection: 'row', justifyContent: 'space-between', marginLeft: 68, marginRight: 5, marginBottom: 16 },
  grid: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#ececf4' },
  cursor: { position: 'absolute', bottom: 0, width: 1, backgroundColor: '#bdb3ef' },
  dot: { position: 'absolute', width: 9, height: 9, borderRadius: 5, marginLeft: -4.5, marginTop: -4.5, backgroundColor: '#8270ee', borderWidth: 2, borderColor: '#fff' },
  bubble: { position: 'absolute', width: 92, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 16, backgroundColor: '#17171e', boxShadow: '0 3px 7px rgba(20,20,30,0.15)' },
  bubbleText: { color: '#fff', textAlign: 'center', fontSize: 12, fontWeight: '600' },
  selected: { color: '#727384', fontSize: 12, textAlign: 'right', marginRight: 5 },
});
