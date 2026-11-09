import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// paperTrading.ts imports the API client; load it with those modules stubbed out.
const { orderProblem, requiredCash, toPortfolio } = (() => {
  const source = readFileSync(new URL('../src/lib/paperTrading.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const modules = { './api': { api: () => { throw new Error('No network in unit tests'); } }, './demoMode': { DEMO_MODE: false }, './marketData': { pairName: s => s } };
  const exports = {};
  runInNewContext(outputText, { exports, require: name => modules[name] });
  return exports;
})();

const now = 1_800_000_000_000;
const base = { symbol: 'BTCUSDT', exchange: 'BINANCE', side: 'BUY', orderType: 'MARKET', quantity: '1', limitPrice: '',
  // 1 unit at 100 holds 100 × 1.02 (market buffer) × 1.001 (commission) = 102.102 on the backend.
  portfolio: { availableCash: 103, positions: [] }, quote: { ltp: 100, asOf: now / 1000 }, now };
test('the cash check mirrors the backend reservation: 2% market buffer plus 0.1% commission', () => {
  assert.ok(Math.abs(requiredCash('MARKET', 100, 1) - 102.102) < 1e-9);
  assert.ok(Math.abs(requiredCash('LIMIT', 100, 1) - 100.1) < 1e-9);
  assert.match(orderProblem({ ...base, portfolio: { availableCash: 102, positions: [] } }), /cash/i);
  assert.equal(orderProblem({ ...base, orderType: 'LIMIT', limitPrice: '100', portfolio: { availableCash: 100.1, positions: [] } }), null);
});
test('paper buys cannot exceed the backend available cash', () => {
  assert.equal(orderProblem(base), null);
  assert.match(orderProblem({ ...base, quantity: '1.01' }), /cash/i);
  assert.match(orderProblem({ ...base, portfolio: undefined }), /account|balance/i);
});
test('paper sells require available holdings for the exact exchange and pair', () => {
  const sell = { ...base, side: 'SELL' };
  assert.match(orderProblem(sell), /own|hold|quantity/i);
  const portfolio = { availableCash: 100, positions: [{ symbol: 'BTCUSDT', exchange: 'BINANCE', availableQuantity: 0.5 }] };
  assert.equal(orderProblem({ ...sell, portfolio, quantity: '0.5' }), null);
  assert.match(orderProblem({ ...sell, portfolio }), /quantity|hold/i);
  assert.match(orderProblem({ ...sell, portfolio, symbol: 'ETHUSDT' }), /own|hold|quantity/i);
});
test('paper orders reject missing, stale, closed, invalid and demo quotes', () => {
  for (const quote of [undefined, { ltp: NaN }, { ltp: 100, asOf: now / 1000 - 3600 },
    { ...base.quote, stale: true }, { ...base.quote, marketOpen: false }]) assert.ok(orderProblem({ ...base, quote }));
  assert.match(orderProblem({ ...base, isDemo: true }), /preview/i);
});
test('limits reserve at the limit price and quantities retain eight decimals', () => {
  assert.match(orderProblem({ ...base, orderType: 'LIMIT', limitPrice: '110' }), /cash/i);
  assert.equal(orderProblem({ ...base, quantity: '0.00000001' }), null);
  for (const quantity of ['0', '-1', 'Infinity', '1e2', '0.000000001', '']) assert.ok(orderProblem({ ...base, quantity }));
  assert.match(orderProblem({ ...base, orderType: 'LIMIT', limitPrice: '0' }), /limit/i);
});

test('backend portfolios map so invested value plus uninvested cash equals equity', () => {
  const p = toPortfolio({
    accountId: 'a', initialBalance: '10000', cashBalance: '9995.64', availableBalance: '9622.79', reservedBalance: '372.85',
    totalEquity: '9995.82', realizedPnl: '-1.24', unrealizedPnl: '0.18', totalFees: '3.12', netPnl: '-4.18', returnPercent: '-0.0418',
    unpricedSymbols: [],
    openPositions: [{ id: 'p', exchange: 'BINANCE', symbol: 'BTCUSDT', side: 'LONG', status: 'OPEN', quantity: '0.005',
      averageEntryPrice: '74569.26', collateral: '372.85', markPrice: '74606.01', unrealizedPnl: '0.18', exposure: '373.03' }],
  });
  assert.equal(p.availableCash, 9622.79);
  assert.ok(Math.abs(p.reservedCash) < 1e-9); // all reserved funds back the position, none back open orders
  assert.ok(Math.abs(p.invested - 372.85) < 1e-9);
  assert.ok(Math.abs(p.cashBalance + p.positions[0].marketValue - p.equity) < 1e-6);
  assert.equal(p.positions[0].availableQuantity, 0.005);
  assert.equal(p.valuationStatus, 'current');
  const unpriced = toPortfolio({ ...{ accountId: 'a', initialBalance: '1', cashBalance: '1', availableBalance: '1', reservedBalance: '0', totalEquity: '1',
    realizedPnl: '0', unrealizedPnl: '0', totalFees: '0', netPnl: '0', returnPercent: '0' }, openPositions: [], unpricedSymbols: ['BTCUSDT'] });
  assert.equal(unpriced.equity, null); // never shows a total built from missing prices
});
