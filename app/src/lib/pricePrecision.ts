// Price precision helpers. Kept free of React Native imports so they can be unit-tested directly.

/** Decimal places worth showing for a price string ("74569.26000000" → 2). */
export function decimalsOf(price: string | null | undefined) {
  const fraction = (price ?? '').split('.')[1]?.replace(/0+$/, '') ?? '';
  return Math.max(2, Math.min(8, fraction.length));
}

/**
 * Decimals for a chart: the most any price in the history uses. Reading only the latest close made
 * the precision flip ("1.1136" → 4, "1.1130" → 3), and every flip rebuilt the chart.
 */
export function candlePrecision(candles: { open: string; high: string; low: string; close: string }[]) {
  let best = 2;
  for (const c of candles) best = Math.max(best, decimalsOf(c.open), decimalsOf(c.high), decimalsOf(c.low), decimalsOf(c.close));
  return best;
}
