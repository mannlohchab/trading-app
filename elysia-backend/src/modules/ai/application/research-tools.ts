import { z } from 'zod';
import { TIMEFRAMES } from '../../market/domain/market-options';
import { LIMITS, DEFAULTS } from '../../backtesting/backtesting.constants';
import { createBacktestSchema, settingsSchema, riskStatisticsSchema } from '../../backtesting/backtesting.schemas';
import { historicalRunSchema, researchExperimentSchema, datasetMetadataSchema, type BacktestResearchGateway } from '../infrastructure/backtest-research.gateway';
import { liveStartSchema, liveAccountSchema, livePageSchema, liveListSchema, liveControlSchema, liveAccountReportSchema, type LiveTestingGateway } from '../infrastructure/live-testing.gateway';
import type { ResponseBlock } from '../domain/blocks';
import type { BacktestGateway } from './tools';
import { defineTool, ToolInputError, type AssistantTool, type ToolOutcome } from './tool-definition';
import { looseDraft, normalizeDraft } from './strategy-tool-schema';
import { resolveResearchPeriod } from '../domain/research-period';

type Scoped<T> = { gateway: T; userId: string };
type Draft = { name: string; definition: unknown; summary: string[] };
const uuid = z.uuid();
const page = z.strictObject({ limit: z.number().int().min(1).max(20).default(10), offset: z.number().int().nonnegative().max(10000).default(0) });
const runSchema = z.strictObject({
  mode: z.enum(['saved', 'preview']).default('saved').describe('saved queues a persistent run; preview waits for a short unsaved result'),
  strategyId: uuid.optional(), strategyVersionId: uuid.optional(),
  draftId: z.string().min(1).max(40).optional().describe('draft_strategy id from this turn'),
  name: z.string().min(3).max(80).optional(), definition: looseDraft.shape.definition.optional(),
  market: createBacktestSchema.shape.market,
  range: createBacktestSchema.shape.range.describe('Requested historical start/end as ISO timestamps with explicit timezone offset or epoch milliseconds. End exclusive. Never substitute recent data for requested dates.'),
  candles: z.number().int().min(100).max(LIMITS.maxCandles).optional(),
  settings: settingsSchema.optional(), riskStatistics: riskStatisticsSchema.optional(),
}).refine(v => [v.strategyId, v.draftId, v.definition].filter(Boolean).length === 1, { message: 'Choose exactly one strategyId, draftId or definition.' })
  .refine(v => !v.strategyVersionId || !!v.strategyId, { message: 'strategyVersionId requires strategyId.' })
  .refine(v => !v.range || v.candles === undefined, { message: 'Choose a date range or candle count, not both.' });

/** Small server-built card. Current values are fetched by the app through the owned resource API. */
function runCard(kind: 'backtest' | 'experiment' | 'paper', value: unknown): ResponseBlock {
  const row = value as Record<string, any>;
  const source = row.instance ?? row.run ?? row;
  const market = source.market ?? (source.symbol ? { exchange: source.exchange, symbol: source.symbol, timeframe: source.timeframe } : undefined);
  const summary = source.summary ?? (source.result && typeof source.result === 'object' ? source.result.metrics : undefined);
  const paperMessage = source.warning?.message ?? source.termination?.message ?? source.control?.note ?? ({
    CREATED: 'Virtual test submitted; waiting for the live runner to initialize.',
    RUNNING: 'Virtual funds on live market data. Results accumulate as closed candles arrive.',
    PAUSED: 'Virtual strategy signals are paused. Existing protective orders can remain active.',
    STOPPED: 'Virtual strategy stopped. Check account positions for any remaining exposure.',
    FAILED: source.errorMessage ?? 'Virtual strategy failed; inspect its recorded error.',
  } as Record<string, string>)[source.status];
  return { type: 'research_run', data: {
    kind, id: source.id, status: source.status,
    title: source.strategy?.name ?? source.title ?? (kind === 'paper' ? 'Live paper test' : kind === 'experiment' ? 'Research experiment' : 'Historical backtest'),
    ...(market && { market }), ...(source.range && { range: source.range }), ...(summary && { summary }),
    ...(kind === 'paper' && { message: paperMessage ?? 'Virtual funds only. Refresh to inspect the current instance state.' }),
  } };
}

