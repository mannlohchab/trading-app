import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { marketCandles } from '../../src/db/schema';
import type { ServerMessage } from '../../src/modules/market/application/live-market.hub';
import { LIMITS } from '../../src/modules/market/domain/rules';
import { candle, ticker } from '../helpers/fake-market';
import { createTestApp } from '../helpers/test-app';
import { activeUser } from '../helpers/users';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
  await t.market.catalog.sync('BINANCE');
});
afterAll(() => t.close());

const btc = { kind: 'ticker', exchange: 'BINANCE', symbol: 'BTCUSDT' } as const;
const inbox = () => { const messages: ServerMessage[] = []; return { messages, send: (m: ServerMessage) => messages.push(m) }; };

describe('hub', () => {
  test('one upstream topic per stream, however many clients want it', async () => {
    const a = inbox(), b = inbox();
    const ida = t.market.hub.connect(a.send), idb = t.market.hub.connect(b.send);
    await t.market.hub.subscribe(ida, ['ticker:BINANCE:BTCUSDT', 'candles:BINANCE:ETHUSDT:1m']);
    await t.market.hub.subscribe(idb, ['ticker:binance:btcusdt']);
    expect(t.feed.topics).toHaveLength(2);
    expect(a.messages[0]).toEqual({ type: 'subscribed', topics: ['ticker:BINANCE:BTCUSDT', 'candles:BINANCE:ETHUSDT:1m'], rejected: [] });
    expect(a.messages[1]).toEqual({ type: 'status', exchange: 'BINANCE', status: 'connecting' });

    t.feed.emit({ type: 'ticker', topic: btc, ticker: ticker('BTCUSDT', '74000', '1', '1') });
    expect(a.messages.at(-1)).toMatchObject({ type: 'ticker', topic: 'ticker:BINANCE:BTCUSDT', data: { lastPrice: '74000' } });
    expect(b.messages.at(-1)).toMatchObject({ type: 'ticker', data: { lastPrice: '74000' } });

    t.market.hub.unsubscribe(ida, ['ticker:BINANCE:BTCUSDT']);
    expect(t.feed.topics).toHaveLength(2); // b still wants BTC
    t.market.hub.disconnect(idb);
    expect(t.feed.topics).toEqual([{ kind: 'candles', exchange: 'BINANCE', symbol: 'ETHUSDT', timeframe: '1m' }]);
    t.market.hub.disconnect(ida);
    expect(t.feed.topics).toEqual([]);
    expect(t.market.hub.activeTopicCount).toBe(0);
  });

  test('rejects bad topics, unknown symbols and exchanges, and enforces the per-connection limit', async () => {
    const a = inbox();
    const id = t.market.hub.connect(a.send);
    await t.market.hub.subscribe(id, ['ticker:BINANCE:NOPEUSDT', 'ticker:KRAKEN:BTCUSD', 'nonsense', 'ticker:BINANCE:ETHUSDT']);
    expect(a.messages[0]).toEqual({
      type: 'subscribed', topics: ['ticker:BINANCE:ETHUSDT'],
      rejected: [{ topic: 'ticker:KRAKEN:BTCUSD', reason: 'UNKNOWN_EXCHANGE' }, { topic: 'nonsense', reason: 'INVALID_TOPIC' }, { topic: 'ticker:BINANCE:NOPEUSDT', reason: 'UNKNOWN_SYMBOL' }],
    });
    await t.market.hub.subscribe(id, Array.from({ length: LIMITS.topicsPerConnection + 1 }, () => 'ticker:BINANCE:BTCUSDT'));
    expect(a.messages.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_REQUEST' });
    t.market.hub.disconnect(id);
  });

  test('closed live candles are saved to Postgres', async () => {
    const id = t.market.hub.connect(() => {});
    await t.market.hub.subscribe(id, ['candles:BINANCE:SOLUSDT:5m']);
    const topic = { kind: 'candles', exchange: 'BINANCE', symbol: 'SOLUSDT', timeframe: '5m' } as const;
    t.feed.emit({ type: 'candle', topic, candle: candle(1_800_000_000_000, '180', false, 5) });
    t.feed.emit({ type: 'candle', topic, candle: candle(1_800_000_000_000, '181', true, 5) });
    await Bun.sleep(50);
    const rows = await t.db.select().from(marketCandles).where(eq(marketCandles.timeframe, '5m'));
    expect(rows.map(r => [r.openTime, r.close])).toEqual([[1_800_000_000_000, '181.000000000000']]);
    t.market.hub.disconnect(id);
  });

  test('feed status changes reach subscribers', async () => {
    const a = inbox();
    const id = t.market.hub.connect(a.send);
    await t.market.hub.subscribe(id, ['ticker:BINANCE:BTCUSDT']);
    t.feed.setStatus('reconnecting');
    expect(a.messages.at(-1)).toEqual({ type: 'status', exchange: 'BINANCE', status: 'reconnecting' });
    t.market.hub.disconnect(id);
  });
});

describe('WebSocket endpoint', () => {
  let server: ReturnType<typeof Bun.serve>;
  beforeAll(() => { server = Bun.serve({ port: 0, fetch: t.app.fetch, websocket: t.market.websocket }); });
  afterAll(() => server.stop(true));

  const open = (headers: Record<string, string> = {}) => {
    const ws = new WebSocket(`ws://localhost:${server.port}/api/v1/market/stream`, { headers } as any);
    const messages: any[] = [];
    ws.onmessage = e => messages.push(JSON.parse(String(e.data)));
    const next = async (type: string) => {
      for (let i = 0; i < 100; i++) { const m = messages.find(x => x.type === type); if (m) return m; await Bun.sleep(10); }
      throw new Error(`no ${type} message; got ${JSON.stringify(messages)}`);
    };
    return { ws, messages, next };
  };

  test('refuses connections without an active session', async () => {
    const { ws } = open();
    const closed = await new Promise<string>(resolve => { ws.onerror = () => resolve('error'); ws.onclose = () => resolve('closed'); ws.onopen = () => resolve('open'); });
    expect(closed).not.toBe('open');
  });

  test('streams subscribed topics to an authenticated client', async () => {
    const { c } = await activeUser(t);
    const { ws, next } = open({ Cookie: c.cookie, Origin: 'http://localhost:4001' });
    await new Promise(resolve => (ws.onopen = resolve));

    ws.send(JSON.stringify({ op: 'subscribe', topics: ['ticker:BINANCE:BTCUSDT'] }));
    expect((await next('subscribed')).topics).toEqual(['ticker:BINANCE:BTCUSDT']);

    t.feed.emit({ type: 'ticker', topic: btc, ticker: ticker('BTCUSDT', '75000.5', '2', '1') });
    expect((await next('ticker')).data.lastPrice).toBe('75000.5');

    ws.send(JSON.stringify({ op: 'ping' }));
    await next('pong');
    ws.send('not json');
    expect((await next('error')).code).toBe('INVALID_JSON');

    ws.close();
    for (let i = 0; i < 50 && t.market.hub.activeTopicCount; i++) await Bun.sleep(10);
    expect(t.market.hub.activeTopicCount).toBe(0); // disconnect releases the upstream subscription
  });
});
