import { useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/AppText';
import { InsightPalette as P } from '@/constants/theme';
import { equitySegments, metricText, type BacktestStatus, type EquityPoint, type RiskStatistics } from '@/lib/backtesting';

export const UP = '#089981', DOWN = '#DC2626';
export function Card({ children }: { children: ReactNode }) { return <View style={backtestStyles.card}>{children}</View>; }
export function Heading({ children }: { children: ReactNode }) { return <Text accessibilityRole="header" style={backtestStyles.title}>{children}</Text>; }
export function Help({ children }: { children: ReactNode }) { return <Text style={backtestStyles.help}>{children}</Text>; }
export function Action({ title, onPress, disabled, pending, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; pending?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: disabled || pending, busy: pending }}
    disabled={disabled || pending} onPress={onPress} style={({ pressed }) => [backtestStyles.button, secondary && backtestStyles.secondary, (disabled || pending) && backtestStyles.disabled, pressed && { opacity: 0.75 }]}>
    {pending ? <ActivityIndicator size="small" color={secondary ? P.text : P.onSolid} /> : null}
    <Text style={[backtestStyles.buttonLabel, secondary && { color: P.text }]}>{title}</Text>
  </Pressable>;
}
export function Field({ label, ...props }: ComponentProps<typeof TextInput> & { label: string }) {
  return <View style={backtestStyles.field}><Text style={backtestStyles.label}>{label}</Text><TextInput {...props} accessibilityLabel={label}
    autoCorrect={false} autoCapitalize="none" placeholderTextColor={P.textMuted} style={backtestStyles.input} /></View>;
}
export function Status({ status }: { status: BacktestStatus }) {
  const text = { PENDING: 'Queued', RUNNING: 'Running', COMPLETED: 'Completed', FAILED: 'Failed', CANCELLED: 'Cancelled' }[status];
  return <Text accessibilityLiveRegion="polite" style={[backtestStyles.status, { color: status === 'FAILED' ? DOWN : status === 'COMPLETED' ? UP : P.textSecondary }]}>{text}</Text>;
}
export function Metric({ label, value, suffix = '', tone = false }: { label: string; value: string | number | null | undefined; suffix?: string; tone?: boolean }) {
  return <View style={backtestStyles.metric}><Text style={backtestStyles.label}>{label}</Text><Text style={[backtestStyles.metricValue, tone && value != null && { color: Number(value) >= 0 ? UP : DOWN }]}>{metricText(value, suffix)}</Text></View>;
}
export function RiskStatisticsView({ statistics }: { statistics: RiskStatistics }) {
  return <View style={{ gap: 10 }}><Heading>Risk statistics</Heading><View style={backtestStyles.wrap}>
    <Metric label="Sharpe ratio" value={statistics.sharpe} /><Metric label="Sortino ratio" value={statistics.sortino} />
    <Metric label="Annualized growth" value={statistics.cagrPercent} suffix="%" /><Metric label="Annualized volatility" value={statistics.annualizedVolatilityPercent} suffix="%" />
  </View><Help>{statistics.observations} equity observations</Help>
    {statistics.reason ? <Help>{statistics.reason}</Help> : null}
    {statistics.assumptions ? <><Help>{statistics.assumptions.periodsPerYear} observations per year · annual risk-free rate {metricText(statistics.assumptions.annualRiskFreeRate * 100, '%')}</Help>
      <Help>{statistics.assumptions.sampling}</Help><Help>{statistics.assumptions.cagr}</Help></> : null}
  </View>;
}
export function EquityChart({ points, currency }: { points: EquityPoint[]; currency?: string }) {
  const [width, setWidth] = useState(0);
  const segments = useMemo(() => equitySegments(points, width), [points, width]);
  if (points.length < 2) return <Help>Equity history will appear after the run completes.</Help>;
  const first = points[0]!, last = points.at(-1)!;
  const color = Number(last.equity) >= Number(first.equity) ? UP : DOWN;
  return <View style={{ gap: 8 }}><View accessibilityRole="image" accessibilityLabel={`Equity from ${first.equity} to ${last.equity} ${currency ?? ''}`}
    style={backtestStyles.chart} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    {segments.map((segment, i) => <View key={i} style={{ position: 'absolute', height: 2, backgroundColor: color, left: segment.left, top: segment.top,
      width: segment.width, transform: [{ rotate: `${segment.angle}rad` }] }} />)}
  </View><View style={backtestStyles.row}><Help>{new Date(first.time).toISOString().slice(0, 10)}</Help><Help>{new Date(last.time).toISOString().slice(0, 10)}</Help></View></View>;
}

export const backtestStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: P.bg },
  content: { padding: 20, paddingBottom: 44, gap: 16, width: '100%', maxWidth: 900, alignSelf: 'center' },
  card: { backgroundColor: P.card, padding: 18, borderRadius: 18, borderWidth: 1, borderColor: P.border, gap: 12 },
  title: { fontSize: 20, fontWeight: '600', color: P.text },
  help: { fontSize: 13, lineHeight: 19, color: P.textSecondary },
  label: { fontSize: 12, color: P.textSecondary, lineHeight: 17 },
  field: { gap: 6, flexGrow: 1 },
  input: { minHeight: 48, borderWidth: 1, borderColor: P.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: P.text, backgroundColor: P.bg },
  button: { minHeight: 46, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, backgroundColor: P.text, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondary: { backgroundColor: P.soft },
  buttonLabel: { color: P.onSolid, fontWeight: '600', fontSize: 14 },
  disabled: { opacity: 0.45 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: P.border, borderRadius: 10, backgroundColor: P.card },
  selected: { backgroundColor: P.soft, borderColor: P.text },
  status: { fontSize: 12, fontWeight: '600' },
  metric: { flexGrow: 1, minWidth: 110, width: '30%', paddingVertical: 5, gap: 4 },
  metricValue: { color: P.text, fontSize: 19, fontWeight: '600' },
  chart: { height: 140, backgroundColor: P.bg, borderRadius: 10, overflow: 'hidden' },
  divider: { height: 1, backgroundColor: P.border },
  error: { color: DOWN, fontSize: 13, lineHeight: 20 },
});
