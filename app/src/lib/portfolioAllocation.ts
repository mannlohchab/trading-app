export type AllocationKey = 'holdings' | 'cash';
export type PortfolioAllocationInput = {
  equity: number;
  cashBalance: number;
  positions: { marketValue: number }[];
};

export function buildPortfolioAllocation(portfolio?: PortfolioAllocationInput) {
  if (!portfolio) return null;
  const values = [portfolio.equity, portfolio.cashBalance, ...portfolio.positions.map(p => p.marketValue)];
  if (values.some(value => !Number.isFinite(value) || value < 0)) return null;
  const holdings = portfolio.positions.reduce((sum, position) => sum + position.marketValue, 0);
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
