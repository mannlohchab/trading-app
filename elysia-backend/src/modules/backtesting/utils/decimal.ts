// Exact decimal arithmetic on strings, using BigInt fixed point at 12 decimal places (the scale of
// our NUMERIC(30,12) columns). Used for every money figure the module aggregates or stores, so no
// accounting total depends on binary floating point. Rounding is half away from zero.

export const SCALE = 12;
const FACTOR = 10n ** BigInt(SCALE);
const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

export type Decimal = string;

/** Parses "123.45" (or a finite number, via its exact `toFixed` expansion) into scaled units. */
export function toUnits(value: Decimal | number): bigint {
  const text = typeof value === 'number' ? fromNumberText(value) : value.trim();
  const m = DECIMAL.exec(text);
  if (!m) throw new Error(`Not a decimal: ${String(value)}`);
  const [, sign, int, frac = ''] = m;
  let units = BigInt(int!) * FACTOR + BigInt((frac + '0'.repeat(SCALE)).slice(0, SCALE) || '0');
  // Round on the first dropped digit.
  if (frac.length > SCALE && frac.charCodeAt(SCALE) >= 53 /* '5' */) units += 1n;
  return sign ? -units : units;
}

function fromNumberText(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Not a finite number: ${n}`);
  // toFixed(SCALE + 1) gives the binary value's decimal expansion; toUnits then rounds once.
  return Math.abs(n) < 1e21 ? n.toFixed(SCALE + 1) : BigInt(Math.round(n)).toString();
}

/** Scaled units back to a decimal string, trimming insignificant zeros. */
export function fromUnits(units: bigint): Decimal {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const int = abs / FACTOR;
  const frac = (abs % FACTOR).toString().padStart(SCALE, '0').replace(/0+$/, '');
  const text = frac ? `${int}.${frac}` : `${int}`;
  return negative && text !== '0' ? `-${text}` : text;
}

const divRound = (num: bigint, den: bigint): bigint => {
  if (den === 0n) throw new Error('Division by zero');
  const q = num / den, r = num % den;
  if (r === 0n) return q;
  const twice = (r < 0n ? -r : r) * 2n, absDen = den < 0n ? -den : den;
  if (twice < absDen) return q;
  return (num < 0n) !== (den < 0n) ? q - 1n : q + 1n;
};

export const dec = {
  from: (v: Decimal | number) => fromUnits(toUnits(v)),
  add: (a: Decimal, b: Decimal) => fromUnits(toUnits(a) + toUnits(b)),
  sub: (a: Decimal, b: Decimal) => fromUnits(toUnits(a) - toUnits(b)),
  mul: (a: Decimal, b: Decimal) => fromUnits(divRound(toUnits(a) * toUnits(b), FACTOR)),
  div: (a: Decimal, b: Decimal) => fromUnits(divRound(toUnits(a) * FACTOR, toUnits(b))),
  /** a / b × 100 */
  percent: (a: Decimal, b: Decimal) => fromUnits(divRound(toUnits(a) * FACTOR * 100n, toUnits(b))),
  /** a ÷ integer count */
  divInt: (a: Decimal, n: number) => fromUnits(divRound(toUnits(a), BigInt(n))),
  sum: (values: Decimal[]) => fromUnits(values.reduce((acc, v) => acc + toUnits(v), 0n)),
  cmp: (a: Decimal, b: Decimal) => { const d = toUnits(a) - toUnits(b); return d < 0n ? -1 : d > 0n ? 1 : 0; },
  isZero: (a: Decimal) => toUnits(a) === 0n,
  isNegative: (a: Decimal) => toUnits(a) < 0n,
  abs: (a: Decimal) => { const u = toUnits(a); return fromUnits(u < 0n ? -u : u); },
  max: (values: Decimal[]) => values.reduce((m, v) => (toUnits(v) > toUnits(m) ? v : m)),
  min: (values: Decimal[]) => values.reduce((m, v) => (toUnits(v) < toUnits(m) ? v : m)),
  /** Largest multiple of `step` ≤ a (quantities: never round a size up). */
  floorToStep: (a: Decimal, step: Decimal) => {
    const u = toUnits(a), s = toUnits(step);
    const q = u / s;
    return fromUnits((u < 0n && q * s !== u ? q - 1n : q) * s);
  },
  /** Smallest multiple of `step` ≥ a. */
  ceilToStep: (a: Decimal, step: Decimal) => {
    const u = toUnits(a), s = toUnits(step);
    const q = u / s;
    return fromUnits((u > 0n && q * s !== u ? q + 1n : q) * s);
  },
  isMultipleOf: (a: Decimal, step: Decimal) => toUnits(a) % toUnits(step) === 0n,
  /** Rounds to the nearest multiple of `step` (e.g. a tick size of 0.01 or a lot size of 0.00001). */
  roundToStep: (a: Decimal, step: Decimal) => {
    const s = toUnits(step);
    if (s <= 0n) throw new Error(`Invalid step ${step}`);
    return fromUnits(divRound(toUnits(a), s) * s);
  },
  /** Rounds to `places` decimals (for display-precision columns such as NUMERIC(18,8)). */
  round: (a: Decimal, places: number) => {
    const step = 10n ** BigInt(SCALE - places);
    return fromUnits(divRound(toUnits(a), step) * step);
  },
};
