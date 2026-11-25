import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { Action, Card, Field, Heading, Help, useBacktestStyles } from '@/components/backtesting/BacktestUi';
import { RunTicket } from '@/components/backtesting/RunTicket';
import { bandTone, signedPercent, statusPill, ticketDate, ticketMarket } from '@/lib/runTicket';
import { BACKTEST_TIMEFRAMES, comparisonNotes, defaultBacktestDraft, isActiveBacktest, metricText, prepareBacktest, type BacktestDraft, type BacktestRun } from '@/lib/backtesting';
import { createBacktest, getBacktest, getBacktestStrategy, listBacktests, listBacktestStrategies } from '@/lib/backtestingApi';
import { DEMO_MODE } from '@/lib/demoMode';
import { useAuth } from '@/store/auth';
import { useInsightPalette } from '@/hooks/use-theme';

export default function BacktestsScreen() {
  const S = useBacktestStyles();
  const userId = useAuth(state => state.user?.id);
  const enabled = !!userId && !DEMO_MODE;
  const qc = useQueryClient();
  const [section, setSection] = useState<'history' | 'new'>('history');
  const [strategyId, setStrategyId] = useState('');
  const [draft, setDraft] = useState<BacktestDraft>({ ...defaultBacktestDraft });
  const [formError, setFormError] = useState('');
  const [comparison, setComparison] = useState<string[]>([]);
  const history = useInfiniteQuery({
    queryKey: ['backtests', userId], enabled, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => listBacktests(pageParam, signal),
    getNextPageParam: last => last.nextBefore ?? undefined,
    refetchInterval: query => query.state.data?.pages.some(page => page.backtests.some(run => isActiveBacktest(run.status))) ? 2500 : false,
  });
  const strategies = useInfiniteQuery({
    queryKey: ['backtest-strategies', userId], enabled, initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => listBacktestStrategies(pageParam, signal),
    getNextPageParam: (last, pages) => { const count = pages.reduce((n, p) => n + p.strategies.length, 0); return count < last.total ? count : undefined; },
  });
  const strategy = useQuery({ queryKey: ['backtest-strategy', userId, strategyId], enabled: enabled && !!strategyId,
    queryFn: ({ signal }) => getBacktestStrategy(strategyId, signal) });
  const create = useMutation({
    mutationFn: createBacktest,
    onSuccess: run => { void qc.invalidateQueries({ queryKey: ['backtests', userId] }); router.push({ pathname: '/backtests/[id]', params: { id: run.id } }); },
  });
  const runs = history.data?.pages.flatMap(page => page.backtests) ?? [];
  const saved = strategies.data?.pages.flatMap(page => page.strategies).filter(item => item.status === 'ACTIVE') ?? [];
  const update = <K extends keyof BacktestDraft>(key: K, value: BacktestDraft[K]) => { setDraft(old => ({ ...old, [key]: value })); setFormError(''); create.reset(); };
  const submit = () => {
    if (!strategy.data || create.isPending) return;
    try { const input = prepareBacktest(draft, strategy.data); setFormError(''); create.mutate(input); }
    catch (error) { setFormError(error instanceof Error ? error.message : 'Check the run settings.'); }
  };
  const toggleComparison = (id: string) => setComparison(old => old.includes(id) ? old.filter(value => value !== id) : old.length < 3 ? [...old, id] : old);

  return <KeyboardAvoidingView style={S.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={S.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={history.isRefetching && !history.isFetchingNextPage} onRefresh={() => { void history.refetch(); void strategies.refetch(); }} />}>
      <Heading>Test an idea against history</Heading>
      <Help>Run saved strategies, inspect their trades, and compare results with the assumptions in view.</Help>
      <Action secondary title="Research datasets and walk-forward tests" onPress={() => router.push('/backtests/research')} />
      {DEMO_MODE ? <Card><Heading>Connect to run a backtest</Heading><Help>The demo does not simulate saved engine runs. Backtesting becomes available with a signed-in account connected to the backend.</Help></Card> : null}
      <View style={S.wrap}>{(['history', 'new'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: section === value }}
        onPress={() => setSection(value)} style={[S.chip, section === value && S.selected]}><Text>{value === 'history' ? 'Run history' : 'New backtest'}</Text></Pressable>)}</View>

      {section === 'new' && !DEMO_MODE ? <>
        <Card><Heading>1. Choose a saved strategy</Heading>
          {strategies.isPending ? <ActivityIndicator /> : null}
          {strategies.isError ? <ErrorBanner message={strategies.error.message} onRetry={() => void strategies.refetch()} /> : null}
          {!strategies.isPending && !strategies.isError && !saved.length ? <><Help>Save a strategy from an AI conversation, then return here to choose its dates and settings.</Help><Action secondary title="Open AI assistant" onPress={() => router.push({ pathname: '/(tabs)/ai', params: { from: 'backtests' } })} /></> : null}
          {saved.map(item => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected: strategyId === item.id }}
            onPress={() => { setStrategyId(item.id); setFormError(''); create.reset(); }} style={[S.chip, strategyId === item.id && S.selected]}>
            <Text style={{ fontWeight: '600' }}>{item.name}</Text><Help>Version {item.latestVersion}{item.description ? ` · ${item.description}` : ''}</Help>
          </Pressable>)}
          {strategies.hasNextPage ? <Action secondary title="Load more strategies" pending={strategies.isFetchingNextPage} onPress={() => void strategies.fetchNextPage()} /> : null}
          {strategy.isFetching && strategyId ? <ActivityIndicator /> : null}
          {strategy.isError ? <ErrorBanner message={strategy.error.message} onRetry={() => void strategy.refetch()} /> : null}
          {strategy.data ? <Help>{strategy.data.definition.market.exchange} · {strategy.data.definition.market.symbol} · {strategy.data.definition.direction} · version {strategy.data.latestVersion}</Help> : null}
        </Card>
        <Card><Heading>2. Historical period</Heading>
          <Help>Dates use midnight UTC. For intraday ranges, enter an ISO timestamp with Z or a timezone offset. The end is exclusive. Leave both blank for the latest 1,000 closed candles.</Help>
          <Field label="Start · date or ISO timestamp" value={draft.start} placeholder="YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss+05:30" onChangeText={value => update('start', value)} />
          <Field label="End · exclusive date or ISO timestamp" value={draft.end} placeholder="Optional · latest closed candle" onChangeText={value => update('end', value)} />
          <Text style={S.label}>Timeframe</Text><View style={S.wrap}>{['', ...BACKTEST_TIMEFRAMES].map(value => <Pressable key={value} accessibilityRole="radio"
            accessibilityState={{ selected: draft.timeframe === value }} onPress={() => update('timeframe', value)} style={[S.chip, draft.timeframe === value && S.selected]}>
            <Text>{value || `Strategy default${strategy.data ? ` (${strategy.data.definition.market.timeframe})` : ''}`}</Text></Pressable>)}</View>
        </Card>
        <Card><Heading>3. Capital and execution</Heading>
          <Help>Amounts use the instrument’s quote currency. Commission is a percentage of traded value on each side.</Help>
          <Field label="Initial capital" keyboardType="decimal-pad" value={draft.initialCapital} onChangeText={value => update('initialCapital', value)} />
          <Field label="Commission per side · %" keyboardType="decimal-pad" value={draft.commissionPercent} onChangeText={value => update('commissionPercent', value)} />
          <Field label="Slippage · ticks" keyboardType="number-pad" value={draft.slippageTicks} onChangeText={value => update('slippageTicks', value)} />
          <Field label="Spread assumption · ticks, optional" keyboardType="number-pad" value={draft.spreadTicks ?? ''} placeholder="No additional spread" onChangeText={value => update('spreadTicks', value)} />
          <Field label="Maximum candle volume participation · %, optional" keyboardType="decimal-pad" value={draft.maxVolumeParticipationPercent ?? ''} placeholder="No volume cap" onChangeText={value => update('maxVolumeParticipationPercent', value)} />
          <Help>Spread and participation are scenario assumptions. They do not reconstruct historical quotes or queue position.</Help>
          <Field label="Equity observations per year · optional" keyboardType="decimal-pad" value={draft.periodsPerYear ?? ''} placeholder="Leave blank to omit annualized statistics" onChangeText={value => update('periodsPerYear', value)} />
          <Field label="Annual risk-free rate · %, optional" keyboardType="decimal-pad" value={draft.annualRiskFreeRatePercent ?? ''} placeholder="0" onChangeText={value => update('annualRiskFreeRatePercent', value)} />
          <Help>Annualization needs regular trading periods. Supply a sampling frequency matching the selected timeframe and market calendar.</Help>
          <Text style={S.label}>Position sizing</Text><View style={S.wrap}>{([{ type: 'percent_of_equity', label: '% of equity' }, { type: 'cash', label: 'Cash amount' }, { type: 'fixed_quantity', label: 'Quantity' }] as const).map(item => <Pressable key={item.type} accessibilityRole="radio"
            accessibilityState={{ selected: draft.sizingType === item.type }} onPress={() => update('sizingType', item.type)} style={[S.chip, draft.sizingType === item.type && S.selected]}><Text>{item.label}</Text></Pressable>)}</View>
          <Field label={draft.sizingType === 'percent_of_equity' ? 'Position size · % of equity' : draft.sizingType === 'cash' ? 'Position size · quote currency' : 'Position size · units'}
            keyboardType="decimal-pad" value={draft.sizingValue} onChangeText={value => update('sizingValue', value)} />
          {formError || create.isError ? <Text accessibilityRole="alert" style={S.error}>{formError || create.error?.message}</Text> : null}
          <Action title={create.isPending ? 'Queuing backtest…' : 'Run backtest'} pending={create.isPending} disabled={!strategy.data || strategy.isFetching} onPress={submit} />
        </Card>
      </> : null}

      {section === 'history' && !DEMO_MODE ? <>
        {history.isPending ? <ActivityIndicator /> : null}
        {history.isError ? <ErrorBanner message={history.error.message} onRetry={() => void history.refetch()} /> : null}
        {!history.isPending && !history.isError && !runs.length ? <Card><Heading>No runs yet</Heading><Help>Choose a saved strategy to create your first backtest.</Help><Action title="Create a backtest" onPress={() => setSection('new')} /></Card> : null}
        {runs.length ? <Help>Select up to three completed runs to compare their results.</Help> : null}
        <View style={{ gap: 18 }}>{runs.map(run => <BacktestTicket key={run.id} run={run} comparing={comparison.includes(run.id)}
          canCompare={comparison.includes(run.id) || comparison.length < 3} onToggleCompare={() => toggleComparison(run.id)} />)}</View>
        {history.hasNextPage ? <Action secondary title="Load older runs" pending={history.isFetchingNextPage} onPress={() => void history.fetchNextPage()} /> : null}
        {comparison.length ? <Comparison ids={comparison} userId={userId} onClear={() => setComparison([])} /> : null}
      </> : null}
    </ScrollView>
  </KeyboardAvoidingView>;
}

