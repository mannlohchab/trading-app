import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { Action, Card, EquityChart, Heading, Help, Metric, RiskStatisticsView, Status, useBacktestStyles } from '@/components/backtesting/BacktestUi';
import { isActiveBacktest, metricText } from '@/lib/backtesting';
import { cancelBacktest, getBacktest, getBacktestDataset, getBacktestEquity, getBacktestTrades, replayBacktest } from '@/lib/backtestingApi';
import { DEMO_MODE } from '@/lib/demoMode';
import { useAuth } from '@/store/auth';

export default function BacktestDetailScreen() {
  const S = useBacktestStyles();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const userId = useAuth(state => state.user?.id);
  const enabled = !!id && !!userId && !DEMO_MODE;
  const qc = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [showArchive, setShowArchive] = useState(false);
  const run = useQuery({ queryKey: ['backtest', userId, id], enabled, queryFn: ({ signal }) => getBacktest(id, signal),
    refetchInterval: query => query.state.data && isActiveBacktest(query.state.data.status) ? 1500 : false });
  const completed = run.data?.status === 'COMPLETED';
  const equity = useQuery({ queryKey: ['backtest-equity', userId, id], enabled: enabled && completed, queryFn: ({ signal }) => getBacktestEquity(id, signal) });
  const trades = useQuery({ queryKey: ['backtest-trades', userId, id, offset], enabled: enabled && completed, queryFn: ({ signal }) => getBacktestTrades(id, offset, signal) });
  const archive = useQuery({ queryKey: ['backtest-dataset', userId, id], enabled: enabled && showArchive, queryFn: ({ signal }) => getBacktestDataset(id, signal), staleTime: Infinity });
  const cancel = useMutation({ mutationFn: () => cancelBacktest(id), onSuccess: saved => {
    qc.setQueryData(['backtest', userId, id], saved); void qc.invalidateQueries({ queryKey: ['backtests', userId] });
  }, onError: () => { void run.refetch(); } });
  const replay = useMutation({ mutationFn: () => replayBacktest(id), onSuccess: saved => {
    void qc.invalidateQueries({ queryKey: ['backtests', userId] });
    router.push({ pathname: '/backtests/[id]', params: { id: saved.id } });
  } });
  const data = run.data, m = data?.summary;
  const currency = data?.symbol?.quoteAsset ?? '';
  return <ScrollView style={S.screen} contentContainerStyle={S.content}
    refreshControl={<RefreshControl refreshing={run.isRefetching} onRefresh={() => { void run.refetch(); if (completed) { void equity.refetch(); void trades.refetch(); } }} />}>
    {run.isPending && enabled ? <ActivityIndicator /> : null}
    {run.isError ? <ErrorBanner message={run.error.message} onRetry={() => void run.refetch()} /> : null}
    {DEMO_MODE ? <Help>Saved backtest results require a connected account.</Help> : null}
    {data ? <>
      <Card><View style={S.row}><View style={{ flex: 1 }}><Heading>{data.strategy.name ?? 'Backtest'}</Heading><Help>{data.market.exchange} · {data.market.symbol} · {data.market.timeframe} · v{data.strategy.version ?? '—'}</Help></View><Status status={data.status} /></View>
        <Help>{new Date(data.range.start).toISOString()} → {new Date(data.range.end).toISOString()} · end exclusive</Help>
        {isActiveBacktest(data.status) ? <><Help>{data.status === 'PENDING' ? 'Your run is queued. This page updates automatically.' : 'Loading history and evaluating the strategy. This page updates automatically.'}</Help><Action secondary title={cancel.isPending ? 'Cancelling…' : 'Cancel backtest'} pending={cancel.isPending} onPress={() => cancel.mutate()} /></> : null}
        {cancel.isError ? <Text accessibilityRole="alert" style={S.error}>{cancel.error.message}</Text> : null}
        {data.error ? <Text accessibilityRole="alert" style={S.error}>{data.error.message}</Text> : null}
        {data.status === 'CANCELLED' ? <Help>This run was cancelled. No completed result is available.</Help> : null}
      </Card>
      {m ? <Card><Heading>Performance · {currency}</Heading><View style={S.wrap}>
        <Metric label="Total return" value={m.totalReturnPercent} suffix="%" tone /><Metric label="Realized P/L" value={m.netProfit} tone />
        <Metric label="Final equity" value={m.finalEquity} /><Metric label="Drawdown at close" value={m.maxDrawdownPercent} suffix="%" />
        <Metric label="Win rate" value={m.winRatePercent} suffix="%" /><Metric label="Profit factor" value={m.profitFactor} />
        <Metric label="Closed trades" value={m.totalTrades} /><Metric label="Unrealized P/L" value={m.unrealizedProfit} tone /><Metric label="Fees" value={m.totalCommission} />
        <Metric label="Buy-and-hold return" value={m.buyAndHoldReturnPercent} suffix="%" /><Metric label="Exposure" value={m.exposurePercent} suffix="%" />
        {m.intrabarMaxDrawdownPercent !== undefined ? <Metric label="Intrabar drawdown estimate" value={m.intrabarMaxDrawdownPercent} suffix="%" /> : null}
      </View>{equity.isPending ? <ActivityIndicator /> : null}
        {equity.isError ? <ErrorBanner message={equity.error.message} onRetry={() => void equity.refetch()} /> : null}
        {equity.data ? <EquityChart points={equity.data.points} currency={currency} /> : null}
        {m.riskStatistics ? <RiskStatisticsView statistics={m.riskStatistics} /> : null}
      </Card> : null}
      {data.warnings?.length ? <Card><Heading>Run warnings</Heading>{data.warnings.map((warning, i) => <Help key={`${warning.code}:${i}`}>{warning.message}</Help>)}</Card> : null}
      {data.settings ? <Card><Heading>Execution settings</Heading><Help>Initial capital: {metricText(data.settings.initialCapital)} {currency}</Help>
        <Help>Commission: {data.settings.commissionPercent}% per side · Slippage: {data.settings.slippageTicks} ticks</Help>
        {data.settings.execution?.spreadTicks !== undefined ? <Help>Spread scenario: {data.settings.execution.spreadTicks} ticks</Help> : null}
        {data.settings.execution?.maxVolumeParticipationPercent !== undefined ? <Help>Volume participation cap: {data.settings.execution.maxVolumeParticipationPercent}%</Help> : null}
        {m?.intrabarDrawdownModel === 'ohlc_path' ? <Help>Intrabar drawdown is estimated from the assumed path through each candle’s prices.</Help> : null}
        <Help>Position size: {data.settings.positionSizing.value} {data.settings.positionSizing.type === 'percent_of_equity' ? '% of equity' : data.settings.positionSizing.type === 'cash' ? currency : 'units'}</Help>
        {Object.entries(data.assumptions ?? {}).map(([key, value]) => <Help key={key}>{value}</Help>)}
      </Card> : null}
      {data.dataset ? <Card><Heading>Data provenance</Heading><Help>{data.dataset.candles.toLocaleString()} candles used · {data.dataset.missingCandles} missing</Help>
        {data.dataset.warmupCandles !== undefined ? <Help>{data.dataset.warmupCandles} earlier candles initialize indicators before the measured period.</Help> : null}
        <Help>Engine: {data.engine?.name} {data.engine?.version}</Help>
        <Text style={S.label} selectable>Dataset checksum: {data.dataset.checksum}</Text>
        {data.dataset.snapshotId ? <Text style={S.label} selectable>Snapshot: {data.dataset.snapshotId}</Text> : null}
        <Help>Replay uses the archived inputs and settings. It requires the same supported engine version.</Help>
        <Action secondary title={replay.isPending ? 'Queuing replay…' : 'Replay archived run'} pending={replay.isPending} onPress={() => replay.mutate()} />
        {replay.isError ? <Text accessibilityRole="alert" style={S.error}>{replay.error.message}</Text> : null}
        <Action secondary title={showArchive ? 'Hide archived data' : 'Inspect archived data'} onPress={() => setShowArchive(value => !value)} />
        {showArchive && archive.isPending ? <ActivityIndicator /> : null}
        {showArchive && archive.isError ? <ErrorBanner message={archive.error.message} onRetry={() => void archive.refetch()} /> : null}
        {showArchive && archive.data ? <><Help>{archive.data.input.candles.length.toLocaleString()} archived candles, including indicator warm-up. First and last observations:</Help>
          {[archive.data.input.candles[0], archive.data.input.candles.at(-1)].filter((c, i, all) => c && (i === 0 || c !== all[0])).map(candle => candle ? <Text selectable style={S.label} key={candle.openTime}>
            {new Date(candle.openTime).toISOString()} · O {candle.open} H {candle.high} L {candle.low} C {candle.close} V {candle.volume}
          </Text> : null)}</> : null}
      </Card> : null}
      {completed ? <Card><Heading>Trades · {currency}</Heading>
        {trades.isPending ? <ActivityIndicator /> : null}
        {trades.isError ? <ErrorBanner message={trades.error.message} onRetry={() => void trades.refetch()} /> : null}
        {trades.data?.total === 0 ? <Help>No trades closed during this run.</Help> : null}
        {trades.data?.trades.map(trade => <View key={trade.id} style={{ gap: 6, paddingVertical: 10 }}><View style={S.row}><Text style={{ fontWeight: '600' }}>{trade.side} · {trade.quantity} units</Text><Text>{metricText(trade.profit)} {currency}</Text></View>
          <Help>{trade.entryPrice} → {trade.exitPrice ?? 'Open'} · Fees {trade.fees}</Help>
          <Help>Entry {new Date(trade.entryTime).toISOString()}</Help><Help>Exit {trade.exitTime == null ? 'Open' : new Date(trade.exitTime).toISOString()}</Help>
          {trade.exitReason ? <Help>{trade.exitReason}</Help> : null}<View style={S.divider} /></View>)}
        {trades.data && trades.data.total > 0 ? <><Help>Trades {offset + 1}–{offset + trades.data.trades.length} of {trades.data.total}</Help><View style={S.row}>
          <Action secondary title="Previous" disabled={offset === 0 || trades.isFetching} onPress={() => setOffset(value => Math.max(0, value - 30))} />
          <Action secondary title="Next" disabled={offset + trades.data.trades.length >= trades.data.total || trades.isFetching} onPress={() => setOffset(value => value + 30)} />
        </View></> : null}
      </Card> : null}
    </> : null}
  </ScrollView>;
}