export function createResearchTools(deps: {
  research?: Scoped<BacktestResearchGateway>;
  liveTesting?: Scoped<LiveTestingGateway>;
  preview?: Scoped<BacktestGateway>;
  drafts: Map<string, Draft>;
}): AssistantTool[] {
  if (!deps.research && !deps.liveTesting) return [];
  const tools: AssistantTool[] = [];
  // A repeated model call must not create another job/account/strategy in this answer.
  const mutations = new Map<string, Promise<ToolOutcome>>();
  const lastControl = new Map<string, string>();
  let submitted = 0;
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
  const mutate = async (name: string, args: unknown, fn: () => Promise<ToolOutcome>, startsRun = false) => {
    const key = `${name}:${JSON.stringify(canonical(args))}`;
    const prior = mutations.get(key);
    if (prior) return { ...(await prior), blocks: [] };
    if (startsRun && submitted >= 3) throw new ToolInputError('At most three new tests per answer. Use the existing run cards or continue in another message.');
    if (startsRun) submitted++;
    const pending = fn();
    mutations.set(key, pending);
    try { return await pending; } catch (error) { mutations.delete(key); if (startsRun) submitted--; throw error; }
  };
  const add = <S extends z.ZodType>(name: string, description: string, schema: S, run: (args: z.infer<S>) => Promise<ToolOutcome>) => {
    tools.push(defineTool(name, description, schema, async args => {
      try { return await run(args); }
      catch (error) {
        if (error instanceof ToolInputError) throw error;
        if (error instanceof z.ZodError) throw new ToolInputError(error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
        if (error instanceof Error && ('code' in error || error.name === 'PaperError')) throw new ToolInputError(`${'code' in error ? `${error.code}: ` : ''}${error.message}`);
        throw error;
      }
    }));
  };
  add('get_backtesting_capabilities', 'Discover actual available data sources, supported strategy rules, historical/research/live test modes and limits. Call before attempting an unfamiliar strategy; never silently simplify unsupported rules.', z.strictObject({}), async () => ({ result: {
    historical: !!deps.research, livePaper: !!deps.liveTesting,
    data: { provider: 'BINANCE public spot candles', otherMarkets: 'Owned imported datasets only; inspect availability first. No built-in NSE/BSE history provider.', live: 'BINANCE USDT spot quotes and closed candles; virtual funds only' },
    timeframes: TIMEFRAMES, directions: ['LONG', 'SHORT'], indicators: ['PRICE (candle close)', 'VOLUME', 'SMA', 'EMA', 'RSI', 'MACD', 'BOLLINGER'],
    conditions: { operators: ['GT', 'LT', 'CROSSES_ABOVE', 'CROSSES_BELOW'], entry: '1-5 conditions joined by AND', exit: '0-5 conditions joined by OR' },
    historicalFeatures: ['fixed stops/targets', 'trailing stops', 'partial profit exits', 'pyramiding', 'explicit date ranges', 'cost/spread/volume scenarios', 'saved run and exact replay', 'walk-forward on imported data', 'candidate comparison', 'historical quote portfolio order replay'],
    selectionObjectives: ['total_return (default)', 'min_drawdown (candle-close drawdown)', 'sharpe', 'sortino'],
    liveFeatures: ['start', 'inspect', 'pause', 'resume', 'stop', 'endTime or durationMinutes', 'optional closePositionAtEnd', 'virtual account performance'],
    unsupported: ['arbitrary Python/Pine or custom indicators', 'multiple symbols/timeframes in an indicator strategy', 'nested Boolean rules', 'time-of-day entry conditions', 'news/sentiment rules', 'automatic options strike/Greek selection', 'scheduled future start of a live test', 'real-money orders'],
    liveStrategyLimits: 'LONG, one position, fixed stops/targets and indicator exits. No SHORT, pyramiding, trailing or partial exits. No future backtest results.',
    limits: { candlesPerSavedRun: LIMITS.maxCandles, candlesPerPreview: LIMITS.maxPreviewCandles, minimumCandles: LIMITS.minCandles, activeHistoricalRuns: 3, activeResearchRuns: 3, researchCandidates: 8, walkForwardWindows: 10 },
    historicalDefaults: { initialCapital: DEFAULTS.initialCapital, commissionPercent: DEFAULTS.commissionPercent, slippageTicks: DEFAULTS.slippageTicks, positionSizing: 'from strategy', candleCount: DEFAULTS.lookbackCandles },
    fidelity: 'Candle fills follow a declared OHLC path. Quote replay uses observed bid/ask and displayed size, without queue position. SHORT simulation does not model borrow/funding. Required unavailable data must cause an explicit error.',
  } }));
  add('resolve_backtest_period', 'Convert requested calendar dates in the user’s IANA timezone into exact UTC bounds, including daylight-saving changes. Use for date-only requests rather than estimating offsets. This resolves dates only; available history is checked when running. For through-now requests use the actual current timestamp instead of a future day boundary.', z.strictObject({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().min(1).max(100).describe('User timezone from the system context unless the user explicitly specifies another'),
    endDateInclusive: z.boolean().default(true),
  }), async args => {
    try { return { result: resolveResearchPeriod(args) }; }
    catch (error) { throw new ToolInputError(error instanceof Error ? error.message : 'Invalid calendar period.'); }
  });

  if (deps.research) {
    const { gateway: g, userId } = deps.research;
    add('list_strategies', 'List this user’s saved strategies and latest version numbers. Use get_strategy to obtain the immutable version identifier and exact definition before pinning it.', page, async args => ({ result: await g.strategies(userId, args) }));
    add('get_strategy', 'Read this user’s full saved strategy definition before testing or changing it.', z.strictObject({ strategyId: uuid }), async ({ strategyId }) => ({ result: await g.strategy(userId, strategyId) }));
    add('run_backtest', 'Backtest supported rules on real historical closed candles for requested dates and timeframe. Default saved mode queues a persistent run and returns its id/status, not completed metrics. Preview is optional and limited to 3,000 bars. Specify capital, fees, slippage, spread, participation and sampling statistics when requested. Use one saved strategyId, current draftId or full definition. Never invent missing market history.', runSchema, async args => mutate('run_backtest', args, async () => {
      let draft: { name: string; definition: unknown } | undefined;
      if (args.draftId) {
        const prior = deps.drafts.get(args.draftId);
        if (!prior) throw new ToolInputError('Unknown draftId. Use a saved strategyId or provide the complete definition from the conversation.');
        draft = { name: args.name ?? prior.name, definition: prior.definition };
      } else if (args.definition) draft = normalizeDraft({ name: args.name ?? 'Historical strategy', definition: args.definition }) as typeof draft;
      if (args.mode === 'preview') {
        if (!deps.preview) throw new ToolInputError('Preview is unavailable; use saved mode.');
        if (args.candles && args.candles > LIMITS.maxPreviewCandles) throw new ToolInputError('Preview supports at most 3,000 candles. Use saved mode for this request.');
        if (args.strategyId) {
          if (args.strategyVersionId) throw new ToolInputError('Use saved mode to pin an exact strategy version.');
          const saved = await g.strategy(userId, args.strategyId) as any;
          draft = { name: args.name ?? saved.name, definition: saved.definition };
        }
        const value = await deps.preview.gateway.preview(userId, { ...draft!, candles: args.candles, range: args.range, market: args.market, settings: args.settings, riskStatistics: args.riskStatistics });
        return { result: { ...value, saved: false, trades: value.trades.slice(-10), equityCurve: undefined }, blocks: [{ type: 'backtest_result', data: { ...value, saved: false, trades: value.trades.slice(-25) } }] };
      }
      const input = historicalRunSchema.parse({ strategyId: args.strategyId, strategyVersionId: args.strategyVersionId, draft, market: args.market, range: args.range, candles: args.candles, settings: args.settings, riskStatistics: args.riskStatistics });
      const run = await g.create(userId, input);
      return { result: run, blocks: [runCard('backtest', run)] };
    }, true));
    add('get_backtest', 'Read current status and engine-computed results of an owned saved backtest. Pending/running has no performance yet. Request paginated trades or a bounded equity curve for detail.', z.strictObject({ id: uuid, section: z.enum(['summary', 'trades', 'equity']).default('summary'), limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().nonnegative().default(0) }), async ({ id, section, limit, offset }) => {
      if (section === 'trades') return { result: await g.trades(userId, id, { limit, offset }) };
      if (section === 'equity') return { result: await g.equity(userId, id, { maxPoints: 200 }) };
      const run = await g.get(userId, id);
      return { result: run, blocks: [runCard('backtest', run)] };
    });
    add('list_backtests', 'Find this user’s recent saved backtests, including work from previous messages.', z.strictObject({ limit: z.number().int().min(1).max(20).default(10), before: z.string().datetime({ offset: true }).optional(), status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(), strategyId: uuid.optional() }), async args => ({ result: await g.list(userId, args) }));
    add('manage_backtest', 'Cancel an owned queued/running backtest or replay its archived input with the pinned engine. Perform only when the user requests that action.', z.strictObject({ id: uuid, action: z.enum(['cancel', 'replay']) }), async args => mutate('manage_backtest', args, async () => {
      const run = await (args.action === 'cancel' ? g.cancel(userId, args.id) : g.replay(userId, args.id));
      return { result: run, blocks: [runCard('backtest', run)] };
    }, args.action === 'replay'));
    add('list_backtest_datasets', 'Discover the user’s actual imported historical data before proposing NSE/BSE/options or research tests. Never assume an unavailable dataset exists.', z.strictObject({}), async () => ({ result: await g.datasets(userId) }));
    add('inspect_backtest_dataset', 'Inspect owned dataset provenance, instruments, available periods/timeframes and market-model input coverage, without returning all rows. Filter an instrument or paginate when needed.', datasetMetadataSchema.extend({ datasetId: uuid }), async ({ datasetId, ...options }) => ({ result: await g.dataset(userId, datasetId, options) }));
    add('import_backtest_dataset', 'Import a historical dataset explicitly supplied by the user, preserving exact sourced values and provenance. Never generate, fabricate or infer historical quotes, fees, margins or calendars. Large files should use the Research workspace upload/import.', z.strictObject({ dataset: z.record(z.string(), z.unknown()) }), async ({ dataset }) => mutate('import_backtest_dataset', dataset, async () => ({ result: await g.importDataset(userId, dataset) })));
    add('run_research', 'Queue research using an existing owned imported dataset: single candle strategy; walk_forward with 1-8 explicit candidates, train/test windows and objective total_return, min_drawdown, sharpe or sortino; or options for timestamped multi-leg quote order replay. Ratio objectives require explicit riskStatistics. Inspect the dataset first. Use exact user rules; quote replay is not an automatic options selection algorithm. Returns pending status, never invented performance.', researchExperimentSchema, async args => mutate('run_research', args, async () => {
      const run = await g.createExperiment(userId, args);
      return { result: run, blocks: [runCard('experiment', run)] };
    }, true));
    add('get_research', 'Read an owned experiment’s current status, compact actual results, out-of-sample windows, warnings and execution assumptions.', z.strictObject({ id: uuid }), async ({ id }) => { const run = await g.getExperiment(userId, id); return { result: run, blocks: [runCard('experiment', run)] }; });
    add('list_research', 'List the user’s recent historical research experiments.', z.strictObject({}), async () => ({ result: await g.listExperiments(userId) }));
    add('cancel_research', 'Cancel a pending/running owned research experiment when requested.', z.strictObject({ id: uuid }), async args => mutate('cancel_research', args, async () => { const run = await g.cancelExperiment(userId, args.id); return { result: run, blocks: [runCard('experiment', run)] }; }));
  }

  if (deps.liveTesting) {
    const { gateway: g, userId } = deps.liveTesting;
    add('list_paper_accounts', 'List this user’s virtual accounts for forward testing on live data.', livePageSchema, async args => ({ result: await g.listAccounts(userId, args) }));
    add('create_paper_account', 'Create a virtual account with explicitly requested simulated capital. No deposit or real trading occurs.', liveAccountSchema, async args => mutate('create_paper_account', args, async () => ({ result: await g.createAccount(userId, args) })));
    add('start_live_test', 'Start virtual paper testing now on future live Binance candles, ONLY when requested. Requires an owned saved strategy/full draft and owned account or explicit new-account capital. Honor candle timeframe and optional endTime or durationMinutes (maximum 365 days). Future scheduled starts are unsupported. Deadline blocks new strategy orders; status updates on the running worker sweep. Positions stay open unless closePositionAtEnd is explicitly requested; stale quotes may prevent closure. Never use for historical backtesting or silently simplify unsupported rules.', liveStartSchema, async args => mutate('start_live_test', args, async () => { const run = await g.start(userId, args); return { result: run, blocks: [runCard('paper', run)] }; }, true));
    add('get_live_test', 'Read the current owned live paper instance and recent actual signals. Future outcomes are unavailable; virtual portfolio performance is available through get_paper_account.', z.strictObject({ id: uuid }), async ({ id }) => { const run = await g.get(userId, id); return { result: run, blocks: [runCard('paper', run)] }; });
    add('list_live_tests', 'Find this user’s live/paused/stopped virtual strategy instances.', liveListSchema, async args => ({ result: await g.list(userId, args) }));
    add('control_live_test', 'Pause, resume or stop an owned virtual strategy when requested. Stopping leaves its position open unless closePosition=true is explicitly requested. These actions cannot place real orders.', liveControlSchema, async args => {
      const key = JSON.stringify(canonical(args)), previous = lastControl.get(args.instanceId);
      if (previous && previous !== key) mutations.delete(`control_live_test:${previous}`);
      lastControl.set(args.instanceId, key);
      return mutate('control_live_test', args, async () => { const run = await g.control(userId, args); return { result: run, blocks: [runCard('paper', run)] }; });
    });
    add('get_paper_account', 'Read owned virtual account valuation/performance, positions, orders, trades or ledger. Account performance may include more than one strategy; do not attribute the entire account to one instance.', liveAccountReportSchema, async args => ({ result: await g.account(userId, args) }));
  }
  return tools;
}
