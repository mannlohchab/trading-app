import { expect, test } from 'bun:test';
import { createResearchTools } from '../../src/modules/ai/application/research-tools';
import { createTools, type BacktestGateway, type MarketGateway, type StrategyDraftChecker } from '../../src/modules/ai/application/tools';
import type { BacktestResearchGateway } from '../../src/modules/ai/infrastructure/backtest-research.gateway';
import type { LiveTestingGateway } from '../../src/modules/ai/infrastructure/live-testing.gateway';
import { strategyDefinitionSchema, validateStrategyDraft } from '../../src/modules/strategies/domain/definition';
import { definition } from '../backtesting/fixtures';

const userId = 'authenticated-user';
const strategyId = '00000000-0000-4000-8000-000000000001';
const versionId = '00000000-0000-4000-8000-000000000002';
const accountId = '00000000-0000-4000-8000-000000000003';
const runId = '00000000-0000-4000-8000-000000000004';
const datasetId = '00000000-0000-4000-8000-000000000005';
const def = strategyDefinitionSchema.parse(definition());
const draft = { name: 'Research EMA', definition: def, summary: ['Real rules'] };
const market: MarketGateway = { exchange: 'BINANCE', async searchSymbols() { return []; }, async tickers() { return []; }, async topMovers() { return []; }, async analyze() { return { summary: null, source: 'store' }; }, async candles() { return { candles: [], source: 'store' }; } };
const checker: StrategyDraftChecker = { async validate(input) { const checked = validateStrategyDraft(input); return checked.ok ? { ...checked, summary: [] } : checked; } };

function fixture() {
  const calls: { method: string; user: string; args: unknown[] }[] = [];
  let paperStatus = 'CREATED';
  const record = (method: string, value: unknown = {}) => async (user: string, ...args: unknown[]) => { calls.push({ method, user, args }); return value; };
  const run = { id: runId, status: 'PENDING', strategy: { name: draft.name }, market: def.market, range: { start: 1, end: 2 } };
  const research = {
    create: record('create', run), get: record('get', run), list: record('list', { backtests: [] }),
    trades: record('trades', { trades: [] }), equity: record('equity', { points: [] }), cancel: record('cancel', { ...run, status: 'CANCELLED' }), replay: record('replay', run),
    strategies: record('strategies', { items: [] }), strategy: record('strategy', { id: strategyId, ...draft }),
    datasets: record('datasets', { datasets: [] }), dataset: record('dataset'), importDataset: record('importDataset'),
    createExperiment: record('createExperiment', { id: runId, status: 'PENDING', kind: 'single' }),
    getExperiment: record('getExperiment', { id: runId, status: 'COMPLETED', result: null }), listExperiments: record('listExperiments', { experiments: [] }), cancelExperiment: record('cancelExperiment', { id: runId, status: 'CANCELLED' }),
  } as unknown as BacktestResearchGateway;
  const live = {
    listAccounts: record('listAccounts', { accounts: [] }), createAccount: record('createAccount', { id: accountId }),
    start: record('start', { id: runId, status: paperStatus, accountId, symbol: 'BTCUSDT', timeframe: '1h' }),
    get: record('liveGet', { id: runId, status: paperStatus }), list: record('liveList', { strategies: [] }), account: record('account'),
    control: async (user: string, args: { action: 'pause' | 'resume' | 'stop' }) => { calls.push({ method: 'control', user, args: [args] }); paperStatus = { pause: 'PAUSED', resume: 'RUNNING', stop: 'STOPPED' }[args.action]; return { id: runId, status: paperStatus }; },
  } as unknown as LiveTestingGateway;
  const preview = { preview: record('preview', { market: def.market, range: { start: 1, end: 2 }, metrics: { totalTrades: 0 }, warnings: [], trades: [], equityCurve: [], engine: { name: 'fixture', version: '1' }, dataset: { candles: 100 } }) } as unknown as BacktestGateway;
  const drafts = new Map([['draft-1', draft]]);
  const tools = createResearchTools({ research: { gateway: research, userId }, liveTesting: { gateway: live, userId }, preview: { gateway: preview, userId }, drafts });
  const tool = (name: string) => { const found = tools.find(t => t.spec.name === name); if (!found) throw new Error(`Missing ${name}`); return found; };
  return { calls, research, live, preview, drafts, tools, tool, status: () => paperStatus };
}

