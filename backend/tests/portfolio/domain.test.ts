import { describe, expect, test } from 'bun:test';
import { pricingSymbol, trimDecimal, validateHoldings, valuePortfolio, type PricedLot } from '../../src/modules/portfolio/domain/holdings';

const TODAY = '2026-11-19';
const row = (over: Partial<{ asset: string; quantity: string; boughtOn: string; buyPrice: string | null }> = {}) =>
  ({ asset: 'btc', quantity: '0.5', boughtOn: '2025-01-10', buyPrice: '60000', ...over });

describe('validateHoldings', () => {
  test('normalises a valid table', () => {
    const result = validateHoldings([row({ asset: '  hdfc   bank ', quantity: '10.500', buyPrice: '' })], TODAY);
    expect(result).toEqual({ ok: true, holdings: [{ asset: 'HDFC BANK', quantity: '10.5', boughtOn: '2025-01-10', buyPrice: null }] });
  });

  test('marks each bad cell by row and field', () => {
    const result = validateHoldings([
      row(),
      row({ asset: '', quantity: '0', boughtOn: '2025-02-30', buyPrice: '-1' }),
      row({ asset: 'BTC<script>', quantity: '1,000', boughtOn: '2026-11-25' }),
      row({ boughtOn: '1980-01-01' }),
    ], TODAY);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual([
      'holdings.1.asset', 'holdings.1.boughtOn', 'holdings.1.buyPrice', 'holdings.1.quantity',
      'holdings.2.asset', 'holdings.2.boughtOn', 'holdings.2.quantity', 'holdings.3.boughtOn',
    ]);
  });

  test('allows tomorrow (users ahead of UTC) but not later', () => {
    expect(validateHoldings([row({ boughtOn: '2026-11-20' })], TODAY).ok).toBe(true);
    expect(validateHoldings([row({ boughtOn: '2026-11-21' })], TODAY).ok).toBe(false);
  });

  test('caps the table size', () => {
    expect(validateHoldings(Array.from({ length: 101 }, () => row()), TODAY)).toEqual({ ok: false, errors: { holdings: 'At most 100 rows.' } });
  });
});

describe('valuePortfolio', () => {
  const lot = (over: Partial<PricedLot>): PricedLot =>
    ({ asset: 'BTC', quantity: '1', boughtOn: '2025-11-19', buyPrice: null, symbol: 'BTCUSDT', currentPrice: 100, closeOnBuyDate: null, ...over });
  const now = new Date('2026-11-19T10:00:00Z');

  test('merges lots per asset and computes P/L, shares and concentration', () => {
    const v = valuePortfolio([
      lot({ quantity: '1', buyPrice: '50', boughtOn: '2025-11-19' }),
      lot({ quantity: '1', closeOnBuyDate: 150, boughtOn: '2026-05-01' }),
      lot({ asset: 'ETH', symbol: 'ETHUSDT', quantity: '10', buyPrice: '10', currentPrice: 5 }),
      lot({ asset: 'RELIANCE', symbol: null, currentPrice: null, buyPrice: '2500', quantity: '4' }),
    ], now);

    const [btc, eth, reliance] = v.positions;
    expect(btc).toMatchObject({
      asset: 'BTC', lots: 2, quantity: 2, firstBoughtOn: '2025-11-19', lastBoughtOn: '2026-05-01', daysHeld: 365,
      avgBuyPrice: 100, buyPriceSource: 'MIXED', cost: 200, value: 200, pnl: 0, pnlPercent: 0, sharePercent: 80,
    });
    expect(eth).toMatchObject({ value: 50, cost: 100, pnl: -50, pnlPercent: -50, sharePercent: 20, buyPriceSource: 'ENTERED' });
    expect(reliance).toMatchObject({ asset: 'RELIANCE', value: null, cost: 10000, pnl: null, sharePercent: null });
    expect(v.totals).toEqual({ value: 250, cost: 300, pnl: -50, pnlPercent: -16.67, pricedPositions: 2, positionsInProfit: 0, positionsInLoss: 1 });
    expect(v.concentration).toEqual({ largestAsset: 'BTC', largestSharePercent: 80, top3SharePercent: 100 });
    expect(v.unpricedAssets).toEqual(['RELIANCE']);
  });

  test('leaves cost unknown when any lot has no buy price', () => {
    const v = valuePortfolio([lot({ buyPrice: '50' }), lot({})], now);
    expect(v.positions[0]).toMatchObject({ cost: null, pnl: null, buyPriceSource: 'UNKNOWN', value: 200 });
    expect(v.totals).toMatchObject({ value: 200, cost: 0, pnl: 0, pnlPercent: null });
  });

  test('handles an empty table', () => {
    const v = valuePortfolio([], now);
    expect(v).toMatchObject({ lots: 0, positions: [], unpricedAssets: [], concentration: { largestAsset: null } });
  });
});

test('pricingSymbol and trimDecimal', () => {
  expect(pricingSymbol('BTC')).toBe('BTCUSDT');
  expect(pricingSymbol('BTC/USDT')).toBe('BTCUSDT');
  expect(pricingSymbol('BTCUSDT')).toBe('BTCUSDT');
  expect(pricingSymbol('HDFC BANK')).toBe('HDFCBANKUSDT');
  expect(pricingSymbol('M&M')).toBeNull();
  expect(trimDecimal('0.500000000000')).toBe('0.5');
  expect(trimDecimal('10.000000000000')).toBe('10');
  expect(trimDecimal('100')).toBe('100');
});
