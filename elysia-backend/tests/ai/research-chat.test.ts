import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { backtestJobs, paperStrategyInstances } from '../../src/db/schema';
import { AiProviderError } from '../../src/modules/ai';
import { historyContent, toolResultContent } from '../../src/modules/ai/domain/tool-context';
import { QUEUE } from '../../src/modules/backtesting/backtesting.constants';
import { JobRunner } from '../../src/modules/system/jobs';
import { createTestApp } from '../helpers/test-app';
import { activeUser } from '../helpers/users';
import { call, done, text } from '../helpers/fake-ai';
import { definition, recentWalk, seedCandles } from '../backtesting/fixtures';

let t: Awaited<ReturnType<typeof createTestApp>>;
let u: Awaited<ReturnType<typeof activeUser>>;
let conversationId: string;
let runId: string;
let strategyId: string;
let range: { start: number; end: number };
const ask = (content: string) => u.c.post(`/api/v1/ai/conversations/${conversationId}/messages`, { content, stream: false });
beforeAll(async () => {
  t = await createTestApp();
  await t.market.catalog.sync('BINANCE');
  u = await activeUser(t);
  const bars = recentWalk(t, 1600);
  await seedCandles(t, bars);
  range = { start: bars[300]!.openTime, end: bars[1300]!.openTime };
  conversationId = (await u.c.post('/api/v1/ai/conversations', {})).body.id;
});
afterAll(async () => {
  await t.backtesting.workers.dispose();
  await t.backtesting.signalWorkers.dispose();
  await t.backtesting.portfolio.dispose();
  await t.close();
});

test('chat queues one saved dated run despite duplicate model calls, then exposes the real completed result', async () => {
  const args = { name: 'Chat historical EMA', definition: definition(), range: { start: new Date(range.start).toISOString(), end: new Date(range.end).toISOString() },
    settings: { initialCapital: '12345', commissionPercent: '0.07', slippageTicks: 2, positionSizing: { type: 'percent_of_equity', value: '12' } } };
  t.model.script([call('run_backtest', args, 'one'), call('run_backtest', args, 'duplicate'), done()], req => {
    const results = req.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe(results[1].id);
    expect(results[0].status).toBe('PENDING');
    expect(results[0].summary).toBeNull();
    expect(results[0].range).toEqual(range);
    runId = results[0].id;
    strategyId = results[0].strategy.id;
    return [text('Your dated historical test is queued; the card will update.'), done()];
  });
  const res = await ask('Run and save the EMA strategy for these historical dates with 12345 virtual capital and 0.07% fees.');
  expect(res.status).toBe(201);
  const cards = res.body.assistantMessage.metadata.blocks.filter((b: any) => b.type === 'research_run');
  expect(cards).toHaveLength(1);
  expect(cards[0].data).toMatchObject({ kind: 'backtest', id: runId, status: 'PENDING', range });
  const rows = await t.db.select().from(backtestJobs).where(eq(backtestJobs.userId, u.user.id));
  expect(rows).toHaveLength(1);
  expect((rows[0]!.configuration as any).settings).toMatchObject(args.settings);
  const runner = new JobRunner({ queue: t.backtesting.queue, handlers: [t.backtesting.jobHandler], workerId: 'ai-chat', leaseMs: QUEUE.leaseMs });
  await runner.tick();
  t.model.script(req => {
    expect(req.messages.filter(m => m.role === 'assistant').some(m => m.content?.includes(runId))).toBe(true);
    return [call('get_backtest', { id: runId }), done()];
  }, req => {
    const result = JSON.parse(req.messages.at(-1)!.content!);
    expect(result.status).toBe('COMPLETED');
    expect(result.summary.totalTrades).toBeGreaterThan(0);
    expect(result.dataset.candles).toBe(1000);
    expect(result.assumptions.intrabarPath).toContain('assumed');
    return [text('The engine has completed your test.'), done()];
  });
  const followup = await ask('How did that test perform?');
  expect(followup.status).toBe(201);
  expect(followup.body.assistantMessage.metadata.blocks.find((b: any) => b.type === 'research_run').data.status).toBe('COMPLETED');
});

