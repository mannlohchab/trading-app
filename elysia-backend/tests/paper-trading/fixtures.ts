import { expect } from 'bun:test';
import type { SignalSeries, StrategySignalEngine } from '../../src/modules/backtesting';
import type { Ticker } from '../../src/modules/market/domain/types';
import { alignDown, candlesBefore } from '../../src/modules/backtesting/utils/validation';
import { client, createTestApp } from '../helpers/test-app';
import { activeUser } from '../helpers/users';
import { definition, seedCandles, walk } from '../backtesting/fixtures';

export type App = Awaited<ReturnType<typeof createTestApp>>;
export type Http = ReturnType<typeof client>;

/** A price as the live stream would deliver it (time = test clock now). */
export function tick(t: App, symbol: string, last: string, opts: { bid?: string; ask?: string; ageMs?: number } = {}) {
  t.clock.advance(1); // stream events are strictly ordered in time; equal times are treated as duplicates
  const ticker: Ticker = {
    exchange: 'BINANCE', symbol, lastPrice: last, priceChange: '0', priceChangePercent: '0', openPrice: last, highPrice: last, lowPrice: last,
    volume: '1', quoteVolume: '1', bidPrice: opts.bid ?? null, askPrice: opts.ask ?? null, time: t.clock.now().getTime() - (opts.ageMs ?? 0),
  };
  t.paperTrading.services.quotes.observe('BINANCE', ticker);
  return ticker;
}

/** Ticks and lets the engine process the symbol's orders (what a stream event does). */
export async function tickAndProcess(t: App, symbol: string, last: string, opts: { bid?: string; ask?: string } = {}) {
  tick(t, symbol, last, opts);
  await t.paperTrading.engine.refresh();
  await t.paperTrading.engine.processSymbol(`BINANCE:${symbol}`);
}

export async function setup(options: Parameters<typeof createTestApp>[0] = {}) {
  const t = await createTestApp(options);
  await t.market.catalog.sync('BINANCE');
  const u = await activeUser(t);
  const account = (await u.c.post('/api/v1/paper/accounts', { name: 'Main', initialBalance: '10000' })).body;
  return { t, c: u.c, user: u.user, account };
}

export async function reconciled(t: App, accountId: string) {
  const r = await t.paperTrading.services.accounts.reconcile(accountId);
  expect(r.mismatches).toEqual([]);
  return r;
}

export const order = (accountId: string, o: Record<string, unknown>) => ({ accountId, symbol: 'BTCUSDT', ...o });

/** Seeds `n` closed 1h candles ending at the latest closed candle before the test clock. */
export async function seedClosedHistory(t: App, n: number, symbol = 'BTCUSDT') {
  const H = 3_600_000;
  const latest = candlesBefore('1h', alignDown('1h', t.clock.now().getTime()), 1);
  const candles = walk(n, { start: latest - (n - 1) * H, seed: 5, price: 70000 });
  await seedCandles(t, candles, '1h', symbol);
  return { latest, candles };
}

/** A scripted signal engine: entry/exit decided per candle open time. Records requests. */
export class ScriptedSignals implements StrategySignalEngine {
  readonly identity = { name: 'resin', version: '0.3.0', revision: 'scripted' };
  entries = new Set<number>();
  exits = new Set<number>();
  calls: { bars: number; candles: number; last: number; lastClosed: boolean }[] = [];
  async signals(input: Parameters<StrategySignalEngine['signals']>[0]): Promise<SignalSeries> {
    const last = input.candles.at(-1)!;
    this.calls.push({ bars: input.bars, candles: input.candles.length, last: last.openTime, lastClosed: last.closeTime < Date.now() + 10 ** 12 });
    return {
      engine: this.identity,
      bars: input.candles.slice(-input.bars).map(c => ({ openTime: c.openTime, entry: this.entries.has(c.openTime), exit: this.exits.has(c.openTime) })),
      durationMs: 1,
    };
  }
}

export { definition };
