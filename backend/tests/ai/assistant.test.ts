import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { aiUsageEvents, messages, strategies } from '../../src/db/schema';
import { AiProviderError } from '../../src/modules/ai';
import { call, done, text } from '../helpers/fake-ai';
import { candle } from '../helpers/fake-market';
import { client, createTestApp } from '../helpers/test-app';
import { activeUser, pendingUser } from '../helpers/users';

let t: Awaited<ReturnType<typeof createTestApp>>;
let c: Awaited<ReturnType<typeof activeUser>>['c'];
beforeAll(async () => {
  t = await createTestApp();
  await t.market.catalog.sync('BINANCE');
  ({ c } = await activeUser(t));
});
afterAll(() => t.close());

const newConversation = async (http = c) => (await http.post('/api/v1/ai/conversations', {})).body.id as string;
const ask = (id: string, content: string, extra: object = {}, http = c) =>
  http.post(`/api/v1/ai/conversations/${id}/messages`, { content, stream: false, ...extra });

const strategyDraft = (symbol = 'BTCUSDT') => ({
  name: 'RSI dip buyer',
  description: 'Buy oversold dips in an uptrend',
  definition: {
    market: { exchange: 'BINANCE', symbol, timeframe: '4h' },
    direction: 'LONG',
    entry: { conditions: [{ left: { type: 'RSI', period: 14 }, operator: 'CROSSES_ABOVE', right: { type: 'VALUE', value: 30 } }, { left: { type: 'PRICE' }, operator: 'GT', right: { type: 'SMA', period: 200 } }] },
    exit: { conditions: [{ left: { type: 'RSI', period: 14 }, operator: 'GT', right: { type: 'VALUE', value: 70 } }], stopLossPercent: 5, takeProfitPercent: 12 },
    risk: { positionSizePercent: 10 },
  },
});

describe('conversations', () => {
  test('create, list, rename, archive, delete; others cannot see them', async () => {
    const id = await newConversation();
    expect((await c.get('/api/v1/ai/conversations')).body.conversations.map((x: any) => x.id)).toContain(id);
    expect((await c.patch(`/api/v1/ai/conversations/${id}`, { title: 'BTC questions' })).body.title).toBe('BTC questions');
    expect((await c.patch(`/api/v1/ai/conversations/${id}`, { status: 'ARCHIVED' })).body.status).toBe('ARCHIVED');
    expect((await c.get('/api/v1/ai/conversations?status=ARCHIVED')).body.conversations.map((x: any) => x.id)).toContain(id);

    const stranger = (await activeUser(t)).c;
    expect((await stranger.get(`/api/v1/ai/conversations/${id}`)).status).toBe(404);
    expect((await stranger.post(`/api/v1/ai/conversations/${id}/messages`, { content: 'hi', stream: false })).status).toBe(404);
    expect((await stranger.delete(`/api/v1/ai/conversations/${id}`)).status).toBe(404);

    expect((await c.delete(`/api/v1/ai/conversations/${id}`)).status).toBe(204);
    expect((await c.get(`/api/v1/ai/conversations/${id}`)).status).toBe(404);
  });

  test('requires an active user', async () => {
    expect((await (await pendingUser(t)).c.get('/api/v1/ai/conversations')).status).toBe(403);
    expect((await client(t.app).get('/api/v1/ai/models')).status).toBe(401);
  });
});

