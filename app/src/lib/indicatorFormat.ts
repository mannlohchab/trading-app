import type { EconomicIndicator } from './economics';

export type IndicatorSort = 'Highest' | 'Lowest' | 'Biggest move' | 'A–Z';

/** World Bank regional / income aggregates (ISO3-style codes); the income groups use two-letter ids (XD, XM, XN, XT). */
const WORLD_BANK_AGGREGATES = new Set(('AFE AFW ARB CEB CSS EAP EAR EAS ECA ECS EMU EUU FCS HIC HPC IBD IBT IDA IDB IDX INX LAC LCN LDC LIC LMC '
  + 'LMY LTE MEA MIC MNA NAC OED OSS PRE PSS PST SAS SSA SSF SST TEA TEC TLA TMN TSA TSS UMC WLD').split(' '));
/** Countries always carry a three-letter ISO code; anything else is a region or income group. */
export function isAggregateEconomy(id: string) {
  return id.length !== 3 || WORLD_BANK_AGGREGATES.has(id.toUpperCase());
}

const currencyUnit = (unit: string) => /US\$/.test(unit);
const percentUnit = (unit: string) => unit.trim().startsWith('%');

/** World Bank values arrive as unrounded strings; null when not numeric. */
export function indicatorNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatIndicatorValue(value: string | null | undefined, unit: string): string {
  const n = indicatorNumber(value);
  if (n === null) return value?.trim() ? value : '—';
  if (currencyUnit(unit)) {
    const abs = Math.abs(n), sign = n < 0 ? '−' : '';
    for (const [size, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const) {
      if (abs >= size) return `${sign}$${(abs / size).toFixed(2)}${suffix}`;
    }
    return `${sign}$${abs.toFixed(0)}`;
  }
  const fixed = Math.abs(n).toFixed(1);
  return `${n < 0 ? '−' : ''}${fixed}${percentUnit(unit) ? '%' : ''}`;
}

/** Change from the previous observation: percentage points for % units, relative % otherwise. */
export function indicatorChange(item: Pick<EconomicIndicator, 'latest' | 'previous' | 'unit'>) {
  const latest = indicatorNumber(item.latest), previous = indicatorNumber(item.previous);
  if (latest === null || previous === null) return null;
  const points = percentUnit(item.unit);
  if (!points && previous === 0) return null;
  const delta = points ? latest - previous : (latest - previous) / Math.abs(previous) * 100;
  const rounded = Math.round(delta * 10) / 10;
  const direction = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
  const label = direction === 'flat' ? 'No change' : `${direction === 'up' ? '▲' : '▼'} ${Math.abs(rounded).toFixed(1)}${points ? ' pts' : '%'}`;
  return { delta, direction, label } as const;
}

export function sortIndicators<T extends Pick<EconomicIndicator, 'country' | 'latest' | 'previous' | 'unit'>>(items: T[], sort: IndicatorSort): T[] {
  const value = (item: T) => indicatorNumber(item.latest);
  const move = (item: T) => { const change = indicatorChange(item); return change ? Math.abs(change.delta) : -1; }; // no change data ranks last
  const byCountry = (a: T, b: T) => a.country.localeCompare(b.country);
  return [...items].sort((a, b) => {
    if (sort === 'A–Z') return byCountry(a, b);
    if (sort === 'Biggest move') return move(b) - move(a) || byCountry(a, b);
    const va = value(a), vb = value(b);
    if (va === null || vb === null) return va === vb ? byCountry(a, b) : va === null ? 1 : -1; // missing values last
    return (sort === 'Highest' ? vb - va : va - vb) || byCountry(a, b);
  });
}

export function indicatorSummary<T extends Pick<EconomicIndicator, 'country' | 'latest'>>(items: T[]) {
  const numeric = items.flatMap(item => { const n = indicatorNumber(item.latest); return n === null ? [] : [{ item, n }]; });
  if (!numeric.length) return null;
  const sorted = [...numeric].sort((a, b) => a.n - b.n);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid].n : (sorted[mid - 1].n + sorted[mid].n) / 2;
  return { count: numeric.length, median, lowest: sorted[0], highest: sorted[sorted.length - 1],
    maxAbs: Math.max(...numeric.map(entry => Math.abs(entry.n))) };
}

/** One plain-language sentence pair summarising an indicator for quick reading. */
export function indicatorNarrative(summary: NonNullable<ReturnType<typeof indicatorSummary>>, unit: string, noun = 'economies') {
  const value = (n: number) => formatIndicatorValue(String(n), unit);
  const { highest, lowest } = summary;
  const range = highest.item.country === lowest.item.country
    ? `${highest.item.country} reports ${value(highest.n)}.`
    : `${highest.item.country} leads at ${value(highest.n)}, while ${lowest.item.country} is lowest at ${value(lowest.n)}.`;
  return `${range} The median across ${summary.count.toLocaleString('en-US')} ${summary.count === 1 ? noun.replace(/ies$/, 'y').replace(/s$/, '') : noun} is ${value(summary.median)}.`;
}
