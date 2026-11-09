import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPortfolioAllocation, buildPortfolioBreakdown, portfolioArc } from '../src/lib/portfolioAllocation.ts';

test('allocation uses current holdings and cash without double counting profit', () => {
  const allocation = buildPortfolioAllocation({ equity: 186000, cashBalance: 60000,
    positions: [{ marketValue: 80000 }, { marketValue: 46000 }] });
  assert.equal(allocation.total, 186000);
  assert.equal(allocation.holdings, 126000);
  assert.equal(allocation.cash, 60000);
  assert.ok(Math.abs(allocation.segments[0].share - 126000 / 186000) < 1e-10);
  assert.equal(allocation.segments.reduce((total, segment) => total + segment.share, 0), 1);
  assert.equal(allocation.segments[0].start, 42);
  assert.equal(allocation.segments.at(-1).end, 318);
});

test('losses are represented by lower holding values, with no negative slices', () => {
  const allocation = buildPortfolioAllocation({ equity: 750, cashBalance: 250, positions: [{ marketValue: 500 }] });
  assert.equal(allocation.holdings, 500);
  assert.ok(allocation.segments.every(segment => segment.share >= 0 && segment.end > segment.start));
});

test('cash-only, fully-invested and empty accounts have honest allocations', () => {
  const cash = buildPortfolioAllocation({ equity: 1000000, cashBalance: 1000000, positions: [] });
  assert.equal(cash.segments.length, 1);
  assert.equal(cash.segments[0].key, 'cash');
  assert.equal(cash.segments[0].share, 1);
  const invested = buildPortfolioAllocation({ equity: 500, cashBalance: 0, positions: [{ marketValue: 500 }] });
  assert.equal(invested.segments.length, 1);
  assert.equal(invested.segments[0].key, 'holdings');
  const empty = buildPortfolioAllocation({ equity: 0, cashBalance: 0, positions: [] });
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.segments, []);
});

test('missing, invalid or inconsistent valuations never produce a misleading allocation', () => {
  assert.equal(buildPortfolioAllocation(undefined), null);
  for (const portfolio of [
    { equity: NaN, cashBalance: 100, positions: [] },
    { equity: 100, cashBalance: -10, positions: [{ marketValue: 110 }] },
    { equity: 100, cashBalance: 100, positions: [{ marketValue: Infinity }] },
    { equity: 100, cashBalance: 10, positions: [{ marketValue: 10 }] },
  ]) assert.equal(buildPortfolioAllocation(portfolio), null);
});

test('arc geometry follows the requested sweep and never draws a complete phantom circle', () => {
  assert.equal(portfolioArc(0, 90), 'M 160.000 42.000 A 118 118 0 0 1 278.000 160.000');
  assert.ok(portfolioArc(42, 318).includes('A 118 118 0 1 1'));
  assert.equal(portfolioArc(42, 42), '');
});

test('breakdown gives each holding its own segment, largest first, then cash', () => {
  const breakdown = buildPortfolioBreakdown({ equity: 1000, cashBalance: 400, positions: [
    { symbol: 'ETHUSDT', marketValue: 200 }, { symbol: 'BTCUSDT', marketValue: 350 }, { symbol: 'BTCUSDT', marketValue: 50 },
  ] });
  assert.deepEqual(breakdown.segments.map(s => [s.label, s.value]), [['BTCUSDT', 400], ['ETHUSDT', 200], ['Cash', 400]]);
  assert.ok(Math.abs(breakdown.segments.reduce((sum, s) => sum + s.share, 0) - 1) < 1e-10);
  assert.equal(new Set(breakdown.segments.map(s => s.color)).size, 3);
});

test('breakdown groups a long tail into Others but never hides a single extra holding', () => {
  const positions = n => Array.from({ length: n }, (_, i) => ({ symbol: `C${i}`, marketValue: 100 - i }));
  const total = n => positions(n).reduce((sum, p) => sum + p.marketValue, 0);
  const six = buildPortfolioBreakdown({ equity: total(6), cashBalance: 0, positions: positions(6) });
  assert.equal(six.segments.length, 6);
  assert.ok(six.segments.every(s => s.key !== 'others'));
  const nine = buildPortfolioBreakdown({ equity: total(9), cashBalance: 0, positions: positions(9) });
  assert.equal(nine.segments.length, 6);
  assert.equal(nine.segments.at(-1).label, 'Others (4)');
  assert.equal(nine.segments.at(-1).value, 95 + 94 + 93 + 92);
});

test('breakdown is unavailable whenever the underlying valuation is', () => {
  assert.equal(buildPortfolioBreakdown(undefined), null);
  assert.equal(buildPortfolioBreakdown({ equity: 100, cashBalance: 10, positions: [{ symbol: 'X', marketValue: 10 }] }), null);
  assert.deepEqual(buildPortfolioBreakdown({ equity: 0, cashBalance: 0, positions: [] }).segments, []);
});
