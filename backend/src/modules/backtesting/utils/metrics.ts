// Backtest metrics in exact decimal arithmetic (utils/decimal.ts). Engine output arrives as decimal
// strings; nothing here sums money with JavaScript floats.
import type { BacktestMetrics, DatasetCandle, EngineResult } from '../backtesting.types';
import { dec, type Decimal } from './decimal';

const pct = (part: Decimal, whole: Decimal) => (dec.isZero(whole) ? '0' : dec.round(dec.percent(part, whole), 8));
const money = (v: Decimal) => dec.round(v, 8);

export function computeMetrics(result: EngineResult, candles: DatasetCandle[], initialCapital: Decimal): BacktestMetrics {
  const trades = result.trades;
  const profits = trades.map(t => t.profit);
  const wins = profits.filter(p => dec.cmp(p, '0') > 0);
  const losses = profits.filter(p => dec.cmp(p, '0') < 0);
  const grossProfit = dec.sum(wins);
  const grossLoss = dec.sum(losses); // ≤ 0
  const netProfit = dec.sum(profits); // realized, net of closed trades' fees
  // Flat at the end: equity is exactly capital + realized P/L (the bar-by-bar engine curve can differ
  // in the last rounding digit). Otherwise the rest of equity is the open position, marked to market
  // net of its entry fee.
  const finalEquity = result.openPosition ? (result.equity.at(-1) ?? initialCapital) : dec.add(initialCapital, netProfit);
  const unrealizedProfit = result.openPosition ? dec.sub(dec.sub(finalEquity, initialCapital), netProfit) : '0';
  const totalCommission = dec.add(dec.sum(trades.map(t => t.commission)), result.openPosition?.entryCommission ?? '0');

  let peak = result.equity[0] ?? initialCapital;
  let maxDrawdown = '0', maxDrawdownPercent = '0';
  for (const e of [initialCapital, ...result.equity]) {
    if (dec.cmp(e, peak) > 0) peak = e;
    const dd = dec.sub(peak, e);
    if (dec.cmp(dd, maxDrawdown) > 0) maxDrawdown = dd;
    if (!dec.isZero(peak)) {
      const ddPct = dec.percent(dd, peak);
      if (dec.cmp(ddPct, maxDrawdownPercent) > 0) maxDrawdownPercent = ddPct;
    }
  }

  // Time in market: candles whose open falls inside a trade (or the still-open position).
  const spans = trades.map(t => [t.entryTime, t.exitTime] as const);
  if (result.openPosition) spans.push([result.openPosition.entryTime, Number.MAX_SAFE_INTEGER]);
  let inMarket = 0;
  for (const c of candles) if (spans.some(([a, b]) => c.openTime >= a && c.openTime < b)) inMarket++;

  const n = trades.length;
  const avg = (xs: Decimal[]) => (xs.length ? money(dec.divInt(dec.sum(xs), xs.length)) : null);
  return {
    totalTrades: n,
    winningTrades: wins.length,
    losingTrades: losses.length,
    breakEvenTrades: n - wins.length - losses.length,
    winRatePercent: n ? dec.round(dec.percent(String(wins.length), String(n)), 4) : null,
    grossProfit: money(grossProfit),
    grossLoss: money(grossLoss),
    netProfit: money(netProfit),
    unrealizedProfit: money(unrealizedProfit),
    totalCommission: money(totalCommission),
    finalEquity: money(finalEquity),
    totalReturnPercent: pct(dec.sub(finalEquity, initialCapital), initialCapital),
    maxDrawdown: money(maxDrawdown),
    maxDrawdownPercent: dec.round(maxDrawdownPercent, 8),
    profitFactor: losses.length ? dec.round(dec.div(grossProfit, dec.abs(grossLoss)), 8) : null,
    averageTrade: avg(profits),
    averageWinningTrade: avg(wins),
    averageLosingTrade: avg(losses),
    largestWinningTrade: wins.length ? money(dec.max(wins)) : null,
    largestLosingTrade: losses.length ? money(dec.min(losses)) : null,
    averageTradeDurationMs: n ? Math.round(trades.reduce((a, t) => a + (t.exitTime - t.entryTime), 0) / n) : null,
    buyAndHoldReturnPercent: candles.length ? pct(dec.sub(candles.at(-1)!.close, candles[0]!.open), candles[0]!.open) : '0',
    exposurePercent: candles.length ? dec.round(dec.percent(String(inMarket), String(candles.length)), 4) : '0',
  };
}

/**
 * Downsamples an equity curve for storage and charts: per bucket keeps the lowest and highest
 * point (so drawdowns stay visible), plus the first and last points.
 */
export function downsampleEquity(times: number[], equity: Decimal[], maxPoints: number): { time: number; equity: Decimal }[] {
  const points = times.map((time, i) => ({ time, equity: equity[i]! }));
  if (points.length <= maxPoints) return points;
  const buckets = Math.max(1, Math.floor((maxPoints - 2) / 2));
  const size = (points.length - 2) / buckets;
  const out = [points[0]!];
  for (let b = 0; b < buckets; b++) {
    const slice = points.slice(1 + Math.floor(b * size), 1 + Math.floor((b + 1) * size));
    if (!slice.length) continue;
    let lo = slice[0]!, hi = slice[0]!;
    for (const p of slice) { if (dec.cmp(p.equity, lo.equity) < 0) lo = p; if (dec.cmp(p.equity, hi.equity) > 0) hi = p; }
    out.push(...(lo.time <= hi.time ? [lo, hi] : [hi, lo]).filter((p, i, a) => i === 0 || p !== a[0]));
  }
  out.push(points.at(-1)!);
  return out;
}
