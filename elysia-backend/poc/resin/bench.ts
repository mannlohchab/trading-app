// Throughput benchmark on synthetic candles: bun bench.ts
import { runPineBacktest } from './pine-backtest';
import type { Candle } from '../../src/modules/market/domain/types';

function candles(n: number): Candle[] {
  let s = 1, p = 30_000;
  const rand = () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  return Array.from({ length: n }, (_, i) => {
    const o = p, c = Math.max(1, o * (1 + (rand() - 0.5) * 0.02));
    p = c;
    const t = 1_500_000_000_000 + i * 60_000;
    return { openTime: t, closeTime: t + 59_999, open: o.toFixed(2), high: (Math.max(o, c) * 1.002).toFixed(2), low: (Math.min(o, c) * 0.998).toFixed(2), close: c.toFixed(2), volume: '1', quoteVolume: null, trades: null, isClosed: true };
  });
}
const scripts: Record<string, string> = {
  'EMA cross': `//@version=6\nstrategy("e", default_qty_type=strategy.percent_of_equity, default_qty_value=50)\nf = ta.ema(close, 20)\ns = ta.ema(close, 50)\nif ta.crossover(f, s)\n    strategy.entry("L", strategy.long)\nif ta.crossunder(f, s)\n    strategy.close("L")\n`,
  'RSI+MACD+BB bracket': `//@version=6\nstrategy("m", default_qty_type=strategy.percent_of_equity, default_qty_value=20)\nr = ta.rsi(close, 14)\n[m, sg, h] = ta.macd(close, 12, 26, 9)\n[mid, up, lo] = ta.bb(close, 20, 2)\nbuy = ta.crossover(r, 30) and close > lo\nsell = ta.crossunder(h, 0)\nif buy\n    strategy.entry("L", strategy.long)\nif sell\n    strategy.close("L")\nstrategy.exit("x", "L", stop=strategy.position_avg_price * 0.97, limit=strategy.position_avg_price * 1.06)\n`,
};
for (const n of [10_000, 100_000, 500_000]) {
  const data = candles(n);
  for (const [name, source] of Object.entries(scripts)) {
    Bun.gc(true);
    const before = process.memoryUsage().rss;
    const r = runPineBacktest({ source, candles: data, timeframe: '1m', rules: { commissionPercent: 0.1 }, equitySampleEvery: 100 });
    const after = process.memoryUsage().rss;
    if (!r.ok) { console.log(name, n, 'FAILED', r.errors); continue; }
    console.log(`${String(n).padStart(7)} bars | ${name.padEnd(20)} | transpile ${String(r.timings.transpileMs).padStart(6)} ms | run ${String(r.timings.runMs).padStart(7)} ms | ${Math.round(n / (r.timings.runMs / 1000)).toLocaleString().padStart(10)} bars/s | trades ${String(r.metrics.totalTrades).padStart(5)} | rss +${Math.round((after - before) / 1e6)} MB`);
  }
}