describe('assistant turns', () => {
  test('a plain answer is saved with blocks, usage and an automatic title', async () => {
    const id = await newConversation();
    t.model.script([text('Bitcoin is a '), text('decentralized currency.'), done(120, 15)]);
    const res = await ask(id, 'What is Bitcoin?');
    expect(res.status).toBe(201);
    expect(res.body.userMessage).toMatchObject({ role: 'USER', content: 'What is Bitcoin?' });
    const reply = res.body.assistantMessage;
    expect(reply).toMatchObject({ role: 'ASSISTANT', content: 'Bitcoin is a decentralized currency.', modelProvider: 'fake', modelName: 'fake/main' });
    expect(reply.metadata.blocks.map((b: any) => b.type)).toEqual(['markdown', 'disclaimer']);
    expect(reply.tokenUsage).toMatchObject({ inputTokens: 120, outputTokens: 15, costUnits: 1.5, costUnit: 'neurons' });
    expect((await c.get(`/api/v1/ai/conversations/${id}`)).body.title).toBe('What is Bitcoin?');

    const usage = await t.db.select().from(aiUsageEvents).where(eq(aiUsageEvents.turnId, reply.id));
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ status: 'SUCCEEDED', model: 'fake-main', inputTokens: 120, outputTokens: 15, costUnits: '1.500000' });
  });

  test('tools fetch real market data; cards show the observed values', async () => {
    const id = await newConversation();
    t.model.script(
      [call('get_tickers', { symbols: ['btcusdt'] }), done(150, 10, 'tool_calls')],
      req => {
        const tool = req.messages.at(-1)!;
        expect(tool.role).toBe('tool');
        expect(JSON.parse((tool as any).content).tickers[0]).toMatchObject({ symbol: 'BTCUSDT', lastPrice: '73886.01' });
        return [text('BTCUSDT last traded at 73886.01 USDT.'), done(200, 12)];
      },
    );
    const res = await ask(id, 'BTC price?');
    expect(res.status).toBe(201);
    const blocks = res.body.assistantMessage.metadata.blocks;
    expect(blocks.map((b: any) => b.type)).toEqual(['markdown', 'ticker', 'disclaimer']);
    expect(blocks[1].data).toMatchObject({ exchange: 'BINANCE', symbol: 'BTCUSDT', lastPrice: '73886.01' });
    expect(res.body.assistantMessage.metadata.toolCalls).toEqual([{ name: 'get_tickers', arguments: { symbols: ['btcusdt'] }, ok: true, durationMs: expect.any(Number) }]);
    expect(res.body.assistantMessage.tokenUsage).toMatchObject({ inputTokens: 350, outputTokens: 22 });
    expect(t.model.requests[0]!.tools!.map(x => x.name)).toEqual(['search_symbols', 'get_tickers', 'get_top_movers', 'analyze_market', 'draft_strategy']);
  });

  test('market analysis uses server-computed indicators', async () => {
    const now = t.clock.now().getTime();
    t.provider.candles = Array.from({ length: 80 }, (_, i) => candle(now - (80 - i) * 3_600_000, String(100 + i), true, 60));
    const id = await newConversation();
    t.model.script([call('analyze_market', { symbol: 'ETHUSDT', timeframe: '1h' }), done()], [text('ETH is trending up.'), done()]);
    const blocks = (await ask(id, 'Analyze ETH')).body.assistantMessage.metadata.blocks;
    const card = blocks.find((b: any) => b.type === 'market_analysis');
    expect(card.data).toMatchObject({ symbol: 'ETHUSDT', timeframe: '1h', trend: 'UP', rsiState: 'OVERBOUGHT', lastClose: 179, source: 'exchange' });
  });

  test('tool errors go back to the model, which can correct itself', async () => {
    const id = await newConversation();
    t.model.script(
      [call('get_tickers', { symbols: ['NOPEUSDT'] }), done()],
      req => {
        expect(JSON.parse((req.messages.at(-1) as any).content).error).toContain('NOPEUSDT');
        return [call('search_symbols', { query: 'sol' }), done()];
      },
      [text('Did you mean SOLUSDT?'), done()],
    );
    const res = await ask(id, 'Price of NOPE?');
    expect(res.body.assistantMessage.metadata.toolCalls.map((x: any) => [x.name, x.ok])).toEqual([['get_tickers', false], ['search_symbols', true]]);
  });

  test('previous messages are sent as history; the user\'s AI preferences shape the prompt', async () => {
    await c.patch('/api/v1/me/preferences', { ai: { responseStyle: 'CONCISE', explanationLevel: 'ADVANCED' } });
    const id = await newConversation();
    t.model.script([text('First answer.'), done()], [text('Second answer.'), done()]);
    await ask(id, 'First question');
    await ask(id, 'Second question');
    const second = t.model.requests[1]!;
    expect(second.messages.map(m => [m.role, (m as any).content]).slice(1)).toEqual([
      ['user', 'First question'], ['assistant', 'First answer.'], ['user', 'Second question'],
    ]);
    expect((second.messages[0] as any).content).toContain('under 120 words');
  });

  test('stops offering tools after the round limit so the model must answer', async () => {
    const id = await newConversation();
    const loop = [call('get_top_movers', { sort: 'gainers' }), done()];
    t.model.script(loop, loop, loop, loop, [text('Here are the movers.'), done()]);
    const res = await ask(id, 'Movers?');
    expect(res.status).toBe(201);
    expect(t.model.requests).toHaveLength(5);
    expect(t.model.requests[4]!.tools).toBeUndefined();
    expect(res.body.assistantMessage.metadata.blocks.filter((b: any) => b.type === 'market_list')).toHaveLength(4);
  });
});