test('a created run remains discoverable if the model fails before writing any prose', async () => {
  conversationId = (await u.c.post('/api/v1/ai/conversations', {})).body.id;
  t.model.script([call('run_backtest', { strategyId, candles: 300 }), done()], new AiProviderError('AI_PROVIDER_ERROR', 'Synthetic interruption', false));
  const res = await ask('Save another test of the same strategy over 300 candles.');
  expect(res.status).toBe(502);
  const conversation = (await u.c.get(`/api/v1/ai/conversations/${conversationId}/messages`)).body;
  const assistant = conversation.messages.find((m: any) => m.role === 'ASSISTANT');
  expect(assistant.metadata.interrupted).toBe(true);
  const card = assistant.metadata.blocks.find((b: any) => b.type === 'research_run');
  expect(card.data.status).toBe('PENDING');
  expect((await u.c.get(`/api/v1/backtests/${card.data.id}`)).body.status).toBe('PENDING');
  await t.backtesting.service.cancel(u.user.id, card.data.id);
});

test('chat starts and controls virtual live testing without placing historical orders', async () => {
  conversationId = (await u.c.post('/api/v1/ai/conversations', {})).body.id;
  let instanceId = '';
  t.model.script([call('start_live_test', { strategyId, newAccount: { name: 'Chat virtual account', initialBalance: '2500' }, timeframe: '15m' }), done()], req => {
    const result = JSON.parse(req.messages.at(-1)!.content!);
    expect(result).toMatchObject({ status: 'CREATED', simulated: true, executionMode: 'PAPER_LIVE', timeframe: '15m' });
    instanceId = result.id;
    return [text('Your virtual live test is submitted.'), done()];
  });
  const res = await ask('Start this strategy on live 15-minute candles in a new virtual account with 2500 USDT.');
  expect(res.status).toBe(201);
  expect(res.body.assistantMessage.metadata.blocks.find((b: any) => b.type === 'research_run').data).toMatchObject({ kind: 'paper', id: instanceId, status: 'CREATED' });
  expect(await t.db.select().from(paperStrategyInstances).where(eq(paperStrategyInstances.id, instanceId))).toHaveLength(1);
  t.model.script([call('control_live_test', { instanceId, action: 'stop' }), done()], req => {
    expect(JSON.parse(req.messages.at(-1)!.content!).status).toBe('STOPPED');
    return [text('The virtual test has stopped.'), done()];
  });
  expect((await ask('Stop that virtual test.')).status).toBe(201);
});

test('unsupported rules are rejected without silently dropping them or creating a run', async () => {
  const before = await t.db.select({ id: backtestJobs.id }).from(backtestJobs).where(eq(backtestJobs.userId, u.user.id));
  const unsupported = definition();
  (unsupported.entry as any).timeOfDay = '09:20';
  t.model.script([call('run_backtest', { name: 'Unsupported time rule', definition: unsupported }), done()], req => {
    expect(JSON.parse(req.messages.at(-1)!.content!).error).toContain('timeOfDay');
    return [text('Time-of-day entry rules are not supported; the strategy was not run.'), done()];
  });
  const res = await ask('Use this exact strategy including entry only at 09:20.');
  expect(res.status).toBe(201);
  expect(res.body.assistantMessage.metadata.blocks.some((b: any) => b.type === 'research_run')).toBe(false);
  expect(await t.db.select({ id: backtestJobs.id }).from(backtestJobs).where(eq(backtestJobs.userId, u.user.id))).toHaveLength(before.length);
});

test('oversized tool results stay valid JSON and retain status instead of cutting through JSON syntax', () => {
  const encoded = toolResultContent({ id: 'known-run', status: 'COMPLETED', summary: { netProfit: '123.45' }, trades: Array.from({ length: 2000 }, (_, i) => ({ id: i, notes: '\u0001"\\'.repeat(1000) })) });
  expect(encoded.length).toBeLessThanOrEqual(24000);
  const parsed = JSON.parse(encoded);
  expect(parsed.truncated).toBe(true);
  expect(parsed.preview).toMatchObject({ id: 'known-run', status: 'COMPLETED', summary: { netProfit: '123.45' } });
  expect(parsed.notice).toContain('omitted');
});

test('history retains saved references and unsaved definitions but never replays stale performance', () => {
  const output = historyContent('Submitted.', { blocks: [
    { type: 'research_run', data: { kind: 'backtest', id: 'run', status: 'PENDING', title: 'EMA', summary: { netProfit: '99999' } } },
    { type: 'strategy_draft', draftId: 'draft-1', draft: { name: 'Draft', definition: definition() }, summary: [] },
  ] });
  expect(output).toContain('"id":"run"');
  expect(output).toContain('unsaved_strategy');
  expect(output).toContain('CROSSES_ABOVE');
  expect(output).not.toContain('99999');
});
