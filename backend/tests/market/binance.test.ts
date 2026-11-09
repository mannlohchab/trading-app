import { describe, expect, test } from 'bun:test';
import { ProviderUnavailableError } from '../../src/modules/market/application/errors';
import type { FeedEvent, FeedStatus } from '../../src/modules/market/application/ports';
import { BinanceLiveFeed, type FeedSocket } from '../../src/modules/market/infrastructure/binance/binance-live-feed';
import { candleFromStream, tickerFromRest, toInstrument } from '../../src/modules/market/infrastructure/binance/binance-mappers';
import { BinanceRestProvider } from '../../src/modules/market/infrastructure/binance/binance-rest.provider';

describe('mappers', () => {
  test('exchangeInfo symbols become instruments with precision from filters', () => {
    const btc = toInstrument({
      symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', isSpotTradingAllowed: true, baseAssetPrecision: 8, quoteAssetPrecision: 8,
      filters: [
        { filterType: 'PRICE_FILTER', minPrice: '0.01000000', maxPrice: '1000000.00000000', tickSize: '0.01000000' },
        { filterType: 'LOT_SIZE', minQty: '0.00001000', maxQty: '9000.00000000', stepSize: '0.00001000' },
        { filterType: 'NOTIONAL', minNotional: '5.00000000' },
      ],
    });
    expect(btc).toMatchObject({ symbol: 'BTCUSDT', marketType: 'SPOT', tickSize: '0.01', stepSize: '0.00001', pricePrecision: 2, quantityPrecision: 5 });
    expect(btc?.metadata).toMatchObject({ minQuantity: '0.00001', minNotional: '5' });
    expect(toInstrument({ symbol: 'X', status: 'BREAK', baseAsset: 'A', quoteAsset: 'B' })).toBeNull();
  });

  test('tickers and klines keep exact decimal strings', () => {
    const t = tickerFromRest({
      symbol: 'BTCUSDT', priceChange: '-2058.81000000', priceChangePercent: '-2.711', lastPrice: '73886.01000000', bidPrice: '73886.00000000',
      askPrice: '73886.01000000', openPrice: '75944.82000000', highPrice: '76200.00000000', lowPrice: '73510.00000000',
      volume: '13820.59419000', quoteVolume: '1034180739.94787950', closeTime: 1794211599133,
    });
    expect(t).toMatchObject({ lastPrice: '73886.01', priceChange: '-2058.81', quoteVolume: '1034180739.9478795', time: 1794211599133 });
    const k = candleFromStream({ e: 'kline', E: 1, s: 'BTCUSDT', k: { t: 60_000, T: 119_999, i: '1m', o: '73827.83000000', c: '73870.01000000', h: '73880.00000000', l: '73800.00000000', v: '12.50000000', n: 410, x: true, q: '922000.10000000' } });
    expect(k).toEqual({ openTime: 60_000, closeTime: 119_999, open: '73827.83', high: '73880', low: '73800', close: '73870.01', volume: '12.5', quoteVolume: '922000.1', trades: 410, isClosed: true });
  });
});

describe('REST provider', () => {
  test('calls the public market-data host with the right parameters', async () => {
    const urls: string[] = [];
    const provider = new BinanceRestProvider({ fetch: async url => { urls.push(url); return Response.json([[0, '1', '2', '0.5', '1.5', '10', 59_999, '15', 3]]); }, now: () => 1e12 });
    const candles = await provider.fetchCandles('BTCUSDT', '1h', { limit: 2, endTime: 5000 });
    expect(urls[0]).toBe('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=2&endTime=5000');
    expect(candles[0]).toMatchObject({ open: '1', close: '1.5', isClosed: true });
  });

  test('a 429 stops further calls until Retry-After passes', async () => {
    let now = 0;
    let calls = 0;
    const provider = new BinanceRestProvider({
      now: () => now,
      fetch: async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '30' } }); },
    });
    await expect(provider.fetchTickers()).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(provider.fetchTickers()).rejects.toThrow('cooldown');
    expect(calls).toBe(1);
    now = 31_000;
    await expect(provider.fetchTickers()).rejects.toThrow('rate limited');
    expect(calls).toBe(2);
  });

  test('network errors and 5xx become ProviderUnavailableError', async () => {
    const down = new BinanceRestProvider({ fetch: async () => { throw new TypeError('ECONNRESET'); } });
    await expect(down.fetchInstruments()).rejects.toBeInstanceOf(ProviderUnavailableError);
    const broken = new BinanceRestProvider({ fetch: async () => new Response('oops', { status: 502 }) });
    await expect(broken.fetchInstruments()).rejects.toBeInstanceOf(ProviderUnavailableError);
    // Headers arrive but the body stalls past the timeout (or is cut off): still an upstream failure, not a 500.
    const stalled = new BinanceRestProvider({ fetch: async () => new Response(new ReadableStream({ start(c) { c.error(new DOMException('The operation timed out.', 'TimeoutError')); } })) });
    await expect(stalled.fetchTickers()).rejects.toBeInstanceOf(ProviderUnavailableError);
    const truncated = new BinanceRestProvider({ fetch: async () => new Response('[{"symbol":"BTC') });
    await expect(truncated.fetchTickers()).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});

