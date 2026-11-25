import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ComponentRef } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/AppText';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { Action, Card, EquityChart, Field, Heading, Help, Metric, RiskStatisticsView, Status, useBacktestStyles } from '@/components/backtesting/BacktestUi';
import { dateBoundary, defaultBacktestDraft, isActiveBacktest, metricText, prepareBacktest, prepareRiskStatistics, type BacktestTimeframe } from '@/lib/backtesting';
import { getBacktestStrategy, listBacktestStrategies } from '@/lib/backtestingApi';
import { parseDatasetDocument, researchInteger, researchObjectiveInfo, researchObjectiveValue, type ResearchInput, type ResearchMetrics, type ResearchResult } from '@/lib/backtestResearch';
import { cancelResearchExperiment, createResearchExperiment, getResearchExperiment, importResearchDataset, listResearchDatasets, listResearchExperiments } from '@/lib/backtestResearchApi';
import { DEMO_MODE } from '@/lib/demoMode';
import { useAuth } from '@/store/auth';
import { isRunId } from '@/lib/aiResearchRun';

export default function BacktestResearchScreen() {
  const S = useBacktestStyles();
  const { experimentId } = useLocalSearchParams<{ experimentId?: string }>();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const userId = useAuth(state => state.user?.id), enabled = !!userId && !DEMO_MODE;
  const qc = useQueryClient();
  const [document, setDocument] = useState('');
  const [importVisible, setImportVisible] = useState(false);
  const [datasetId, setDatasetId] = useState('');
  const [rangeKey, setRangeKey] = useState('');
  const [kind, setKind] = useState<ResearchInput['kind'] | 'options'>('single');
  const [candidateIds, setCandidateIds] = useState<string[]>([]);
  const [start, setStart] = useState(''), [end, setEnd] = useState('');
  const [capital, setCapital] = useState('10000'), [commission, setCommission] = useState('0.1');
  const [periodsPerYear, setPeriodsPerYear] = useState(''), [riskFreePercent, setRiskFreePercent] = useState('');
  const [trainBars, setTrainBars] = useState('500'), [testBars, setTestBars] = useState('100'), [embargoBars, setEmbargoBars] = useState('1');
  const [anchored, setAnchored] = useState(false);
  const [executionDocument, setExecutionDocument] = useState('');
  const [error, setError] = useState('');
  const selectedExperiment = isRunId(experimentId) ? experimentId : '';
  const setSelectedExperiment = (id: string) => { router.setParams({ experimentId: id }); scroll.current?.scrollTo({ y: 0, animated: true }); };
  const datasets = useQuery({ queryKey: ['research-datasets', userId], enabled, queryFn: ({ signal }) => listResearchDatasets(signal) });
  const experiments = useQuery({ queryKey: ['research-experiments', userId], enabled, queryFn: ({ signal }) => listResearchExperiments(signal),
    refetchInterval: query => query.state.data?.experiments.some(e => isActiveBacktest(e.status)) ? 2500 : false });
  const strategies = useInfiniteQuery({ queryKey: ['backtest-strategies', userId], enabled, initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => listBacktestStrategies(pageParam, signal),
    getNextPageParam: (last, pages) => { const count = pages.reduce((n, p) => n + p.strategies.length, 0); return count < last.total ? count : undefined; } });
  const detail = useQuery({ queryKey: ['research-experiment', userId, selectedExperiment], enabled: enabled && !!selectedExperiment,
    queryFn: ({ signal }) => getResearchExperiment(selectedExperiment, signal),
    refetchInterval: query => query.state.data && isActiveBacktest(query.state.data.status) ? 1500 : false });
  const selected = datasets.data?.datasets.find(dataset => dataset.id === datasetId);
  const range = selected?.ranges.find(item => `${item.instrumentId}:${item.timeframe}` === rangeKey);
  const saved = strategies.data?.pages.flatMap(page => page.strategies).filter(item => item.status === 'ACTIVE') ?? [];
  const importData = useMutation({ mutationFn: importResearchDataset, onSuccess: dataset => {
    setDocument(''); setImportVisible(false); setDatasetId(dataset.id); setRangeKey(''); setError('');
    void qc.invalidateQueries({ queryKey: ['research-datasets', userId] });
  } });
  const create = useMutation({ mutationFn: async () => {
    if (!selected) throw new Error('Select a historical dataset first.');
    if (kind === 'options') return createResearchExperiment({ kind: 'options', datasetId, execution: parseDatasetDocument(executionDocument) });
    if (!range) throw new Error('Select an instrument and timeframe with candles.');
    if (!candidateIds.length || (kind === 'single' && candidateIds.length !== 1)) throw new Error(kind === 'single' ? 'Select exactly one saved strategy.' : 'Select at least one saved strategy candidate.');
    const from = dateBoundary(start), to = dateBoundary(end);
    if (!from || !to || Date.parse(from) >= Date.parse(to)) throw new Error('Choose valid historical start and end dates. The end date is exclusive.');
    const definitions = await Promise.all(candidateIds.map(id => getBacktestStrategy(id)));
    const validated = prepareBacktest({ ...defaultBacktestDraft, start, end, initialCapital: capital, commissionPercent: commission }, definitions[0]!).settings;
    const settings = { initialCapital: validated.initialCapital, commissionPercent: validated.commissionPercent, slippageTicks: validated.slippageTicks };
    const request: ResearchInput = { kind, datasetId, instrumentId: range.instrumentId, timeframe: range.timeframe as BacktestTimeframe,
      range: { start: Date.parse(from), end: Date.parse(to) }, definitions: definitions.map(strategy => strategy.definition), settings };
    const statistics = prepareRiskStatistics(periodsPerYear, riskFreePercent);
    if (statistics) request.riskStatistics = statistics;
    if (kind === 'walk_forward') request.walkForward = {
      trainBars: researchInteger(trainBars, 'Training candles', 100, 30000), testBars: researchInteger(testBars, 'Test candles', 20, 10000),
      embargoBars: researchInteger(embargoBars, 'Embargo candles', 1, 1000), anchored,
    };
    return createResearchExperiment(request);
  }, onSuccess: experiment => { setSelectedExperiment(experiment.id); setError(''); void qc.invalidateQueries({ queryKey: ['research-experiments', userId] }); } });
  const cancel = useMutation({ mutationFn: () => cancelResearchExperiment(selectedExperiment), onSuccess: experiment => {
    qc.setQueryData(['research-experiment', userId, selectedExperiment], experiment); void qc.invalidateQueries({ queryKey: ['research-experiments', userId] });
  }, onError: () => { void detail.refetch(); } });
  const toggleCandidate = (id: string) => setCandidateIds(ids => kind === 'single' ? [id] : ids.includes(id) ? ids.filter(value => value !== id) : ids.length < 8 ? [...ids, id] : ids);

  return <KeyboardAvoidingView style={S.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView ref={scroll} contentContainerStyle={S.content} keyboardShouldPersistTaps="handled">
    <Heading>Research with archived market data</Heading><Help>Use a validated historical dataset, reserve unseen periods, and review every experiment’s assumptions.</Help>
    {DEMO_MODE ? <Card><Help>Research requires a signed-in account connected to the backend. No sample results are generated here.</Help></Card> : <>
      {selectedExperiment ? <Card><Heading>Experiment results</Heading>
        {detail.isPending ? <ActivityIndicator /> : null}
        {detail.isError ? <ErrorBanner message={detail.error.message} onRetry={() => void detail.refetch()} /> : null}
        {detail.data ? <><Status status={detail.data.status} />
          {isActiveBacktest(detail.data.status) ? <><Help>This page updates while the experiment runs.</Help><Action secondary title="Cancel experiment" pending={cancel.isPending} onPress={() => cancel.mutate()} /></> : null}
          {detail.data.error ? <Text accessibilityRole="alert" style={S.error}>{detail.data.error}</Text> : null}
          {cancel.isError ? <Text accessibilityRole="alert" style={S.error}>{cancel.error.message}</Text> : null}
          {detail.data.result ? <ResearchResults result={detail.data.result} /> : null}
        </> : null}
      </Card> : null}
      <Card><Heading>Historical datasets</Heading>
        {datasets.isPending ? <ActivityIndicator /> : null}
        {datasets.isError ? <ErrorBanner message={datasets.error.message} onRetry={() => void datasets.refetch()} /> : null}
        {datasets.data?.datasets.length === 0 ? <Help>Import a dataset with provenance, instrument contracts and historical observations. Non-crypto instruments also require an exchange-session calendar.</Help> : null}
        {datasets.data?.datasets.map(dataset => <Pressable key={dataset.id} accessibilityRole="radio" accessibilityState={{ selected: datasetId === dataset.id }}
          onPress={() => { setDatasetId(dataset.id); setRangeKey(''); create.reset(); }} style={[S.chip, datasetId === dataset.id && S.selected]}>
          <Text style={{ fontWeight: '600' }}>{dataset.name}</Text><Help>{dataset.candleCount.toLocaleString()} candles · {dataset.quoteCount.toLocaleString()} quotes · {dataset.instruments.length} instruments</Help>
        </Pressable>)}
        <Action secondary title={importVisible ? 'Close importer' : 'Import dataset JSON'} onPress={() => setImportVisible(value => !value)} />
        {importVisible ? <><Help>Paste a dataset document up to 2 MB. The server checks provenance, timestamps, contracts, duplicate events and session boundaries before saving it.</Help>
          <TextInput accessibilityLabel="Historical dataset JSON" multiline autoCapitalize="none" autoCorrect={false} value={document} onChangeText={setDocument}
            placeholder={'{ "schemaVersion": 1, "name": "Historical study", ... }'} style={[S.input, { minHeight: 180, maxHeight: 300, textAlignVertical: 'top' }]} />
          <Action title={importData.isPending ? 'Validating dataset…' : 'Validate and import'} pending={importData.isPending} onPress={() => {
            try { const parsed = parseDatasetDocument(document); setError(''); importData.mutate(parsed); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Invalid dataset.'); }
          }} />
          {error || importData.isError ? <Text style={S.error} accessibilityRole="alert">{error || importData.error?.message}</Text> : null}
        </> : null}
      </Card>
      <Card><Heading>New experiment</Heading><View style={S.wrap}>{([{ kind: 'single', title: 'Single run' }, { kind: 'walk_forward', title: 'Walk-forward' }, { kind: 'options', title: 'Quote portfolio' }] as const).map(item => <Pressable key={item.kind}
        accessibilityRole="radio" accessibilityState={{ selected: kind === item.kind }} onPress={() => { setKind(item.kind); if (item.kind === 'single') setCandidateIds(ids => ids.slice(0, 1)); create.reset(); }} style={[S.chip, kind === item.kind && S.selected]}><Text>{item.title}</Text></Pressable>)}</View>
        {kind === 'options' ? <>
          <Help>Replay timestamped baskets against observed bid/ask prices and sizes. The dataset must include applicable fees, session calendars, short-portfolio margin snapshots, and expiry settlements.</Help>
          <Help>Supply an execution document with start/end timestamps, initialCapital and orders. Each order specifies its time, legs (instrumentId, BUY/SELL, lots), and FOK or IOC handling. Instruments in the selected dataset:</Help>
          {selected?.instruments.map(instrument => <Text key={instrument.id} selectable style={S.label}>{instrument.id} · {instrument.symbol} · {instrument.assetClass}</Text>)}
          <TextInput accessibilityLabel="Portfolio execution JSON" multiline value={executionDocument} onChangeText={setExecutionDocument} autoCapitalize="none" autoCorrect={false}
            placeholder={'{ "start": 0, "end": 0, "initialCapital": "100000", "orders": [] }'} style={[S.input, { minHeight: 180, maxHeight: 300, textAlignVertical: 'top' }]} />
        </> : <>
          <Text style={S.label}>Instrument and timeframe</Text>
          {selected?.ranges.map(item => { const key = `${item.instrumentId}:${item.timeframe}`, instrument = selected.instruments.find(i => i.id === item.instrumentId); return <Pressable key={key}
            accessibilityRole="radio" accessibilityState={{ selected: rangeKey === key }} onPress={() => setRangeKey(key)} style={[S.chip, rangeKey === key && S.selected]}>
            <Text>{instrument?.symbol ?? item.instrumentId} · {item.timeframe}</Text><Help>{item.candles.toLocaleString()} candles · {new Date(item.start).toISOString().slice(0, 10)} to {new Date(item.end).toISOString().slice(0, 10)}</Help>
          </Pressable>; })}
          {selected && !selected.ranges.length ? <Help>This dataset has no candle history. Use quote portfolio mode for quote-only datasets.</Help> : null}
          <Help>Keep earlier candles for indicator warm-up. Date-only boundaries use midnight UTC; intraday timestamps must include Z or an offset such as +05:30.</Help>
          <Field label="Start · date or ISO timestamp" value={start} onChangeText={setStart} placeholder="YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss+05:30" />
          <Field label="End · exclusive date or ISO timestamp" value={end} onChangeText={setEnd} />
          <Text style={S.label}>{kind === 'single' ? 'Saved strategy' : 'Saved strategy candidates · up to 8'}</Text>
          {strategies.isPending ? <ActivityIndicator /> : null}
          {strategies.isError ? <ErrorBanner message={strategies.error.message} onRetry={() => void strategies.refetch()} /> : null}
          {saved.map(strategy => <Pressable key={strategy.id} accessibilityRole={kind === 'single' ? 'radio' : 'checkbox'} accessibilityState={{ selected: candidateIds.includes(strategy.id), checked: candidateIds.includes(strategy.id), disabled: kind !== 'single' && !candidateIds.includes(strategy.id) && candidateIds.length >= 8 }}
            disabled={kind !== 'single' && !candidateIds.includes(strategy.id) && candidateIds.length >= 8} onPress={() => toggleCandidate(strategy.id)} style={[S.chip, candidateIds.includes(strategy.id) && S.selected]}><Text>{strategy.name} · v{strategy.latestVersion}</Text></Pressable>)}
          {!strategies.isPending && !saved.length ? <Help>Save strategy variants in the AI assistant before creating a research experiment.</Help> : null}
          {strategies.hasNextPage ? <Action secondary title="Load more strategies" pending={strategies.isFetchingNextPage} onPress={() => void strategies.fetchNextPage()} /> : null}
          <Field label="Initial capital · quote currency" value={capital} onChangeText={setCapital} keyboardType="decimal-pad" />
          <Field label="Commission per side · %" value={commission} onChangeText={setCommission} keyboardType="decimal-pad" />
          <Help>Candle experiments use each strategy’s saved position size, one tick of slippage and uniform commission. Quote portfolio mode applies the dataset’s historical fee schedules.</Help>
          <Field label="Equity observations per year · optional" value={periodsPerYear} onChangeText={setPeriodsPerYear} keyboardType="decimal-pad" placeholder="Leave blank to omit annualized statistics" />
          <Field label="Annual risk-free rate · %, optional" value={riskFreePercent} onChangeText={setRiskFreePercent} keyboardType="decimal-pad" placeholder="0" />
          <Help>Annualized ratios assume regular trading-period samples and the frequency you specify.</Help>
          {kind === 'walk_forward' ? <>
            <Field label="Training candles" value={trainBars} onChangeText={setTrainBars} keyboardType="number-pad" />
            <Field label="Unseen test candles" value={testBars} onChangeText={setTestBars} keyboardType="number-pad" />
            <Field label="Embargo candles between training and test" value={embargoBars} onChangeText={setEmbargoBars} keyboardType="number-pad" />
            <View style={S.row}><Help>Expand training from the original start</Help><Switch accessibilityLabel="Expanding training window" value={anchored} onValueChange={setAnchored} /></View>
            <Help>Candidates are selected using training returns only. Test periods do not overlap. Each test window starts with fresh capital; keep a final untouched holdout for validation.</Help>
          </> : null}
        </>}
        <Action title={create.isPending ? 'Queuing experiment…' : 'Run experiment'} disabled={!selected} pending={create.isPending} onPress={() => create.mutate()} />
        {create.isError ? <Text style={S.error} accessibilityRole="alert">{create.error.message}</Text> : null}
      </Card>
      <Card><Heading>Experiment history</Heading>
        {experiments.isPending ? <ActivityIndicator /> : null}
        {experiments.isError ? <ErrorBanner message={experiments.error.message} onRetry={() => void experiments.refetch()} /> : null}
        {experiments.data?.experiments.length === 0 ? <Help>Your research experiments will appear here.</Help> : null}
        {experiments.data?.experiments.map(experiment => <Pressable key={experiment.id} accessibilityRole="button" onPress={() => { setSelectedExperiment(experiment.id); cancel.reset(); }} style={[S.chip, selectedExperiment === experiment.id && S.selected]}>
          <View style={S.row}><Text>{experiment.kind === 'walk_forward' ? 'Walk-forward' : experiment.kind === 'options' ? 'Quote portfolio' : 'Single run'}</Text><Status status={experiment.status} /></View>
          <Help>{datasets.data?.datasets.find(dataset => dataset.id === experiment.datasetId)?.name ?? 'Historical dataset'} · {new Date(experiment.createdAt).toLocaleString()}</Help>
        </Pressable>)}
        <Action secondary title="Refresh history" pending={experiments.isRefetching} onPress={() => void experiments.refetch()} />
      </Card>
    </>}
  </ScrollView></KeyboardAvoidingView>;
}

function ResearchMetricsView({ metrics }: { metrics: ResearchMetrics }) {
  const S = useBacktestStyles();
  const [showModel, setShowModel] = useState(false);
  return <><View style={S.wrap}><Metric label="Return" value={metrics.totalReturnPercent} suffix="%" tone /><Metric label="Drawdown at close" value={metrics.maxDrawdownPercent} suffix="%" />
    <Metric label="Trades" value={metrics.totalTrades} /><Metric label="Win rate" value={metrics.winRatePercent} suffix="%" /><Metric label="Profit factor" value={metrics.profitFactor} /></View>
    {metrics.intrabarMaxDrawdownPercent !== undefined ? <><Metric label="Intrabar drawdown estimate" value={metrics.intrabarMaxDrawdownPercent} suffix="%" /><Help>Estimated from the assumed OHLC path within each candle.</Help></> : null}
    {metrics.equityCurve?.length ? <EquityChart points={metrics.equityCurve} /> : null}
    {metrics.riskStatistics ? <RiskStatisticsView statistics={metrics.riskStatistics} /> : null}
    {metrics.executionAssumptions?.length ? <><Action secondary title={showModel ? 'Hide execution assumptions' : 'Show execution assumptions'} onPress={() => setShowModel(value => !value)} />
      {showModel ? metrics.executionAssumptions.map((assumption, i) => <Help key={i}>{assumption}</Help>) : null}</> : null}</>;
}

function ResearchResults({ result }: { result: ResearchResult }) {
  const S = useBacktestStyles();
  const assumptions = Array.isArray(result.assumptions) ? result.assumptions : Object.values(result.assumptions ?? {});
  const objective = researchObjectiveInfo(result.objective);
  return <>
    {result.warnings?.map((warning, i) => <Help key={`warning:${i}`}>{warning}</Help>)}
    {result.metrics ? <ResearchMetricsView metrics={result.metrics} /> : null}
    {result.windows ? <Help>Selection objective: {objective.selection}. Candidates are chosen on training data before each unseen test.</Help> : null}
    {result.windows?.map((window, i) => <View key={i} style={{ gap: 10 }}><View style={S.divider} /><Text style={{ fontWeight: '600' }}>Unseen test window {i + 1} · candidate {window.selectedCandidate + 1}</Text>
      <Help>Training: {new Date(window.trainRange.start).toISOString().slice(0, 10)} → {new Date(window.trainRange.end).toISOString().slice(0, 10)}</Help>
      <Help>Test: {new Date(window.testRange.start).toISOString().slice(0, 10)} → {new Date(window.testRange.end).toISOString().slice(0, 10)}</Help>
      <Metric label={`Unseen ${objective.label.toLowerCase()}`} value={researchObjectiveValue(window.outOfSample, result.objective)} suffix={objective.suffix} />
      <ResearchMetricsView metrics={window.outOfSample.metrics} />
    </View>)}
    {result.sensitivity ? <><Heading>Training sensitivity · {objective.label}</Heading><Help>Values across candidates on the first training period. These are training measurements; review unseen test performance separately.</Help>
      {result.sensitivity.results.map(item => <Help key={item.index}>Candidate {item.index + 1}: {metricText(researchObjectiveValue(item, result.objective), objective.suffix)} · {item.metrics.totalTrades} trades</Help>)}
    </> : null}
    {result.finalEquity !== undefined ? <><View style={S.wrap}><Metric label="Final equity" value={result.finalEquity} /><Metric label="Net profit" value={result.netProfit} tone />
      <Metric label="Cash" value={result.cash} /><Metric label="Fees" value={result.totalFees} /><Metric label="Max drawdown · amount" value={result.maxDrawdown} /></View>
      {result.status === 'MARGIN_BREACH' ? <Text style={S.error}>The portfolio breached maintenance margin. The simulation stopped without assuming a liquidation fill.</Text> : null}
      {result.equityCurve?.length ? <EquityChart points={result.equityCurve} /> : null}
      <Heading>Basket execution</Heading>{result.orders?.slice(0, 100).map(order => <View key={order.id} style={{ gap: 5 }}><Text style={{ fontWeight: '600' }}>{order.id} · {order.status}</Text>
        <Help>{new Date(order.time).toISOString()} · Net debit {order.netDebit} · Fees {order.fees}</Help>
        {order.reason ? <Help>{order.reason}</Help> : null}{order.fills.map((fill, i) => <Help key={i}>{fill.side} {fill.quantity} {fill.instrumentId} at {fill.price} · Fee {fill.fee}</Help>)}<View style={S.divider} />
      </View>)}{result.orders && result.orders.length > 100 ? <Help>Showing the first 100 baskets of {result.orders.length}.</Help> : null}
    </> : null}
    {assumptions.length ? <Heading>Assumptions</Heading> : null}{assumptions.map((assumption, i) => <Help key={`assumption:${i}`}>{assumption}</Help>)}
    {result.datasetChecksum ? <Text selectable style={S.label}>Dataset checksum: {result.datasetChecksum}</Text> : null}
  </>;
}
