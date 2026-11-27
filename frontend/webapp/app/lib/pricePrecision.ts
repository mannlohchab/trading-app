// Ported from app/src/lib/pricePrecision.ts.

/** Decimal places worth showing for a price string ("74569.26000000" → 2). */
export function decimalsOf(price: string | null | undefined): number {
  const fraction = (price ?? "").split(".")[1]?.replace(/0+$/, "") ?? "";
  return Math.max(2, Math.min(8, fraction.length));
}

/** Decimals for a chart: the most any price in the history uses, so precision never flips. */
export function candlePrecision(
  candles: { open: string; high: string; low: string; close: string }[],
): number {
  let best = 2;
  for (const c of candles) {
    best = Math.max(best, decimalsOf(c.open), decimalsOf(c.high), decimalsOf(c.low), decimalsOf(c.close));
  }
  return best;
}

/** Decimals allowed by a step such as "0.00001000" (→ 5). */
export function stepDecimals(step: string | null | undefined, fallback = 8): number {
  if (!step) return fallback;
  const fraction = step.split(".")[1]?.replace(/0+$/, "") ?? "";
  return fraction.length;
}

/** Rounds a quantity down to the instrument's lot step, as a plain decimal string. */
export function floorToStep(value: number, step: string | null | undefined): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const decimals = stepDecimals(step);
  const s = Number(step);
  const floored = s > 0 ? Math.floor(value / s + 1e-9) * s : value;
  const fixed = floored.toFixed(decimals);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

/** Step string for a number of decimals: 3 → "0.001", 0 → "1". */
export function stepFor(decimals: number): string {
  return decimals > 0 ? (1 / 10 ** decimals).toFixed(decimals) : "1";
}