test('all composed tool schemas serialize and every local schema reference resolves', () => {
  const f = fixture();
  const tools = createTools(market, checker, undefined, { gateway: f.preview, userId }, { gateway: f.research, userId }, { gateway: f.live, userId });
  const names = tools.map(t => t.spec.name);
  expect(names.filter(n => n === 'run_backtest')).toHaveLength(1);
  expect(new Set(names).size).toBe(names.length);
  expect(names).toContain('start_live_test');
  expect(names).toContain('run_research');
  for (const tool of tools) {
    const schema = JSON.parse(JSON.stringify(tool.spec.parameters));
    const inspect = (v: unknown) => {
      if (!v || typeof v !== 'object') return;
      const ref = (v as { $ref?: string }).$ref;
      if (ref) {
        expect(ref.startsWith('#/')).toBe(true);
        let target: any = schema;
        for (const key of ref.slice(2).split('/').map(k => k.replace(/~1/g, '/').replace(/~0/g, '~'))) target = target?.[key];
        expect(target).toBeDefined();
      }
      for (const child of Object.values(v)) inspect(child);
    };
    inspect(schema);
  }
});

test('historical requests preserve timezone instants, exact money, version, timeframe and execution settings', async () => {
  const f = fixture();
  const result = await f.tool('run_backtest').run({ strategyId, strategyVersionId: versionId, market: { timeframe: '15m' }, range: { start: '2026-01-01T09:15:00+05:30', end: '2026-02-01T15:30:00+05:30' }, settings: { initialCapital: '12345.123456789012', commissionPercent: 0, slippageTicks: 3, positionSizing: { type: 'cash', value: '500.01' }, execution: { spreadTicks: 2, maxVolumeParticipationPercent: '5' } }, riskStatistics: { periodsPerYear: 8760, annualRiskFreeRate: 0.05 } });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toMatchObject({ method: 'create', user: userId, args: [{ strategyId, strategyVersionId: versionId, market: { timeframe: '15m' }, range: { start: Date.parse('2026-01-01T09:15:00+05:30'), end: Date.parse('2026-02-01T15:30:00+05:30') }, settings: { initialCapital: '12345.123456789012', commissionPercent: '0', slippageTicks: 3, positionSizing: { type: 'cash', value: '500.01' }, execution: { spreadTicks: 2, maxVolumeParticipationPercent: '5' } }, riskStatistics: { periodsPerYear: 8760, annualRiskFreeRate: 0.05 } }] });
  expect(result.blocks?.[0]).toMatchObject({ type: 'research_run', data: { id: runId, status: 'PENDING', kind: 'backtest' } });
  expect(result.result).not.toHaveProperty('metrics');
});

test('draft references and preview mode route to the selected engine without losing parameters', async () => {
  const f = fixture();
  await f.tool('run_backtest').run({ mode: 'preview', draftId: 'draft-1', candles: 3000, settings: { initialCapital: '5000', commissionPercent: '0.02' }, market: { timeframe: '5m' } });
  expect(f.calls).toEqual([{ method: 'preview', user: userId, args: [{ name: draft.name, definition: def, candles: 3000, range: undefined, settings: { initialCapital: '5000', commissionPercent: '0.02' }, market: { timeframe: '5m' }, riskStatistics: undefined }] }]);
  await expect(f.tool('run_backtest').run({ mode: 'preview', draftId: 'draft-1', candles: 3001 })).rejects.toThrow('3,000');
  await expect(f.tool('run_backtest').run({ mode: 'preview', draftId: 'draft-1', candles: 100, range: { start: 1000, end: 2000 } })).rejects.toThrow();
  await expect(f.tool('run_backtest').run({ strategyId, draftId: 'draft-1' })).rejects.toThrow('exactly one');
  expect(f.calls).toHaveLength(1);
});

