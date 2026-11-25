import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect, type Href } from 'expo-router';
import { memo, useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { Action, Help, Metric } from '@/components/backtesting/BacktestUi';
import { InsightPalette as P } from '@/constants/theme';
import { researchMetricPreview, researchRunLink, shouldPollResearchRun, type AiResearchRun } from '@/lib/aiResearchRun';
import { refreshResearchRun } from '@/lib/aiResearchRunApi';
import { DEMO_MODE } from '@/lib/demoMode';
import { useAuth } from '@/store/auth';

/** References persisted jobs, so a card stays useful after a queued chat response finishes. */
export const AiResearchRunCard = memo(function AiResearchRunCard({ run }: { run: AiResearchRun }) {
  const userId = useAuth(state => state.user?.id);
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const current = useQuery({
    queryKey: ['ai-research-run', userId, run.kind, run.id], enabled: !!userId && !DEMO_MODE && focused,
    queryFn: ({ signal }) => refreshResearchRun(run, signal), retry: 1,
    refetchInterval: query => query.state.status !== 'error' && shouldPollResearchRun(run.kind, query.state.data?.status ?? run.status, query.state.data?.summary?.closeStatus ?? run.summary?.closeStatus) ? (run.kind === 'paper' ? 5000 : 2000) : false,
  });
  const data = current.data ?? run, metrics = researchMetricPreview(data.summary);
  const active = shouldPollResearchRun(data.kind, data.status, data.summary?.closeStatus);
  const market = [data.market?.exchange, data.market?.symbol, data.market?.timeframe].filter(Boolean).join(' · ');
  return <View style={styles.card} accessibilityRole="summary" accessibilityLabel={`${data.title}, ${data.status.toLowerCase()}`}>
    <View style={styles.row}><Text style={styles.category}>{data.kind === 'paper' ? 'LIVE PAPER TEST' : data.kind === 'experiment' ? 'RESEARCH EXPERIMENT' : 'SAVED BACKTEST'}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.status}>{data.status === 'PENDING' ? 'Queued' : data.status.toLowerCase()}</Text></View>
    <Text style={styles.title}>{data.title}</Text>
    {market ? <Help>{market}</Help> : null}
    {data.range ? <Help>{new Date(data.range.start).toLocaleString()} → {new Date(data.range.end).toLocaleString()} (end exclusive)</Help> : null}
    {metrics.length ? <View style={styles.metrics}>{metrics.map(metric => <Metric key={metric.key} label={metric.label} value={metric.value} suffix={metric.suffix} />)}</View> : null}
    {data.message ? <Help>{data.message}</Help> : null}
    {data.kind === 'paper' ? <Help>Virtual funds · live market data. Performance accumulates after the strategy starts.</Help>
      : <Help>{active ? 'This card updates as the saved run progresses.' : 'Historical simulation. Review costs, data coverage and execution assumptions in the full result.'}</Help>}
    {current.isPending && !DEMO_MODE ? <ActivityIndicator size="small" /> : null}
    {current.isError ? <><Text accessibilityRole="alert" style={styles.error}>Could not refresh this run. Showing its last known state. {current.error.message}</Text>
      <Action secondary title="Retry status" onPress={() => void current.refetch()} pending={current.isFetching} /></> : null}
    <Action secondary title={data.kind === 'paper' ? 'Open live test and controls' : 'Open results'} onPress={() => router.push(researchRunLink(data) as Href)} />
  </View>;
});

const styles = StyleSheet.create({
  card: { marginTop: 10, padding: 16, borderRadius: 16, backgroundColor: P.card, borderWidth: 1, borderColor: P.border, gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  category: { color: P.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: P.text, fontSize: 16, fontWeight: '600' },
  status: { color: P.textSecondary, fontSize: 12, textTransform: 'capitalize' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  error: { color: '#DC2626', fontSize: 12, lineHeight: 18 },
});
