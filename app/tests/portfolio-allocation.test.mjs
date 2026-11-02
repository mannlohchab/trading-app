import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPortfolioAllocation, portfolioArc } from '../src/lib/portfolioAllocation.ts';

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
