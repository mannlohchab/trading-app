import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { call, done, text } from '../helpers/fake-ai';
import { createTestApp } from '../helpers/test-app';
import { activeUser } from '../helpers/users';
import { definition, recentWalk, seedCandles } from '../backtesting/fixtures';

let t: Awaited<ReturnType<typeof createTestApp>>;
let u: Awaited<ReturnType<typeof activeUser>>;
let backtestId: string;
beforeAll(async () => {
  t = await createTestApp();
  await t.market.catalog.sync('BINANCE');
  u = await activeUser(t);
  await seedCandles(t, recentWalk(t, 1500));
  const strategy = (await u.c.post('/api/v1/strategies', { name: 'EMA cross', definition: definition() })).body;
  const created = await u.c.post('/api/v1/backtests', { strategyId: strategy.id });
  expect(created.status).toBe(202);
  backtestId = created.body.id;
});
afterAll(() => t.close());

const ask = async (content: string) => {
  const id = (await u.c.post('/api/v1/ai/conversations', {})).body.id as string;
  return u.c.post(`/api/v1/ai/conversations/${id}/messages`, { content, stream: false });
};
const toolErrors = (i: number) => t.model.requests[i]!.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content as string).error).filter(Boolean);

describe('suggest_next_steps', () => {
  test('buttons sent with the answer end the turn without another model round', async () => {
    t.model.script([
      text('Your EMA cross backtest is queued.'),
      call('suggest_next_steps', { actions: [
        { kind: 'open', label: 'Open backtest results', screen: 'backtest_result', id: backtestId },
        { kind: 'open', label: 'BTC 4h chart', screen: 'instrument', symbol: 'btcusdt', timeframe: '4h' },
        { kind: 'ask', label: 'Try it on ETH', prompt: 'Backtest the same strategy on ETHUSDT' },
      ] }),
      done(100, 20, 'tool_calls'),
    ]);
    const res = await ask('Backtest my EMA cross');
    expect(res.status).toBe(201);
    expect(t.model.requests).toHaveLength(1);
    const reply = res.body.assistantMessage;
    expect(reply.content).toBe('Your EMA cross backtest is queued.');
    expect(reply.metadata.finishReason).toBe('stop');
    expect(reply.metadata.blocks.map((b: any) => b.type)).toEqual(['markdown', 'actions', 'disclaimer']);
    expect(reply.metadata.blocks[1].items).toEqual([
      { kind: 'open', label: 'Open backtest results', target: { screen: 'backtest_result', id: backtestId } },
      { kind: 'open', label: 'BTC 4h chart', target: { screen: 'instrument', symbol: 'BTCUSDT', timeframe: '4h' } },
      { kind: 'ask', label: 'Try it on ETH', prompt: 'Backtest the same strategy on ETHUSDT' },
    ]);
    // The snapshot now knows about the queued run.
    expect(t.model.requests[0]!.messages[0]!.content).toContain('- Recent backtests: "EMA cross" on BTCUSDT 1h, pending.');
  });

  test('called before the answer, the model still gets a round to write it', async () => {
    t.model.script(
      [call('suggest_next_steps', { actions: [{ kind: 'open', label: 'Open Calendar', screen: 'calendar' }] }), done(100, 10, 'tool_calls')],
      [text('The calendar lists this week\'s events.'), done()],
    );
    const res = await ask('Where are economic events?');
    expect(t.model.requests).toHaveLength(2);
    expect(res.body.assistantMessage.content).toBe('The calendar lists this week\'s events.');
    expect(res.body.assistantMessage.metadata.blocks.find((b: any) => b.type === 'actions').items).toEqual([{ kind: 'open', label: 'Open Calendar', target: { screen: 'calendar' } }]);
  });

  test('made-up pairs, guessed ids and other users\' runs are refused', async () => {
    const stranger = await activeUser(t);
    const strangerStrategy = (await stranger.c.post('/api/v1/strategies', { name: 'Theirs', definition: definition() })).body;
    const theirs = (await stranger.c.post('/api/v1/backtests', { strategyId: strangerStrategy.id })).body.id as string;

    t.model.script(
      [call('suggest_next_steps', { actions: [{ kind: 'open', label: 'Chart', screen: 'instrument', symbol: 'NOPEUSDT' }] }, 'a'), done(100, 10, 'tool_calls')],
      [call('suggest_next_steps', { actions: [{ kind: 'open', label: 'Results', screen: 'backtest_result', id: theirs }] }, 'b'), done(100, 10, 'tool_calls')],
      [call('suggest_next_steps', { actions: [{ kind: 'open', label: 'Live test', screen: 'live_test', id: 'draft-1' }] }, 'c'), done(100, 10, 'tool_calls')],
      [call('suggest_next_steps', { actions: [{ kind: 'ask', label: 'More' }] }, 'd'), done(100, 10, 'tool_calls')],
      [text('Done.'), done()],
    );
    const res = await ask('Show me buttons');
    expect(res.status).toBe(201);
    const errors = toolErrors(4);
    expect(errors[0]).toContain('NOPEUSDT is not a listed BINANCE pair');
    expect(errors[1]).toContain('Do not guess ids');
    expect(errors[2]).toContain('Do not guess ids');
    expect(errors[3]).toContain('ask needs a prompt');
    expect(res.body.assistantMessage.metadata.blocks.map((b: any) => b.type)).toEqual(['markdown', 'disclaimer']);
  });

  test('only one set of buttons per answer', async () => {
    const buttons = { actions: [{ kind: 'open', label: 'Open news', screen: 'news' }] };
    t.model.script(
      [call('suggest_next_steps', buttons, 'a'), done(100, 10, 'tool_calls')],
      [call('suggest_next_steps', buttons, 'b'), done(100, 10, 'tool_calls')],
      [text('Here you go.'), done()],
    );
    const res = await ask('News?');
    expect(toolErrors(2)).toEqual(['Next steps were already shown in this answer.']);
    expect(res.body.assistantMessage.metadata.blocks.filter((b: any) => b.type === 'actions')).toHaveLength(1);
  });
});