/** One saved run as a ticket card (see components/backtesting/RunTicket). */
function BacktestTicket({ run, comparing, canCompare, onToggleCompare }: { run: BacktestRun; comparing: boolean; canCompare: boolean; onToggleCompare: () => void }) {
  const S = useBacktestStyles();
  const name = run.strategy.name ?? 'Backtest';
  const open = () => router.push({ pathname: '/backtests/[id]', params: { id: run.id } });
  const result = run.status === 'COMPLETED' ? signedPercent(run.summary?.totalReturnPercent) : null;
  const returnValue = Number(run.summary?.totalReturnPercent);
  const trades = run.summary?.totalTrades;
  const period = run.range ? `Tested ${ticketDate(run.range.start)} – ${ticketDate(run.range.end)}` : '';
  const caption = result
    ? [`Return · ${metricText(trades, '', 0)} trades · max drawdown ${metricText(run.summary?.maxDrawdownPercent, '%')}`, period].filter(Boolean).join('\n')
    : period;
  return <RunTicket
    band={bandTone(run.status, run.status === 'COMPLETED' ? run.summary?.totalReturnPercent : undefined)}
    headerLeft={ticketMarket(run.market)} headerRight={ticketDate(run.createdAt)}
    eyebrow={[run.market.exchange, run.strategy.version ? `Strategy v${run.strategy.version}` : null].filter(Boolean).join(' · ')}
    title={name} status={statusPill(run.status)}
    value={result} valueTone={result ? (returnValue >= 0 ? 'gain' : 'loss') : undefined} caption={caption}
    busy={isActiveBacktest(run.status)}
    note={run.error ? <Text style={S.error}>{run.error.message}</Text>
      : isActiveBacktest(run.status) ? <Help>Results appear here when the run finishes.</Help>
      : run.status === 'CANCELLED' ? <Help>Cancelled before it finished.</Help> : null}
    onPress={open} accessibilityLabel={`Open ${name} results`}
    actions={[
      ...(run.status === 'COMPLETED' ? [{ label: comparing ? '✓ Comparing' : 'Compare', variant: comparing ? 'solid' as const : 'outline' as const,
        checked: comparing, disabled: !canCompare, accessibilityLabel: `Compare ${name}`, onPress: onToggleCompare }] : []),
      { label: 'View results', onPress: open, accessibilityLabel: `View ${name} results` },
    ]} />;
}

