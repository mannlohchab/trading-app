import { eq } from 'drizzle-orm';
import { marketCandles, tradingSymbols } from '../../src/db/schema';
import type { Timeframe } from '../../src/modules/market/domain/market-options';
import type { DatasetCandle, EngineInput } from '../../src/modules/backtesting/backtesting.types';
import { alignUp, nextOpenTime, timeframeMs } from '../../src/modules/backtesting/utils/validation';
import type { createTestApp } from '../helpers/test-app';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/** Deterministic random walk on the timeframe grid. Prices are exact 2-decimal strings. */
export function walk(n: number, opts: { tf?: Timeframe; start?: number; seed?: number; price?: number } = {}): DatasetCandle[] {
  const tf = opts.tf ?? '1h';
  let s = opts.seed ?? 42, p = opts.price ?? 100, t = alignUp(tf, opts.start ?? 1_700_000_000_000);
  const rand = () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  const out: DatasetCandle[] = [];
  for (let i = 0; i < n; i++) {
    const open = p, close = Math.max(1, open * (1 + (rand() - 0.5) * 0.04));
    const high = Math.max(open, close) * (1 + rand() * 0.01), low = Math.min(open, close) * (1 - rand() * 0.01);
    p = close;
    const next = nextOpenTime(tf, t);
    out.push({ openTime: t, closeTime: next - 1, open: open.toFixed(2), high: high.toFixed(2), low: low.toFixed(2), close: close.toFixed(2), volume: '100' });
    t = next;
  }
  return out;
}

/** Candles from explicit [open, high, low, close] tuples. */
export function bars(prices: [number, number, number, number][], tf: Timeframe = '1h', start = 1_700_000_000_000): DatasetCandle[] {
  let t = alignUp(tf, start);
  return prices.map(([o, h, l, c]) => {
    const next = nextOpenTime(tf, t);
    const candle = { openTime: t, closeTime: next - 1, open: String(o), high: String(h), low: String(l), close: String(c), volume: '1' };
    t = next;
    return candle;
  });
}

/** N closed candles ending at the last candle that has fully closed before the test clock's now. */
export function recentWalk(t: TestApp, n: number, tf: Exclude<Timeframe, '1M'> = '1h', seed = 7) {
  const step = timeframeMs(tf);
  const end = alignUp(tf, t.clock.now().getTime()) - step; // start of the current (unfinished) candle, minus one
  return walk(n, { tf, start: end - n * step, seed });
}

export async function symbolId(t: TestApp, symbol = 'BTCUSDT') {
  const [row] = await t.db.select().from(tradingSymbols).where(eq(tradingSymbols.symbol, symbol));
  if (!row) throw new Error(`${symbol} not synced`);
  return row.id;
}

export async function seedCandles(t: TestApp, candles: DatasetCandle[], tf: Timeframe = '1h', symbol = 'BTCUSDT', isClosed = true) {
  const id = await symbolId(t, symbol);
  for (let i = 0; i < candles.length; i += 500) {
    await t.db.insert(marketCandles).values(candles.slice(i, i + 500).map(c => ({
      symbolId: id, timeframe: tf, openTime: c.openTime, closeTime: c.closeTime,
      open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, isClosed,
    }))).onConflictDoNothing();
  }
}

export const definition = (overrides: Record<string, unknown> = {}) => ({
  market: { exchange: 'BINANCE', symbol: 'BTCUSDT', timeframe: '1h' },
  direction: 'LONG',
  entry: { conditions: [{ left: { type: 'EMA', period: 10 }, operator: 'CROSSES_ABOVE', right: { type: 'EMA', period: 30 } }] },
  exit: { conditions: [{ left: { type: 'EMA', period: 10 }, operator: 'CROSSES_BELOW', right: { type: 'EMA', period: 30 } }], stopLossPercent: 5 },
  risk: { positionSizePercent: 20 },
  ...overrides,
});

export const engineInput = (source: string, candles: DatasetCandle[], overrides: Partial<EngineInput['settings']> = {}, symbol: Partial<EngineInput['symbol']> = {}): EngineInput => ({
  script: { language: 'pine', version: 6, generatedFrom: 'strategy_definition_v1', source },
  candles,
  timeframe: '1h',
  symbol: { exchange: 'BINANCE', symbol: 'TESTUSDT', baseAsset: 'TEST', quoteAsset: 'USDT', tickSize: '0.01', lotSize: '0.001', ...symbol },
  settings: { initialCapital: '10000', commissionPercent: '0', slippageTicks: 0, positionSizing: { type: 'fixed_quantity', value: '1' }, ...overrides },
});

export const pine = (body: string, header = '') => `//@version=6\nstrategy("t"${header})\n${body}\n`;