test('identical concurrent creation calls are deduplicated and their card is emitted only once', async () => {
  const f = fixture();
  const args = { strategyId, candles: 500 };
  const results = await Promise.all([f.tool('run_backtest').run(args), f.tool('run_backtest').run({ candles: 500, strategyId })]);
  expect(f.calls.filter(c => c.method === 'create')).toHaveLength(1);
  expect(results.reduce((n, r) => n + (r.blocks?.length ?? 0), 0)).toBe(1);
  expect(results[0]!.result).toEqual(results[1]!.result);
});

test('new-run budget is shared across historical, research and live starts', async () => {
  const f = fixture();
  await f.tool('run_backtest').run({ strategyId, candles: 500 });
  await f.tool('run_research').run({ kind: 'single', datasetId, instrumentId: 'instrument', timeframe: '1h', range: { start: 1, end: 2 }, definitions: [def] });
  await f.tool('start_live_test').run({ strategyId, accountId });
  await expect(f.tool('run_backtest').run({ strategyId, candles: 600 })).rejects.toThrow('At most three');
  expect(f.calls.filter(c => ['create', 'createExperiment', 'start'].includes(c.method))).toHaveLength(3);
});

test('scoped reads cannot accept a model-supplied user id or exceed pagination bounds', async () => {
  const f = fixture();
  await f.tool('get_backtest').run({ id: runId, section: 'trades', limit: 7, offset: 14 });
  await f.tool('get_paper_account').run({ accountId, section: 'orders', limit: 5, offset: 10 });
  expect(f.calls).toEqual([{ method: 'trades', user: userId, args: [runId, { limit: 7, offset: 14 }] }, { method: 'account', user: userId, args: [{ accountId, section: 'orders', limit: 5, offset: 10 }] }]);
  await expect(f.tool('get_backtest').run({ id: runId, userId: 'someone-else' })).rejects.toThrow();
  await expect(f.tool('get_paper_account').run({ accountId, limit: 51 })).rejects.toThrow();
  expect(f.calls).toHaveLength(2);
});

test('quote replay preserves explicitly supplied order times, legs and execution assumptions', async () => {
  const f = fixture();
  await f.tool('run_research').run({ kind: 'options', datasetId, execution: { start: '2026-01-01T09:15:00+05:30', end: '2026-01-01T15:30:00+05:30', initialCapital: '100000', latencyMs: 50, orders: [{ id: 'spread-1', time: '2026-01-01T09:20:00+05:30', legs: [{ instrumentId: 'call-1', side: 'BUY', lots: 2 }, { instrumentId: 'call-2', side: 'SELL', lots: 2 }], timeInForce: 'FOK', limitNetDebit: '3000' }] } });
  expect(f.calls[0]).toMatchObject({ method: 'createExperiment', user: userId, args: [{ kind: 'options', datasetId, execution: { start: Date.parse('2026-01-01T09:15:00+05:30'), end: Date.parse('2026-01-01T15:30:00+05:30'), initialCapital: '100000', latencyMs: 50, orders: [{ id: 'spread-1', time: Date.parse('2026-01-01T09:20:00+05:30'), timeInForce: 'FOK', limitNetDebit: '3000', legs: [{ instrumentId: 'call-1', side: 'BUY', lots: 2 }, { instrumentId: 'call-2', side: 'SELL', lots: 2 }] }] } }] });
});

test('a repeated pause after an intervening resume applies the latest requested state', async () => {
  const f = fixture();
  await f.tool('control_live_test').run({ instanceId: runId, action: 'pause' });
  await f.tool('control_live_test').run({ instanceId: runId, action: 'resume' });
  const paused = await f.tool('control_live_test').run({ instanceId: runId, action: 'pause' });
  expect(f.status()).toBe('PAUSED');
  expect(f.calls.filter(c => c.method === 'control')).toHaveLength(3);
  expect(paused.result).toMatchObject({ status: 'PAUSED' });
});
