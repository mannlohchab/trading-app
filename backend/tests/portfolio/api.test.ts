import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { call, done, text } from '../helpers/fake-ai';
import { candle } from '../helpers/fake-market';
import { client, createTestApp } from '../helpers/test-app';
import { activeUser, pendingUser } from '../helpers/users';

const BASE = '/api/v1/portfolio';

let t: Awaited<ReturnType<typeof createTestApp>>;
let asha: Awaited<ReturnType<typeof activeUser>>;
let ravi: Awaited<ReturnType<typeof activeUser>>;

beforeAll(async () => {
  t = await createTestApp();
  t.clock.current = new Date('2026-11-19T10:00:00Z');
  await t.market.catalog.sync('BINANCE');
  asha = await activeUser(t, 'Asha Trader');
  ravi = await activeUser(t, 'Ravi Analyst');
});
afterAll(() => t.close());

const TABLE = [
  { asset: 'btc', quantity: '0.5', boughtOn: '2025-11-19', buyPrice: '60000' },
  { asset: 'ETH', quantity: '2', boughtOn: '2026-03-01' },
  { asset: 'Reliance', quantity: '4', boughtOn: '2024-06-10', buyPrice: '2900.50' },
];

describe('access', () => {
  test('requires a signed-in, phone-verified user', async () => {
    expect((await client(t.app).get(`${BASE}/holdings`)).status).toBe(401);
    expect((await (await pendingUser(t)).c.get(`${BASE}/holdings`)).status).toBe(403);
  });
});

describe('holdings table', () => {
  test('starts empty, saves in order, and is private to its owner', async () => {
    expect((await asha.c.get(`${BASE}/holdings`)).body).toEqual({ holdings: [], updatedAt: null });

    const saved = await asha.c.put(`${BASE}/holdings`, { holdings: TABLE });
    expect(saved.status).toBe(200);
    expect(saved.body.holdings).toEqual([
      { asset: 'BTC', quantity: '0.5', boughtOn: '2025-11-19', buyPrice: '60000' },
      { asset: 'ETH', quantity: '2', boughtOn: '2026-03-01', buyPrice: null },
      { asset: 'RELIANCE', quantity: '4', boughtOn: '2024-06-10', buyPrice: '2900.5' },
    ]);
    expect(saved.body.updatedAt).toEqual(expect.any(String));
    expect((await asha.c.get(`${BASE}/holdings`)).body.holdings).toEqual(saved.body.holdings);
    expect((await ravi.c.get(`${BASE}/holdings`)).body.holdings).toEqual([]);
  });

  test('rejects bad cells without touching the saved table', async () => {
    const res = await asha.c.put(`${BASE}/holdings`, { holdings: [{ asset: 'SOL', quantity: '-3', boughtOn: '2026-13-01' }] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR', fields: { 'holdings.0.quantity': expect.any(String), 'holdings.0.boughtOn': expect.any(String) } });
    expect((await asha.c.get(`${BASE}/holdings`)).body.holdings).toHaveLength(3);
  });

  test('replacing with an empty list clears it', async () => {
    expect((await ravi.c.put(`${BASE}/holdings`, { holdings: [{ asset: 'SOL', quantity: '1', boughtOn: '2026-01-01' }] })).status).toBe(200);
    expect((await ravi.c.put(`${BASE}/holdings`, { holdings: [] })).body.holdings).toEqual([]);
  });
});

describe('valuation', () => {
  test('values listed coins at live prices, estimates missing buy prices, and keeps unlisted assets', async () => {
    // ETH has no buy price: the daily close on 2026-03-01 is used.
    t.provider.candles = [candle(Date.parse('2026-03-01T00:00:00Z'), '2000', true, 1440)];
    const res = await asha.c.get(`${BASE}/valuation`);
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.positions.map((p: any) => [p.asset, p]));
    expect(by.BTC).toMatchObject({ symbol: 'BTCUSDT', currentPrice: 73886.01, value: 36943, cost: 30000, pnl: 6943, buyPriceSource: 'ENTERED', daysHeld: 365 });
    expect(by.ETH).toMatchObject({ symbol: 'ETHUSDT', currentPrice: 2093.12, value: 4186.24, cost: 4000, avgBuyPrice: 2000, buyPriceSource: 'CLOSE_ON_BUY_DATE' });
    expect(by.RELIANCE).toMatchObject({ symbol: null, value: null, cost: 11602 });
    expect(res.body).toMatchObject({ currency: 'USDT', lots: 3, unpricedAssets: ['RELIANCE'], concentration: { largestAsset: 'BTC' } });
  });

  test('still answers when the exchange is down (from cached or stored market data)', async () => {
    t.provider.down = true;
    try {
      const res = await asha.c.get(`${BASE}/valuation`);
      expect(res.status).toBe(200);
      expect(res.body.lots).toBe(3);
      expect(res.body.positions).toHaveLength(3);
    } finally {
      t.provider.down = false;
    }
  });
});

describe('AI assistant', () => {
  test('reads the asking user\'s holdings through get_my_holdings', async () => {
    const conversation = (await asha.c.post('/api/v1/ai/conversations', {})).body;
    t.model.script([call('get_my_holdings', {}), done()], [text('BTC is your largest position.'), done()]);
    const res = await asha.c.post(`/api/v1/ai/conversations/${conversation.id}/messages`, { content: 'Analyse my portfolio', stream: false });
    expect(res.status).toBe(201);
    expect(res.body.assistantMessage.metadata.toolCalls).toEqual([{ name: 'get_my_holdings', arguments: {}, ok: true, durationMs: expect.any(Number) }]);

    const toolMessage = t.model.requests[1]!.messages.find(m => m.role === 'tool')!;
    const result = JSON.parse(toolMessage.content as string);
    expect(result).toMatchObject({ currency: 'USDT', lots: 3, concentration: { largestAsset: 'BTC' } });
    expect(result.positions.map((p: any) => p.asset)).toEqual(['BTC', 'ETH', 'RELIANCE']);
    expect(t.model.requests[0]!.messages[0]!.content).toContain('get_my_holdings');
  });

  test('tells the model when the user has no holdings yet', async () => {
    const conversation = (await ravi.c.post('/api/v1/ai/conversations', {})).body;
    t.model.script([call('get_my_holdings', {}), done()], [text('Add your holdings first.'), done()]);
    await ravi.c.post(`/api/v1/ai/conversations/${conversation.id}/messages`, { content: 'Review my portfolio', stream: false });
    const toolMessage = t.model.requests[1]!.messages.find(m => m.role === 'tool')!;
    expect(JSON.parse(toolMessage.content as string)).toMatchObject({ holdings: 0, note: expect.stringContaining('Portfolio table') });
  });
});