describe('strategy drafts', () => {
  test('invalid drafts are rejected with reasons, valid ones become a card the user can save', async () => {
    const id = await newConversation();
    t.model.script(
      [call('draft_strategy', strategyDraft('NOPEUSDT')), done()],
      req => {
        expect(JSON.parse((req.messages.at(-1) as any).content).error).toContain('not an active market');
        return [call('draft_strategy', strategyDraft()), done()];
      },
      [text('Here is a dip-buying strategy with a 5% stop.'), done()],
    );
    const res = await ask(id, 'Make me an RSI strategy for BTC');
    const reply = res.body.assistantMessage;
    const card = reply.metadata.blocks.find((b: any) => b.type === 'strategy_draft');
    expect(card.summary).toContain('Enter when: RSI(14) crosses above 30 AND price > SMA(200)');
    expect(card.summary).toContain('Stop loss: 5%');

    const saved = await c.post(`/api/v1/ai/conversations/${id}/messages/${reply.id}/strategies`, { draftId: card.draftId });
    expect(saved.status).toBe(201);
    const again = await c.post(`/api/v1/ai/conversations/${id}/messages/${reply.id}/strategies`, { draftId: card.draftId });
    expect(again.body).toEqual({ strategyId: saved.body.strategyId, alreadySaved: true });

    const strategy = (await c.get(`/api/v1/strategies/${saved.body.strategyId}`)).body;
    expect(strategy).toMatchObject({ name: 'RSI dip buyer', source: 'AI_GENERATED', latestVersion: 1, engineVersion: 'v1' });
    expect(strategy.definition).toEqual(strategyDraft().definition);
    expect((await c.get('/api/v1/strategies')).body.strategies.map((s: any) => s.id)).toContain(saved.body.strategyId);

    expect((await c.post(`/api/v1/ai/conversations/${id}/messages/${reply.id}/strategies`, { draftId: 'draft-99' })).status).toBe(404);
  });
});

describe('strategy drafts from loose model output', () => {
  test('nulls and fields that do not belong to an indicator are dropped before strict validation', async () => {
    const id = await newConversation();
    const messy = structuredClone(strategyDraft()) as any;
    messy.definition.entry.conditions[1].left = { type: 'PRICE', period: 14, band: null };
    messy.definition.exit.takeProfitPercent = null;
    messy.definition.entry.conditions[0].right = 30; // shorthand for { type: 'VALUE', value: 30 }
    t.model.script([call('draft_strategy', messy), done()], [text('Draft ready.'), done()]);
    const reply = (await ask(id, 'strategy please')).body.assistantMessage;
    const card = reply.metadata.blocks.find((b: any) => b.type === 'strategy_draft');
    expect(card.draft.definition.entry.conditions[1].left).toEqual({ type: 'PRICE' });
    expect(card.draft.definition.exit).not.toHaveProperty('takeProfitPercent');
    expect(card.draft.definition.entry.conditions[0].right).toEqual({ type: 'VALUE', value: 30 });
  });
});

describe('streaming', () => {
  test('server-sent events carry the turn as it happens', async () => {
    const id = await newConversation();
    t.model.script([call('get_tickers', { symbols: ['ETHUSDT'] }), done()], [text('ETH is '), text('2093.12 USDT.'), done()]);
    const res = await t.app.request(`/api/v1/ai/conversations/${id}/messages`, {
      method: 'POST', headers: { Cookie: c.cookie, Origin: 'http://localhost:4001', 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'ETH?' }),
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = (await res.text()).split('\n\n').filter(Boolean).map(chunk => chunk.match(/^event: (.+)$/m)?.[1]);
    expect(events).toEqual(['user_message', 'status', 'status', 'block', 'status', 'delta', 'delta', 'assistant_message', 'done']);
  });

  test('a provider failure mid-stream becomes an error event', async () => {
    const id = await newConversation();
    t.model.script(new AiProviderError('AI_PROVIDER_QUOTA', 'Daily allowance used up.', false));
    const res = await t.app.request(`/api/v1/ai/conversations/${id}/messages`, {
      method: 'POST', headers: { Cookie: c.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'hi' }),
    });
    const body = await res.text();
    expect(body).toContain('event: user_message');
    expect(body).toContain('event: error');
    expect(body).toContain('AI_PROVIDER_QUOTA');
  });
});

