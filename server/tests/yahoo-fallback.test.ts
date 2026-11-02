import { expect, test } from 'bun:test';
import { AngelOneMarketDataProvider } from '../src/providers/angelOneMarketData';
import { YahooMarketDataProvider } from '../src/providers/yahooMarketData';

function fixture(symbol = 'TCS.NS') {
  return { chart: { error: null, result: [{
    meta: { symbol, currency: 'INR', regularMarketPrice: 3012.75, previousClose: 3000,
      chartPreviousClose: 2900, regularMarketTime: 1793332200, longName: 'Tata Consultancy Services',
      regularMarketDayHigh: 3018, regularMarketDayLow: 3000, regularMarketVolume: 5000 },
    timestamp: [1793331900, 1793332200, 1793332500],
    indicators: { quote: [{ open: [3010, 3012, null], high: [3018, 3016, null],
      low: [3000, 3008, null], close: [3012, 3012.75, null], volume: [1234, 1000, null] }] },
  }] } };
}

test('Yahoo preserves prices and observation times, discards missing candles, and coalesces requests', async () => {
  let requests = 0;
  const provider = new YahooMarketDataProvider(async (url) => {
    requests++;
    expect(String(url)).toContain('/TCS.NS?');
    expect(new URL(String(url)).searchParams.get('interval')).toBe('5m');
    return Response.json(fixture());
  });
  const [a, b] = await Promise.all([provider.candles('TCS', '5m'), provider.candles('TCS', '5m')]);
  expect(a).toEqual(b);
  expect(a).toHaveLength(2);
  expect(a[1]).toMatchObject({ time: 1793332200, close: 3012.75, volume: 1000, source: 'yahoo' });
  await provider.candles('TCS', '5m');
  expect(requests).toBe(1);
});

test('Yahoo quotes use the previous session close and identify their source', async () => {
  const provider = new YahooMarketDataProvider(async () => Response.json(fixture()));
  expect(await provider.quote('tcs', 'nse')).toMatchObject({
    symbol: 'TCS', exchange: 'NSE', ltp: 3012.75, close: 3000,
    change: 12.75, changePercent: 0.425, source: 'yahoo', asOf: 1793332200,
  });
});

test('Yahoo maps NSE, BSE and index symbols without substituting MCX contracts', async () => {
  const seen: string[] = [];
  const provider = new YahooMarketDataProvider(async (url) => {
    const symbol = decodeURIComponent(new URL(String(url)).pathname.split('/').at(-1)!);
    seen.push(symbol);
    return Response.json(fixture(symbol));
  });
  await provider.quote('RELIANCE', 'NSE');
  await provider.quote('TCS', 'BSE');
  await provider.quote('NIFTY', 'NSE');
  await provider.quote('SENSEX', 'BSE');
  expect(seen).toEqual(['RELIANCE.NS', 'TCS.BO', '^NSEI', '^BSESN']);
  await expect(provider.quote('GOLD', 'MCX')).rejects.toThrow('MCX');
  expect(seen).toHaveLength(4);
});

test('Yahoo failures are not cached as successful prices and can recover', async () => {
  let calls = 0;
  const provider = new YahooMarketDataProvider(async () => ++calls === 1
    ? new Response('Rate limited', { status: 429 }) : Response.json(fixture()));
  await expect(provider.quote('TCS')).rejects.toThrow();
  expect((await provider.quote('TCS')).ltp).toBe(3012.75);
});

test('Yahoo rejects missing results, invalid prices and wrong currency', async () => {
  for (const payload of [
    { chart: { error: { description: 'No data' }, result: null } },
    { chart: { result: [{ ...fixture().chart.result[0], meta: { regularMarketPrice: null } }] } },
    { chart: { result: [{ ...fixture().chart.result[0], meta: { ...fixture().chart.result[0].meta, currency: 'USD' } }] } },
  ]) {
    const provider = new YahooMarketDataProvider(async () => Response.json(payload));
    await expect(provider.quote('TCS')).rejects.toThrow();
  }
});

