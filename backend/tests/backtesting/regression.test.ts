// Permanent regression suite for the Resin integration. Run it before any engine upgrade; the
// Resin commit is pinned and must only change deliberately (see RESIN_REVISION).
import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { definitionToPine as pocDefinitionToPine } from '../../poc/resin/definition-to-pine';
import { referenceSmaCross } from '../../poc/resin/reference-sim';
import type { DatasetCandle } from '../../src/modules/backtesting/backtesting.types';
import { definitionToPine } from '../../src/modules/backtesting/engines/resin/definition-to-pine';
import { RESIN_EXPECTED_VERSION, RESIN_REVISION, ResinEngine } from '../../src/modules/backtesting/engines/resin/resin.engine';
import { computeMetrics } from '../../src/modules/backtesting/utils/metrics';
import { BacktestWorkerManager } from '../../src/modules/backtesting/workers/backtest.worker-manager';
import { strategyDefinitionSchema } from '../../src/modules/strategies/domain/definition';
import { TEST_SANDBOX_MODE } from '../helpers/test-app';
import { definition, engineInput, walk } from './fixtures';

const manager = new BacktestWorkerManager({ mode: TEST_SANDBOX_MODE });
const engine = new ResinEngine(manager);
afterAll(() => manager.dispose());

/** The POC's candle generator (poc/resin/poc.test.ts), reproduced exactly. */
function pocCandles(n: number, seed = 42): DatasetCandle[] {
  let s = seed, price = 100;
  const rand = () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  return Array.from({ length: n }, (_, i) => {
    const open = price;
    const close = Math.max(1, open * (1 + (rand() - 0.5) * 0.04));
    const high = Math.max(open, close) * (1 + rand() * 0.01), low = Math.min(open, close) * (1 - rand() * 0.01);
    price = close;
    const t = 1_700_000_000_000 + i * 3_600_000;
    const f = (v: number) => v.toFixed(2);
    return { openTime: t, closeTime: t + 3_599_999, open: f(open), high: f(high), low: f(low), close: f(close), volume: '100' };
  });
}

const smaCross = (fast: number, slow: number) => `//@version=6
strategy("SMA cross", overlay=true)
f = ta.sma(close, ${fast})
s = ta.sma(close, ${slow})
if ta.crossover(f, s)
    strategy.entry("L", strategy.long)
if ta.crossunder(f, s)
    strategy.close("L")
`;

describe('independent simulator (from the POC)', () => {
  test('production engine trades match the reference simulator exactly on 3,000 candles', async () => {
    const candles = pocCandles(3000);
    const result = await engine.run(engineInput(smaCross(10, 30), candles));
    const ohlcv = { open: Float64Array.from(candles, c => Number(c.open)), close: Float64Array.from(candles, c => Number(c.close)) };
    const ref = referenceSmaCross(ohlcv, 10, 30);
    expect(ref.length).toBeGreaterThan(20);
    expect(result.trades).toHaveLength(ref.length);
    result.trades.forEach((t, i) => {
      const r = ref[i]!;
      expect(t.entryTime).toBe(candles[r.entryIndex]!.openTime);
      expect(t.exitTime).toBe(candles[r.exitIndex]!.openTime);
      expect(Number(t.entryPrice)).toBeCloseTo(r.entryPrice, 8);
      expect(Number(t.exitPrice)).toBeCloseTo(r.exitPrice, 8);
      expect(Number(t.profit)).toBeCloseTo(r.profit, 6);
    });
  });
});

describe('AI definition → Pine converter', () => {
  test('production output is identical to the POC converter', () => {
    const samples = [
      definition(),
      definition({
        entry: { conditions: [
          { left: { type: 'RSI', period: 14 }, operator: 'CROSSES_ABOVE', right: { type: 'VALUE', value: 30 } },
          { left: { type: 'PRICE' }, operator: 'GT', right: { type: 'BOLLINGER', period: 20, stdDev: 2, band: 'LOWER' } },
        ] },
        exit: { conditions: [{ left: { type: 'MACD', fast: 12, slow: 26, signal: 9, line: 'HISTOGRAM' }, operator: 'CROSSES_BELOW', right: { type: 'VALUE', value: 0 } }], stopLossPercent: 3, takeProfitPercent: 6 },
      }),
      definition({ exit: { conditions: [], takeProfitPercent: 10 } }),
    ].map(d => strategyDefinitionSchema.parse(d));
    for (const def of samples) {
      for (const name of ['Plain', 'x")\nstrategy.entry("evil", strategy.short)\n//']) {
        expect(definitionToPine(name, def)).toBe(pocDefinitionToPine(name, def));
        expect(definitionToPine(name, def, { commissionPercent: 0.05, slippageTicks: 2 })).toBe(pocDefinitionToPine(name, def, { commissionPercent: 0.05, slippageTicks: 2 }));
      }
    }
  });
});

describe('pinned Resin build', () => {
  test('dependency, lockfile and installed package match the POC\'s exact commit', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.dependencies['@nullarch/resin']).toBe(`github:nullarch/resin#${RESIN_REVISION}`);
    const lock = readFileSync(new URL('../../bun.lock', import.meta.url), 'utf8');
    const pocLock = readFileSync(new URL('../../poc/resin/bun.lock', import.meta.url), 'utf8');
    const entry = (text: string) => text.split('\n').find(l => l.includes('"@nullarch/resin": ["@nullarch/resin@github:nullarch/resin#'))!.trim();
    expect(entry(lock)).toContain(`github:nullarch/resin#${RESIN_REVISION.slice(0, 7)}`);
    expect(entry(lock)).toBe(entry(pocLock)); // same commit and the same integrity hash as the POC
    const installed = JSON.parse(readFileSync(new URL('../../node_modules/@nullarch/resin/package.json', import.meta.url), 'utf8'));
    expect([installed.version, installed.license]).toEqual([RESIN_EXPECTED_VERSION, 'Apache-2.0']);
  });
});

describe('golden results', () => {
  test('a fixed backtest produces exactly the recorded trades and metrics', async () => {
    const candles = walk(3000, { seed: 42 });
    const ema = `//@version=6\nstrategy("golden")\nf = ta.ema(close, 12)\ns = ta.ema(close, 26)\nif ta.crossover(f, s)\n    strategy.entry("L", strategy.long)\nif ta.crossunder(f, s)\n    strategy.close("L")\nstrategy.exit("SL", "L", stop=strategy.position_avg_price * 0.97)\n`;
    const result = await engine.run(engineInput(ema, candles, { commissionPercent: '0.1', slippageTicks: 1, positionSizing: { type: 'percent_of_equity', value: '25' } }));
    const metrics = computeMetrics(result, candles, '10000');
    const tradesHash = createHash('sha256').update(JSON.stringify(result.trades)).digest('hex');
    // If an engine upgrade changes these, review the differences before updating the snapshot.
    expect({ metrics, trades: result.trades.length, tradesHash, firstTrade: result.trades[0], lastTrade: result.trades.at(-1) }).toMatchSnapshot();
  });
});