describe('failures', () => {
  test('falls back to the next model when the first fails before answering', async () => {
    const id = await newConversation();
    t.model.script(new AiProviderError('AI_MODEL_UNAVAILABLE', 'nope', true), [text('Answer from backup.'), done()]);
    const reply = (await ask(id, 'hello')).body.assistantMessage;
    expect(reply).toMatchObject({ content: 'Answer from backup.', modelName: 'fake/backup' });
    const rows = await t.db.select().from(aiUsageEvents).where(eq(aiUsageEvents.turnId, reply.id));
    expect(rows.map(r => [r.model, r.status, r.errorCode]).sort()).toEqual([['fake-backup', 'SUCCEEDED', null], ['fake-main', 'FAILED', 'AI_MODEL_UNAVAILABLE']]);
  });

  test('a non-retryable failure returns an error and leaves no orphaned question', async () => {
    const id = await newConversation();
    t.model.script(new AiProviderError('AI_AUTH_ERROR', 'Credentials rejected.', false));
    const res = await ask(id, 'hello');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AI_AUTH_ERROR');
    expect(await t.db.select().from(messages).where(eq(messages.conversationId, id))).toEqual([]);
  });

  test('validation, unknown models and busy conversations', async () => {
    const id = await newConversation();
    expect((await ask(id, '')).status).toBe(400);
    expect((await ask(id, 'x'.repeat(4001))).status).toBe(400);
    const unknown = await ask(id, 'hi', { model: 'gpt-9' });
    expect([unknown.status, unknown.body.code]).toEqual([400, 'UNKNOWN_MODEL']);

    t.model.delayMs = 30;
    t.model.script([text('slow'), text(' reply'), done()]);
    const [a, b] = await Promise.all([ask(id, 'one'), (async () => { await Bun.sleep(10); return ask(id, 'two'); })()]);
    t.model.delayMs = 0;
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  test('lists available models', async () => {
    expect((await c.get('/api/v1/ai/models')).body.models.map((m: any) => m.id)).toEqual(['fake-main', 'fake-backup']);
  });
});

describe('usage limits', () => {
  test('daily turn limit is enforced from Postgres and reported', async () => {
    const limited = await createTestApp({ aiLimits: { turnsPerDay: 1, tokensPerDay: 1_000_000 } });
    try {
      await limited.market.catalog.sync('BINANCE');
      const u = await activeUser(limited);
      const id = (await u.c.post('/api/v1/ai/conversations', {})).body.id;
      limited.model.script([text('ok'), done(10, 5)]);
      expect((await u.c.post(`/api/v1/ai/conversations/${id}/messages`, { content: 'one', stream: false })).status).toBe(201);
      const blocked = await u.c.post(`/api/v1/ai/conversations/${id}/messages`, { content: 'two', stream: false });
      expect(blocked.status).toBe(429);
      expect(blocked.body).toMatchObject({ code: 'DAILY_TURN_LIMIT', resetAt: expect.any(String) });
      expect((await u.c.get('/api/v1/ai/usage')).body).toMatchObject({ turns: 1, inputTokens: 10, outputTokens: 5, allowed: false, limits: { turnsPerDay: 1 } });
    } finally {
      await limited.close();
    }
  });

  test('without provider credentials the assistant reports it is not configured', async () => {
    const off = await createTestApp({ aiConfigured: false });
    try {
      const u = await activeUser(off);
      const id = (await u.c.post('/api/v1/ai/conversations', {})).body.id;
      const res = await u.c.post(`/api/v1/ai/conversations/${id}/messages`, { content: 'hi', stream: false });
      expect([res.status, res.body.code]).toEqual([503, 'AI_NOT_CONFIGURED']);
    } finally {
      await off.close();
    }
  });
});

describe('strategies API', () => {
  test('manual strategies are validated and private to their owner', async () => {
    const bad = await c.post('/api/v1/strategies', { ...strategyDraft(), definition: { ...strategyDraft().definition, exit: { conditions: [] } } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields)).toContain('definition.exit');
    const ok = await c.post('/api/v1/strategies', { ...strategyDraft('ETHUSDT'), name: 'Manual ETH' });
    expect(ok.status).toBe(201);
    expect(ok.body.source).toBe('USER_CREATED');
    const stranger = (await activeUser(t)).c;
    expect((await stranger.get(`/api/v1/strategies/${ok.body.id}`)).status).toBe(404);
    const [row] = await t.db.select().from(strategies).where(eq(strategies.id, ok.body.id));
    expect(row?.source).toBe('USER_CREATED');
  });
});
