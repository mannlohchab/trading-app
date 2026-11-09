export type AllocationKey = 'holdings' | 'cash';
export type PortfolioAllocationInput = {
  equity: number | null;
  cashBalance: number;
  positions: { marketValue: number | null; symbol?: string }[];
};

export function buildPortfolioAllocation(portfolio?: PortfolioAllocationInput) {
  if (!portfolio || portfolio.equity === null) return null;
  const values = [portfolio.equity, portfolio.cashBalance, ...portfolio.positions.map(p => p.marketValue)];
  if (values.some(value => value === null || !Number.isFinite(value) || value < 0)) return null;
  const holdings = portfolio.positions.reduce((sum, position) => sum + position.marketValue!, 0);
  const cash = portfolio.cashBalance;
  const total = holdings + cash;
  if (!Number.isFinite(total) || Math.abs(total - portfolio.equity) > 0.02) return null;
  let angle = 42;
  const segments = ([{ key: 'holdings', label: 'Invested', value: holdings }, { key: 'cash', label: 'Cash', value: cash }] as const)
    .filter(segment => segment.value > 0)
    .map(segment => {
      const share = segment.value / total;
      const start = angle;
      angle += share * 276;
      return { ...segment, share, start, end: angle };
    });
  return { total, holdings, cash, segments };
}

export function portfolioPoint(angle: number, radius = 118) {
  const radians = (angle - 90) * Math.PI / 180;
  return { x: 160 + radius * Math.cos(radians), y: 160 + radius * Math.sin(radians) };
}

export function portfolioArc(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '';
  const a = portfolioPoint(start), b = portfolioPoint(end);
  return `M ${a.x.toFixed(3)} ${a.y.toFixed(3)} A 118 118 0 ${end - start > 180 ? 1 : 0} 1 ${b.x.toFixed(3)} ${b.y.toFixed(3)}`;
}

/** Bright, distinct colours for the largest holdings, in order. */
export const HOLDING_COLORS = ['#2F7BFF', '#06B6D4', '#6366F1', '#F97316', '#F59E0B'] as const;
export const OTHERS_COLOR = '#94A3B8';
export const CASH_COLOR = '#22C55E';

export type BreakdownSegment = { key: string; label: string; value: number; share: number; color: string };

/**
 * Splits the portfolio into one segment per holding (largest first), then "Others", then cash.
 * Built on `buildPortfolioAllocation`, so it is null whenever that valuation is incomplete or inconsistent.
 */
export function buildPortfolioBreakdown(portfolio?: PortfolioAllocationInput, maxHoldings = HOLDING_COLORS.length) {
  const allocation = buildPortfolioAllocation(portfolio);
  if (!allocation || !portfolio) return null;
  const bySymbol = new Map<string, number>();
  portfolio.positions.forEach((position, index) => {
    const symbol = position.symbol || `Position ${index + 1}`;
    bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + position.marketValue!);
  });
  const holdings = [...bySymbol].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  // Group the tail only when it saves at least two segments' worth of clutter.
  const shown = holdings.length > maxHoldings + 1 ? holdings.slice(0, maxHoldings) : holdings.slice(0, maxHoldings + 1);
  const othersValue = holdings.slice(shown.length).reduce((sum, [, value]) => sum + value, 0);
  const share = (value: number) => allocation.total > 0 ? value / allocation.total : 0;
  const segments: BreakdownSegment[] = shown.map(([symbol, value], i) => ({
    key: `holding:${symbol}`, label: symbol, value, share: share(value), color: HOLDING_COLORS[i % HOLDING_COLORS.length],
  }));
  if (othersValue > 0) segments.push({ key: 'others', label: `Others (${holdings.length - shown.length})`, value: othersValue, share: share(othersValue), color: OTHERS_COLOR });
  if (allocation.cash > 0) segments.push({ key: 'cash', label: 'Cash', value: allocation.cash, share: share(allocation.cash), color: CASH_COLOR });
  return { total: allocation.total, segments };
}