class FakeSocket implements FeedSocket {
  readyState = 0;
  sent: any[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; }
  open() { this.readyState = 1; this.onopen?.(); }
  push(data: object) { this.onmessage?.({ data: JSON.stringify(data) }); }
}

function feedHarness() {
  const sockets: FakeSocket[] = [];
  let timers: { fn: () => void; at: number }[] = [];
  let now = 0;
  const feed = new BinanceLiveFeed({
    createSocket: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    now: () => now,
    setTimer: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; },
    clearTimer: t => { timers = timers.filter(x => x !== t); },
  });
  const events: FeedEvent[] = [];
  const statuses: FeedStatus[] = [];
  feed.onEvent(e => events.push(e));
  feed.onStatus(s => statuses.push(s));
  const advance = (ms: number) => {
    now += ms;
    for (let due = timers.filter(t => t.at <= now); due.length; due = timers.filter(t => t.at <= now)) {
      timers = timers.filter(t => !due.includes(t));
      due.forEach(t => t.fn());
    }
  };
  return { feed, sockets, events, statuses, advance };
}

const btcTicker = { kind: 'ticker' as const, exchange: 'BINANCE', symbol: 'BTCUSDT' };
const ethTicker = { kind: 'ticker' as const, exchange: 'BINANCE', symbol: 'ETHUSDT' };
const btc1m = { kind: 'candles' as const, exchange: 'BINANCE', symbol: 'BTCUSDT', timeframe: '1m' as const };

describe('live feed', () => {
  test('connects lazily, subscribes on open, and changes subscriptions without reconnecting', () => {
    const h = feedHarness();
    h.feed.setTopics([btcTicker, btc1m]);
    expect(h.sockets).toHaveLength(0); // debounced
    h.advance(250);
    expect(h.sockets).toHaveLength(1);
    h.sockets[0]!.open();
    expect(h.sockets[0]!.sent[0]).toMatchObject({ method: 'SUBSCRIBE', params: ['btcusdt@ticker', 'btcusdt@kline_1m'] });

    h.feed.setTopics([btcTicker, ethTicker]);
    h.advance(250);
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0]!.sent.slice(1)).toMatchObject([
      { method: 'UNSUBSCRIBE', params: ['btcusdt@kline_1m'] },
      { method: 'SUBSCRIBE', params: ['ethusdt@ticker'] },
    ]);

    h.feed.setTopics([]);
    h.advance(250);
    expect(h.sockets[0]!.closed).toBe(true);
    expect(h.feed.status).toBe('idle');
  });

  test('maps stream events and reports live', () => {
    const h = feedHarness();
    h.feed.setTopics([btcTicker, btc1m]);
    h.advance(250);
    h.sockets[0]!.open();
    h.sockets[0]!.push({ result: null, id: 1 });
    h.sockets[0]!.push({ stream: 'btcusdt@ticker', data: { e: '24hrTicker', E: 5, s: 'BTCUSDT', p: '1.0', P: '0.5', c: '100.10', o: '99', h: '101', l: '98', v: '3', q: '300' } });
    h.sockets[0]!.push({ stream: 'btcusdt@kline_1m', data: { e: 'kline', E: 6, s: 'BTCUSDT', k: { t: 0, T: 59_999, i: '1m', o: '1', c: '2', h: '2', l: '1', v: '4', n: 1, x: true, q: '6' } } });
    h.sockets[0]!.push({ stream: 'btcusdt@ticker', data: { e: '24hrTicker', E: 7, s: 'BTCUSDT', c: 'garbage' } });
    expect(h.events.map(e => e.type)).toEqual(['ticker', 'candle']);
    expect(h.events[0]).toMatchObject({ topic: btcTicker, ticker: { lastPrice: '100.1' } });
    expect(h.events[1]).toMatchObject({ topic: btc1m, candle: { close: '2', isClosed: true } });
    expect(h.statuses).toEqual(['connecting', 'live']);
  });

  test('reconnects with backoff after a drop and re-subscribes everything', () => {
    const h = feedHarness();
    h.feed.setTopics([btcTicker]);
    h.advance(250);
    h.sockets[0]!.open();
    h.sockets[0]!.onclose?.();
    expect(h.feed.status).toBe('reconnecting');
    h.advance(1600);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]!.open();
    expect(h.sockets[1]!.sent[0]).toMatchObject({ method: 'SUBSCRIBE', params: ['btcusdt@ticker'] });
  });

  test('reconnects when a subscribed stream goes silent', () => {
    const h = feedHarness();
    h.feed.setTopics([btcTicker]);
    h.advance(250);
    h.sockets[0]!.open();
    h.advance(70_000); // no messages for 70 s → dropped
    expect(h.sockets[0]!.closed).toBe(true);
    expect(h.feed.status).toBe('reconnecting');
    h.advance(2_000); // backoff elapses → new connection
    expect(h.sockets).toHaveLength(2);
  });
});
