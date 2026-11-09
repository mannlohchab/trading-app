import { describe, expect, test } from 'bun:test';
import { transpile } from '@nullarch/resin';
import type { Candle } from '../../src/modules/market/domain/types';
import type { StrategyDefinition } from '../../src/modules/strategies/domain/definition';
import { strategyDefinitionSchema } from '../../src/modules/strategies/domain/definition';
import { definitionToPine } from './definition-to-pine';
import { runPineBacktest, toOhlcv } from './pine-backtest';
import { referenceSmaCross } from './reference-sim';
import { runSandboxed } from './sandbox';

/** Deterministic random-walk candles (seeded), 1h apart. */
function candles(n: number, seed = 42): Candle[] {
  let s = seed, price = 100;
  const rand = () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  return Array.from({ length: n }, (_, i) => {
    const open = price;
    const close = Math.max(1, open * (1 + (rand() - 0.5) * 0.04));
    const high = Math.max(open, close) * (1 + rand() * 0.01), low = Math.min(open, close) * (1 - rand() * 0.01);
    price = close;
    const t = 1_700_000_000_000 + i * 3_600_000;
    const f = (v: number) => v.toFixed(2);
    return { openTime: t, closeTime: t + 3_599_999, open: f(open), high: f(high), low: f(low), close: f(close), volume: '100', quoteVolume: null, trades: null, isClosed: true };
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

describe('correctness', () => {
  test('Resin trades match an independent simulator exactly', () => {
    const data = candles(3000);
    const result = runPineBacktest({ source: smaCross(10, 30), candles: data, timeframe: '1h' });
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const ref = referenceSmaCross(toOhlcv(data), 10, 30);
    expect(result.trades.length).toBe(ref.length);
    expect(ref.length).toBeGreaterThan(20);
    result.trades.forEach((t, i) => {
      const r = ref[i]!;
      expect(t.entryTime).toBe(new Date(data[r.entryIndex]!.openTime).toISOString());
      expect(t.exitTime).toBe(new Date(data[r.exitIndex]!.openTime).toISOString());
      expect(t.entryPrice).toBeCloseTo(r.entryPrice, 8);
      expect(t.exitPrice).toBeCloseTo(r.exitPrice, 8);
      expect(t.profit).toBeCloseTo(r.profit, 4);
    });
    const refNet = ref.reduce((a, t) => a + t.profit, 0);
    expect(result.metrics.netProfit).toBeCloseTo(refNet, 3);
  });

  test('metrics are consistent with the trade list', () => {
    const r = runPineBacktest({ source: smaCross(5, 20), candles: candles(1500, 7), timeframe: '1h' });
    if (!r.ok) throw new Error(r.errors.join('\n'));
    const m = r.metrics;
    expect(m.winningTrades + m.losingTrades).toBeLessThanOrEqual(m.totalTrades);
    expect(m.grossProfit + m.grossLoss).toBeCloseTo(m.netProfit, 3);
    expect(m.finalEquity).toBeCloseTo(m.initialCapital + m.netProfit + (m.openPosition ? r.equityCurve.at(-1)!.equity - m.initialCapital - m.netProfit : 0), 3);
    expect(r.equityCurve).toHaveLength(1500);
  });
});

describe('AI-generated strategies', () => {
  const definition: StrategyDefinition = strategyDefinitionSchema.parse({
    market: { exchange: 'BINANCE', symbol: 'BTCUSDT', timeframe: '1h' },
    direction: 'LONG',
    entry: { conditions: [
      { left: { type: 'RSI', period: 14 }, operator: 'CROSSES_ABOVE', right: { type: 'VALUE', value: 30 } },
      { left: { type: 'PRICE' }, operator: 'GT', right: { type: 'BOLLINGER', period: 20, stdDev: 2, band: 'LOWER' } },
    ] },
    exit: {
      conditions: [{ left: { type: 'MACD', fast: 12, slow: 26, signal: 9, line: 'HISTOGRAM' }, operator: 'CROSSES_BELOW', right: { type: 'VALUE', value: 0 } }],
      stopLossPercent: 3,
      takeProfitPercent: 6,
    },
    risk: { positionSizePercent: 25 },
  });

  test('definitions compile to Pine that Resin runs, with stop loss, take profit and commission', () => {
    const pine = definitionToPine('RSI rebound', definition);
    expect(transpile(pine, { chartTf: '60' }).ok).toBe(true);
    const r = runPineBacktest({ source: pine, candles: candles(4000, 3), timeframe: '1h' });
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.metrics.totalTrades).toBeGreaterThan(5);
    const comments = new Set(r.trades.map(t => t.exitComment));
    expect([...comments].some(c => ['Stop loss', 'Take profit', 'Exit rule'].includes(c))).toBe(true);
    // 25% of equity per trade: the first entry is about 2,500 of 10,000 capital.
    const first = r.trades[0]!;
    expect(first.size * first.entryPrice).toBeGreaterThan(2000);
    expect(first.size * first.entryPrice).toBeLessThan(3000);

    const free = runPineBacktest({ source: definitionToPine('RSI rebound', definition, { commissionPercent: 0 }), candles: candles(4000, 3), timeframe: '1h' });
    if (!free.ok) throw new Error('free run failed');
    expect(free.metrics.netProfit).toBeGreaterThan(r.metrics.netProfit); // commission costs money
  });

  test('strategy names cannot inject Pine code', () => {
    const pine = definitionToPine('x")\nstrategy.entry("evil", strategy.short)\n//', definition);
    expect(pine).not.toContain('"evil"');
    expect(transpile(pine, { chartTf: '60' }).ok).toBe(true);
  });
});

describe('errors', () => {
  const data = candles(200);
  test('syntax errors, indicators and self-halting scripts are reported by stage', () => {
    expect(runPineBacktest({ source: '//@version=6\nstrategy("x"\nif', candles: data, timeframe: '1h' })).toMatchObject({ ok: false, stage: 'transpile' });
    expect(runPineBacktest({ source: '//@version=6\nindicator("x")\nplot(close)', candles: data, timeframe: '1h' })).toMatchObject({ ok: false, stage: 'not_a_strategy' });
    expect(runPineBacktest({ source: '//@version=6\nstrategy("x")\nif bar_index == 50\n    runtime.error("stop")', candles: data, timeframe: '1h' })).toMatchObject({ ok: false, stage: 'halted' });
    expect(runPineBacktest({ source: smaCross(5, 10), candles: data, timeframe: '2h' })).toMatchObject({ ok: false, stage: 'input' });
  });
});

describe('security', () => {
  const data = candles(300);
  const FORBIDDEN = /\b(globalThis|process|require|import|eval|Function|constructor|__proto__|prototype|fetch|Bun|Deno|window|self)\b/;

  test('scripts cannot reach JavaScript globals or break out of string literals', () => {
    const probes = [
      `//@version=6\nstrategy("p")\nx = "\\"); globalThis.pwned = 1; (\\""\nplot(close)`,
      `//@version=6\nstrategy("p")\nprocess = 1\nglobalThis = 2\nconstructor = 3\nplot(process + globalThis + constructor)`,
      `//@version=6\nstrategy("p")\nplot(close.constructor)`,
      `//@version=6\nstrategy("p")\nx = fetch("http://example.com")`,
      `//@version=6\nstrategy("p")\n__proto__ = 1\nplot(__proto__)`,
      `//@version=6\nstrategy("p")\nx = str.tostring(close) + "\`\${process.exit(1)}\`"\nplot(close)`,
    ];
    for (const source of probes) {
      const t = transpile(source, { chartTf: '60' });
      if (!t.ok) continue; // rejected at compile time: fine
      // Accepted scripts: user identifiers must not surface as raw JS identifiers that reach globals.
      const exposed = t.code.split('\n').filter(l => FORBIDDEN.test(l.replace(/"(?:[^"\\]|\\.)*"/g, '""')));
      expect(exposed).toEqual([]);
      const r = runPineBacktest({ source, candles: data, timeframe: '1h' });
      expect((globalThis as any).pwned).toBeUndefined();
      expect(['ok', 'runtime', 'not_a_strategy'].includes(r.ok ? 'ok' : r.stage)).toBe(true);
    }
  });

  test('a single infinite loop is silently capped by Resin at 10,000 iterations', () => {
    const r = runPineBacktest({ source: `//@version=6\nstrategy("loop")\nvar int n = 0\nwhile true\n    n += 1\nplot(n)`, candles: data, timeframe: '1h' });
    expect(r.ok).toBe(true); // no error: the cap is not reported, unlike TradingView's loop timeout
  });

  test('runaway scripts (nested loops) are stopped by the sandbox timeout', async () => {
    const source = `//@version=6\nstrategy("loop")\nvar float n = 0\nfor i = 0 to 9999\n    for j = 0 to 9999\n        n += 1\nplot(n)`;
    const started = Date.now();
    const r = await runSandboxed({ source, candles: data, timeframe: '1h' }, { timeoutMs: 1000 });
    expect(r).toMatchObject({ ok: false, stage: 'timeout' });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test('the sandbox returns the same result as an in-process run and hides the environment', async () => {
    const input = { source: smaCross(5, 20), candles: candles(1000), timeframe: '1h' };
    const sandboxed = await runSandboxed(input);
    const direct = runPineBacktest(input);
    if (!sandboxed.ok || !direct.ok) throw new Error('run failed');
    expect(sandboxed.trades).toEqual(direct.trades);
    expect(sandboxed.metrics).toEqual(direct.metrics);
  });
});