test('Angel success stays primary and failed quotes/history use Yahoo prices', async () => {
  let yahooRequests = 0;
  const yahoo = new YahooMarketDataProvider(async () => {
    yahooRequests++;
    return Response.json(fixture());
  });
  const angel = new AngelOneMarketDataProvider(yahoo);
  Object.assign(angel, { api: async () => ({ ltp: 3100, open: 3000, high: 3120, low: 2990, close: 3000 }) });
  expect((await angel.quote('TCS')).ltp).toBe(3100);
  expect(yahooRequests).toBe(0);
  Object.assign(angel, { api: async () => { throw new Error('Angel unavailable'); } });
  expect(await angel.quote('TCS')).toMatchObject({ ltp: 3012.75, source: 'yahoo' });
  expect((await angel.candles('TCS', '5m'))[1].close).toBe(3012.75);
});

test('when both providers fail, quotes and history never become generated demo data', async () => {
  const yahoo = new YahooMarketDataProvider(async () => new Response('', { status: 503 }));
  const angel = new AngelOneMarketDataProvider(yahoo);
  Object.assign(angel, { api: async () => { throw new Error('Angel unavailable'); } });
  await expect(angel.quote('TCS')).rejects.toThrow();
  await expect(angel.candles('TCS', '5m')).rejects.toThrow();
});

test('unsupported instruments do not hide available stock quotes in a watchlist', async () => {
  const provider = new YahooMarketDataProvider(async () => Response.json(fixture()));
  const quotes = await provider.quotes([{ symbol: 'GOLD', exchange: 'MCX' }, { symbol: 'TCS' }]);
  expect(quotes.map((q) => q.symbol)).toEqual(['TCS']);
  await expect(provider.quotes([{ symbol: 'GOLD', exchange: 'MCX' }])).rejects.toThrow();
});

test('Yahoo uses native weekly and monthly intervals and aggregates four-hour candles by session', async () => {
  const intervals: string[] = [];
  const provider = new YahooMarketDataProvider(async (url) => {
    intervals.push(new URL(String(url)).searchParams.get('interval')!);
    const data = fixture();
    const chart = data.chart.result[0];
    const session = Date.parse('2026-10-30T09:15:00+05:30') / 1000;
    chart.timestamp = [session, session + 3600, session + 86400];
    chart.indicators.quote = [{ open: [100, 102, 105], high: [104, 107, 108],
      low: [99, 101, 103], close: [102, 105, 106], volume: [10, 20, 30] }];
    return Response.json(data);
  });
  await provider.candles('TCS', '1w');
  await provider.candles('TCS', '1M');
  const bars = await provider.candles('TCS', '4h');
  expect(intervals).toEqual(['1wk', '1mo', '1h']);
  expect(bars).toHaveLength(2);
  expect(bars[0]).toMatchObject({ open: 100, high: 107, low: 99, close: 105, volume: 30 });
  expect(bars[1]).toMatchObject({ open: 105, close: 106, volume: 30 });
});

test('empty or null history never produces synthetic candles', async () => {
  const data = fixture();
  data.chart.result[0].timestamp = [];
  const provider = new YahooMarketDataProvider(async () => Response.json(data));
  await expect(provider.candles('TCS', '5m')).rejects.toThrow('history unavailable');
});

test('a slow Yahoo fallback does not block other Angel history attempts', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let signalSecond!: () => void;
  const secondStarted = new Promise<void>((resolve) => { signalSecond = resolve; });
  const yahoo = new YahooMarketDataProvider(async (url) => {
    const symbol = decodeURIComponent(new URL(String(url)).pathname.split('/').at(-1)!);
    if (symbol === 'TCS.NS') await blocked;
    else signalSecond();
    return Response.json(fixture(symbol));
  });
  const angel = new AngelOneMarketDataProvider(yahoo);
  Object.assign(angel, { api: async () => { throw new Error('Angel unavailable'); } });
  const first = angel.candles('TCS', '5m');
  const second = angel.candles('INFY', '5m');
  try {
    const started = await Promise.race([secondStarted.then(() => true), Bun.sleep(1500).then(() => false)]);
    expect(started).toBe(true);
  } finally {
    release();
    await Promise.all([first, second]);
  }
});
