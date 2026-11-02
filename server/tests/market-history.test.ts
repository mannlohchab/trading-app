import { expect, spyOn, test } from 'bun:test';
import { AngelOneMarketDataProvider } from '../src/providers/angelOneMarketData';
import { marketRouter } from '../src/modules/market/routes';
import { config } from '../src/lib/config';
import { YahooMarketDataProvider, yahooMarketData } from '../src/providers/yahooMarketData';

test('live history failures are never replaced with generated demo candles', async () => {
  const provider = new AngelOneMarketDataProvider(new YahooMarketDataProvider(async () => new Response('', { status: 503 })));
  Object.assign(provider, { api: async () => { throw new Error('Feed unavailable'); } });
  await expect(provider.candles('TCS', '5m', 'NSE')).rejects.toThrow('Yahoo market data unavailable');
});

test('history preserves provider prices and shares concurrent requests for the same instrument', async () => {
  const provider = new AngelOneMarketDataProvider();
  let calls = 0;
  Object.assign(provider, { api: async (_path: string, body: Record<string, string>) => {
    calls++;
    expect(body.interval).toBe('FIVE_MINUTE');
    const from = Date.parse(body.fromdate.replace(' ', 'T') + '+05:30');
    const to = Date.parse(body.todate.replace(' ', 'T') + '+05:30');
    expect(to - from).toBe(7 * 86_400_000);
    return [['2026-10-30T09:15:00+05:30', 3010, 3018, 3000, 3012.75, 1234]];
  } });
  const [first, second] = await Promise.all([
    provider.candles('TCS', '5m', 'NSE'),
    provider.candles('TCS', '5m', 'NSE'),
  ]);
  expect(first).toEqual(second);
  expect(first[0].close).toBe(3012.75);
  expect(first[0].time).toBe(Date.parse('2026-10-30T09:15:00+05:30') / 1000);
  await provider.candles('TCS', '5m', 'NSE');
  expect(calls).toBe(1);
});

test('real-only candle requests accept identified Yahoo history without Angel credentials', async () => {
  const original = { ...config.angel };
  Object.assign(config.angel, { apiKey: '', clientCode: '', password: '', totpSecret: '' });
  const history = spyOn(yahooMarketData, 'candles').mockResolvedValue([
    { time: 1793332200, open: 3010, high: 3018, low: 3000, close: 3012.75, volume: 1234, source: 'yahoo' },
  ]);
  try {
    const route = marketRouter.stack.find((layer) => layer.route?.path === '/candles/:symbol')!.route!;
    let response: unknown;
    let failure: any;
    await route.stack[0].handle(
      { params: { symbol: 'TCS' }, query: { exchange: 'NSE', timeframe: '5m', liveOnly: 'true' } } as any,
      { json: (body: unknown) => { response = body; } } as any,
      (error?: unknown) => { failure = error; },
    );
    expect(failure).toBeUndefined();
    expect(response).toMatchObject({ isDemo: false, source: 'yahoo', candles: [{ close: 3012.75, source: 'yahoo' }] });
  } finally {
    history.mockRestore();
    Object.assign(config.angel, original);
  }
});
