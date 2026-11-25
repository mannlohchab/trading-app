import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect, type Href } from 'expo-router';
import { memo, useCallback, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { Help } from '@/components/backtesting/BacktestUi';
import { makeStyles } from '@/hooks/use-theme';
import { RunTicket } from '@/components/backtesting/RunTicket';
import { metricText } from '@/lib/backtesting';
import { bandTone, signedPercent, statusPill, ticketDate, ticketMarket } from '@/lib/runTicket';
import { researchMetricPreview, researchRunLink, shouldPollResearchRun, type AiResearchRun } from '@/lib/aiResearchRun';
import { refreshResearchRun } from '@/lib/aiResearchRunApi';
import { DEMO_MODE } from '@/lib/demoMode';
import { useAuth } from '@/store/auth';

/** References persisted jobs, so a card stays useful after a queued chat response finishes. */
export const AiResearchRunCard = memo(function AiResearchRunCard({ run }: { run: AiResearchRun }) {
  const styles = useStyles();
  const userId = useAuth(state => state.user?.id);
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const current = useQuery({
    queryKey: ['ai-research-run', userId, run.kind, run.id], enabled: !!userId && !DEMO_MODE && focused,
    queryFn: ({ signal }) => refreshResearchRun(run, signal), retry: 1,
    refetchInterval: query => query.state.status !== 'error' && shouldPollResearchRun(run.kind, query.state.data?.status ?? run.status, query.state.data?.summary?.closeStatus ?? run.summary?.closeStatus) ? (run.kind === 'paper' ? 5000 : 2000) : false,
  });
  const data = current.data ?? run;
  const active = shouldPollResearchRun(data.kind, data.status, data.summary?.closeStatus);
  const result = signedPercent(data.summary?.totalReturnPercent);
  const details = researchMetricPreview(data.summary).filter(m => m.key !== 'totalReturnPercent').slice(0, 2)
    .map(m => `${m.label} ${metricText(m.value, m.suffix, m.key === 'totalTrades' || m.key === 'testWindows' || m.key === 'recentSignals' ? 0 : 2)}`);
  const caption = [result ? ['Return', ...details].join(' · ') : details.join(' · '),
    data.range ? `${ticketDate(data.range.start)} – ${ticketDate(data.range.end)}` : null].filter(Boolean).join('\n');
  const kindLabel = data.kind === 'paper' ? 'Live paper test' : data.kind === 'experiment' ? 'Research experiment' : 'Saved backtest';
  const open = () => router.push(researchRunLink(data) as Href);
  return <View style={styles.wrap}>
    <RunTicket
      band={bandTone(data.status, data.summary?.totalReturnPercent)}
      headerLeft={ticketMarket(data.market)} headerRight={data.range ? ticketDate(data.range.end) : undefined}
      eyebrow={[kindLabel, data.market?.exchange].filter(Boolean).join(' · ')}
      title={data.title} status={statusPill(data.status, data.kind)}
      value={result} valueTone={result ? (Number(data.summary?.totalReturnPercent) >= 0 ? 'gain' : 'loss') : undefined}
      caption={caption || undefined}
      busy={active && !result}
      note={<>
        {data.message ? <Help>{data.message}</Help> : null}
        {data.kind === 'paper' ? <Help>Virtual funds · live market data.</Help>
          : active ? <Help>Updates here as the run progresses.</Help> : null}
        {current.isError ? <Text accessibilityRole="alert" style={styles.error}>Could not refresh this run. Showing its last known state.</Text> : null}
      </>}
      onPress={open} accessibilityLabel={`${data.title}, ${data.status.toLowerCase()}`}
      actions={[
        ...(current.isError ? [{ label: 'Retry', variant: 'outline' as const, pending: current.isFetching, onPress: () => void current.refetch() }] : []),
        { label: data.kind === 'paper' ? 'Open live test' : 'View results', onPress: open },
      ]} />
  </View>;
});

const useStyles = makeStyles((_Palette, InsightPalette) => ({
  wrap: { marginTop: 12 },
  error: { color: InsightPalette.red, fontSize: 12, lineHeight: 18 },
}));
