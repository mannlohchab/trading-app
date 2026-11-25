import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { Action, Card, Heading, Help, Metric, backtestStyles as S } from '@/components/backtesting/BacktestUi';
import { isRunId, liveTerminationDescription, shouldPollResearchRun } from '@/lib/aiResearchRun';
import { controlLiveTest, getLiveTest, getLiveTestPortfolio } from '@/lib/liveTestingApi';
import { closePosition } from '@/lib/paperTrading';
import { DEMO_MODE } from '@/lib/demoMode';
import { useAuth } from '@/store/auth';

export default function LiveTestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useAuth(state => state.user?.id), qc = useQueryClient();
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const enabled = !!userId && !DEMO_MODE && focused && isRunId(id);
  const key = ['live-test', userId, id];
  const test = useQuery({ queryKey: key, enabled, retry: 1, queryFn: ({ signal }) => getLiveTest(id, signal),
    refetchInterval: query => query.state.status !== 'error' && query.state.data && shouldPollResearchRun('paper', query.state.data.status, query.state.data.termination?.closeStatus) ? 5000 : false });
  const instance = test.data, active = !!instance && shouldPollResearchRun('paper', instance.status);
  const waitingForClosure = instance?.status === 'STOPPED' && instance.termination?.closeStatus === 'PENDING';
  const portfolio = useQuery({ queryKey: ['live-test-account', userId, instance?.accountId, instance?.termination?.closeStatus], enabled: enabled && !!instance?.accountId,
    retry: 1, queryFn: ({ signal }) => getLiveTestPortfolio(instance!.accountId, signal),
    refetchInterval: query => (active || waitingForClosure) && query.state.status !== 'error' ? 5000 : false });
  const control = useMutation({
    mutationFn: ({ action, close }: { action: 'pause' | 'resume' | 'stop'; close?: boolean }) => controlLiveTest(id, action, close),
    onSuccess: result => { qc.setQueryData(key, result); void qc.invalidateQueries({ queryKey: ['ai-research-run', userId, 'paper', id] }); void portfolio.refetch(); },
    // A stop can succeed even when closing its position fails; reload the authoritative state.
    onError: () => { void test.refetch(); void portfolio.refetch(); },
  });
  const close = useMutation({ mutationFn: closePosition, onSuccess: () => void portfolio.refetch(), onError: () => void portfolio.refetch() });
  const balance = portfolio.data, priced = balance?.unpricedSymbols.length === 0;
  const positions = balance?.openPositions.filter(position => position.symbol === instance?.symbol) ?? [];

  return <ScrollView style={S.screen} contentContainerStyle={S.content}>
    <Heading>Live paper test</Heading><Help>Virtual funds · live market data. Signals use newly closed candles; the elapsed period before starting is not traded.</Help>
    {!isRunId(id) ? <Text style={S.error} accessibilityRole="alert">This live-test link is invalid.</Text> : null}
    {DEMO_MODE ? <Help>Sign in to the connected backend to view this live test.</Help> : null}
    {enabled && test.isPending ? <ActivityIndicator /> : null}
    {test.isError ? <ErrorBanner message={test.error.message} onRetry={() => void test.refetch()} /> : null}
    {instance ? <>
      <Card><Heading>{instance.strategy?.name ?? 'Saved strategy'}</Heading>
        <View style={S.row}><Help>{instance.exchange} · {instance.symbol} · {instance.timeframe}</Help><Text accessibilityLiveRegion="polite" style={S.status}>{instance.status}</Text></View>
        <Help>Strategy version {instance.strategy?.version ?? '—'} · Position size {instance.positionSizing?.value ?? '—'}% of equity</Help>
        {instance.execution ? <Help>Commission {instance.execution.commissionPercent}% per side · Slippage {instance.execution.slippageBps} basis points</Help> : null}
        {instance.protective?.stopLossPercent !== undefined ? <Help>Stop loss {instance.protective.stopLossPercent}%</Help> : null}
        {instance.protective?.takeProfitPercent !== undefined ? <Help>Profit target {instance.protective.takeProfitPercent}%</Help> : null}
        <Help>Started {instance.startedAt ? new Date(instance.startedAt).toLocaleString() : 'Waiting for the worker'}</Help>
        {instance.endTime != null ? <><Help>Scheduled end {new Date(instance.endTime).toLocaleString(undefined, { timeZoneName: 'short' })}</Help>
          <Help>{instance.closePositionAtEnd ? 'At the deadline, stop new signals and request closure of the virtual position. Closure requires an available executable price.' : 'At the deadline, stop new signals and retain any open position and its protection.'}</Help></> : <Help>No scheduled end. The strategy continues until paused or stopped.</Help>}
        {instance.termination ? <><Text style={instance.termination.closeStatus === 'FAILED' ? S.error : S.help} accessibilityLiveRegion="polite">{liveTerminationDescription(instance.termination)}</Text>
          <Help>Deadline handled {new Date(instance.termination.at).toLocaleString(undefined, { timeZoneName: 'short' })}</Help></> : null}
        <Help>Last evaluated candle {instance.lastProcessedCandleTime == null ? 'None yet' : new Date(instance.lastProcessedCandleTime).toLocaleString()}</Help>
        {instance.errorMessage ? <Text style={S.error} accessibilityRole="alert">{instance.errorMessage}</Text> : null}
        {(instance.status === 'RUNNING' || instance.status === 'CREATED') ? <Action secondary title="Pause strategy" pending={control.isPending} onPress={() => control.mutate({ action: 'pause' })} /> : null}
        {instance.status === 'PAUSED' ? <Action title="Resume strategy" pending={control.isPending} onPress={() => control.mutate({ action: 'resume' })} /> : null}
        {active ? <><Action secondary title="Stop strategy · keep position" pending={control.isPending} onPress={() => control.mutate({ action: 'stop' })} />
          {positions.length > 0 ? <Action secondary title="Stop strategy and close position" pending={control.isPending} onPress={() => control.mutate({ action: 'stop', close: true })} /> : null}
          <Help>Pausing or stopping keeps the existing position unless you choose to close it. Resuming does not replay trades from the paused period.</Help></> : null}
        {control.isError ? <Text style={S.error} accessibilityRole="alert">{control.error.message}</Text> : null}
        <Action secondary title="Refresh live test" pending={test.isFetching || portfolio.isFetching} onPress={() => { void test.refetch(); void portfolio.refetch(); }} />
      </Card>
      <Card><Heading>Paper account performance</Heading><Help>Account totals include every trade in this account, including manual trades and other strategies. They are not isolated returns for this strategy.</Help>
        {portfolio.isPending ? <ActivityIndicator /> : null}
        {portfolio.isError ? <ErrorBanner message={portfolio.error.message} onRetry={() => void portfolio.refetch()} /> : null}
        {balance ? <><Help>Values in {balance.currency} · As of {new Date(balance.valuedAt).toLocaleString()}</Help>
          <View style={S.wrap}><Metric label="Initial virtual capital" value={balance.initialBalance} /><Metric label="Account equity" value={priced ? balance.totalEquity : null} />
            <Metric label="Account net P/L" value={priced ? balance.netPnl : null} tone /><Metric label="Account return" value={priced ? balance.returnPercent : null} suffix="%" tone />
            <Metric label="Available balance" value={balance.availableBalance} /><Metric label="Fees paid" value={balance.totalFees} /></View>
          {!priced ? <Text style={S.error}>Current valuations are unavailable for {balance.unpricedSymbols.join(', ')}. Equity and total return are withheld until fresh prices are available.</Text> : null}
        </> : null}
      </Card>
      <Card><Heading>Open position · {instance.symbol}</Heading>
        {!positions.length && balance ? <Help>No open position in this account for this symbol.</Help> : null}
        {positions.map(position => <View key={position.id} style={{ gap: 10 }}><Help>{position.side} · {position.quantity} units · Average entry {position.averageEntryPrice}</Help>
          <View style={S.wrap}><Metric label="Mark price" value={position.markPrice} /><Metric label="Unrealized P/L" value={position.unrealizedPnl} tone /></View>
          <Help>This is the account’s entire position in {position.symbol}; it may include manual trades.</Help>
          <Action secondary title={waitingForClosure ? 'Scheduled position closure pending' : `Close virtual ${position.symbol} position`} pending={close.isPending} disabled={waitingForClosure} onPress={() => close.mutate(position.id)} />
        </View>)}
        {close.isError ? <Text style={S.error} accessibilityRole="alert">{close.error.message}</Text> : null}
      </Card>
      <Card><Heading>Recent evaluated signals</Heading><Help>Signals and execution statuses are recorded by the live strategy worker.</Help>
        {!instance.recentSignals.length ? <Help>No signals have been recorded yet.</Help> : null}
        {instance.recentSignals.map(signal => <View key={signal.id} style={{ gap: 5 }}><Text style={{ fontWeight: '600' }}>{signal.action} · {signal.status}</Text>
          <Help>{new Date(signal.candleOpenTime).toLocaleString()}</Help>{signal.reason ? <Help>{signal.reason}</Help> : null}<View style={S.divider} /></View>)}
      </Card>
    </> : null}
  </ScrollView>;
}