function Comparison({ ids, userId, onClear }: { ids: string[]; userId?: string; onClear: () => void }) {
  const S = useBacktestStyles();
  const P = useInsightPalette();
  const results = useQueries({ queries: ids.map(id => ({ queryKey: ['backtest', userId, id], queryFn: ({ signal }: { signal: AbortSignal }) => getBacktest(id, signal) })) });
  const runs = results.flatMap(result => result.data ? [result.data] : []);
  const fields: { label: string; value: (run: BacktestRun) => string }[] = [
    { label: 'Return', value: r => metricText(r.summary?.totalReturnPercent, '%') },
    { label: 'Drawdown at close', value: r => metricText(r.summary?.maxDrawdownPercent, '%') },
    { label: 'Win rate', value: r => metricText(r.summary?.winRatePercent, '%') },
    { label: 'Profit factor', value: r => metricText(r.summary?.profitFactor) },
    { label: 'Trades', value: r => metricText(r.summary?.totalTrades, '', 0) },
    { label: 'Initial capital', value: r => `${metricText(r.settings?.initialCapital)} ${r.symbol?.quoteAsset ?? ''}` },
    { label: 'Net profit', value: r => `${metricText(r.summary?.netProfit)} ${r.symbol?.quoteAsset ?? ''}` },
    { label: 'Fees', value: r => `${metricText(r.summary?.totalCommission)} ${r.symbol?.quoteAsset ?? ''}` },
  ];
  return <Card><Heading>Compare runs</Heading>
    {ids.length < 2 ? <Help>Select another completed run to compare.</Help> : null}
    {results.some(r => r.isPending) ? <ActivityIndicator /> : null}
    {results.some(r => r.isError) ? <Help>Some results could not load. Open those runs to retry.</Help> : null}
    {comparisonNotes(runs).map(note => <Help key={note}>{note}</Help>)}
    <ScrollView horizontal><View><View style={S.row}><Text style={{ width: 120 }}>Measure</Text>{runs.map(run => <View key={run.id} style={{ width: 150 }}><Text style={{ fontWeight: '600' }}>{run.strategy.name}</Text><Help>{run.market.symbol} · {run.market.timeframe}</Help><Help>{new Date(run.range.start).toISOString().slice(0, 10)} → {new Date(run.range.end).toISOString().slice(0, 10)}</Help></View>)}</View>
      {fields.map(field => <View key={field.label} style={[S.row, { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: P.border }]}><Text style={{ width: 120 }}>{field.label}</Text>{runs.map(run => <Text key={run.id} style={{ width: 150 }}>{field.value(run)}</Text>)}</View>)}
    </View></ScrollView><Action secondary title="Clear comparison" onPress={onClear} />
  </Card>;
}
