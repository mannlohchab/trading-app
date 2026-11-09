// Independent reference for cross-checking Resin: long-only SMA crossover, fixed quantity,
// signal on bar close, filled at the next bar's open (TradingView's default fill model).
export type RefTrade = { entryIndex: number; exitIndex: number; entryPrice: number; exitPrice: number; profit: number };

const sma = (xs: Float64Array, end: number, n: number) => {
  if (end + 1 < n) return NaN;
  let s = 0;
  for (let i = end - n + 1; i <= end; i++) s += xs[i]!;
  return s / n;
};

export function referenceSmaCross(o: { open: Float64Array; close: Float64Array }, fast: number, slow: number, qty = 1): RefTrade[] {
  const trades: RefTrade[] = [];
  let pending: 'buy' | 'sell' | null = null;
  let entry: { index: number; price: number } | null = null;
  for (let i = 0; i < o.close.length; i++) {
    // Orders placed on the previous bar fill at this bar's open.
    if (pending === 'buy' && !entry) entry = { index: i, price: o.open[i]! };
    if (pending === 'sell' && entry) {
      trades.push({ entryIndex: entry.index, exitIndex: i, entryPrice: entry.price, exitPrice: o.open[i]!, profit: (o.open[i]! - entry.price) * qty });
      entry = null;
    }
    pending = null;
    const f = sma(o.close, i, fast), s = sma(o.close, i, slow), pf = sma(o.close, i - 1, fast), ps = sma(o.close, i - 1, slow);
    if (pf <= ps && f > s) pending = 'buy';
    else if (pf >= ps && f < s) pending = 'sell';
  }
  return trades;
}
