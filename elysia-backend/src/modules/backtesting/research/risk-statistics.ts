import { dec } from '../utils/decimal';

/** Ratios use statistical floating-point arithmetic; cash accounting remains exact-decimal. */
export function computeRiskStatistics(input: {
  equity: { time: number; equity: string }[];
  /** Caller must supply the sampling frequency; do not annualize irregular quote events. */
  periodsPerYear: number;
  annualRiskFreeRate?: number;
}) {
  const { equity, periodsPerYear, annualRiskFreeRate = 0 } = input;
  if (!Number.isFinite(periodsPerYear) || periodsPerYear <= 0 || periodsPerYear > 1_000_000_000) throw new Error('An explicit valid annual sampling frequency is required.');
  if (!Number.isFinite(annualRiskFreeRate) || annualRiskFreeRate <= -1) throw new Error('Risk-free rate must be a finite decimal greater than -1.');
  for (let i = 0; i < equity.length; i++) {
    if (!Number.isSafeInteger(equity[i]!.time) || (i > 0 && equity[i]!.time <= equity[i - 1]!.time)) throw new Error('Equity observations must have strictly increasing timestamps.');
    if (dec.cmp(equity[i]!.equity, '0') <= 0) return { sharpe: null, sortino: null, cagrPercent: null, annualizedVolatilityPercent: null, observations: equity.length, reason: 'Ratios are undefined for non-positive equity.' };
  }
  if (equity.length < 3) return { sharpe: null, sortino: null, cagrPercent: null, annualizedVolatilityPercent: null, observations: equity.length, reason: 'At least three periodic observations are required.' };
  const returns = equity.slice(1).map((p, i) => Number(dec.div(dec.sub(p.equity, equity[i]!.equity), equity[i]!.equity)));
  const riskFreePeriod = Math.pow(1 + annualRiskFreeRate, 1 / periodsPerYear) - 1;
  const excess = returns.map(r => r - riskFreePeriod);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const variance = excess.reduce((a, b) => a + (b - mean) ** 2, 0) / (excess.length - 1);
  const std = Math.sqrt(variance), downside = Math.sqrt(excess.reduce((a, r) => a + Math.min(r, 0) ** 2, 0) / excess.length);
  const elapsedYears = (equity.at(-1)!.time - equity[0]!.time) / (365.2425 * 86_400_000);
  const growth = Number(dec.div(equity.at(-1)!.equity, equity[0]!.equity));
  const finite = (value: number) => Number.isFinite(value) ? dec.from(value) : null;
  return { sharpe: std > 0 ? finite(mean / std * Math.sqrt(periodsPerYear)) : null,
    sortino: downside > 0 ? finite(mean / downside * Math.sqrt(periodsPerYear)) : null,
    cagrPercent: elapsedYears > 0 ? finite((Math.pow(growth, 1 / elapsedYears) - 1) * 100) : null,
    annualizedVolatilityPercent: finite(std * Math.sqrt(periodsPerYear) * 100), observations: equity.length,
    assumptions: { periodsPerYear, annualRiskFreeRate, sampling: 'Equally spaced trading periods supplied by caller; do not pass irregular quote-event samples.', cagr: 'Actual elapsed calendar time; short samples can produce unstable annualization.' } };
}
