import { describe, expect, test } from 'bun:test';
import { dec } from '../../src/modules/backtesting';
import { commissionFor, decideFill, marketFillPrice } from '../../src/modules/paper-trading/execution/order-fill.engine';
import { reservationFor, reservationPrice, validateAgainstSymbol } from '../../src/modules/paper-trading/orders/order-manager';
import { exposure, lossRatio, returnPercent, unrealizedPnl } from '../../src/modules/paper-trading/portfolio/pnl.service';
import { applyFill, openingQuantity, reducibleQuantity } from '../../src/modules/paper-trading/positions/position-manager';
import type { Quote, SymbolRules } from '../../src/modules/paper-trading/paper-trading.types';

const rules: SymbolRules = { id: 's', exchange: 'BINANCE', symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', tickSize: '0.01', lotSize: '0.00001', minQuantity: '0.00001', minNotional: '5' };
const now = 1_800_000_000_000;
const quote = (last: string, bid?: string, ask?: string, age = 0): Quote => ({ last, bid: bid ?? null, ask: ask ?? null, time: now - age, source: 'stream' });
const settings = { commissionPercent: '0.1', slippageBps: 5, maxQuoteAgeMs: 15_000, tickSize: '0.01' };

describe('position accounting (one-way)', () => {
  test('open, increase at a new average, partially close, close', () => {
    const open = applyFill(null, 'BUY', '1', '100');
    expect(open).toMatchObject({ after: { side: 'LONG', quantity: '1', averageEntryPrice: '100', collateral: '100' }, openedQuantity: '1', marginAdded: '100', realizedPnl: '0' });
    const add = applyFill(open.after, 'BUY', '3', '120');
    expect(add.after).toEqual({ side: 'LONG', quantity: '4', averageEntryPrice: '115', collateral: '460' });
    const part = applyFill(add.after, 'SELL', '1', '130');
    expect(part).toMatchObject({ after: { quantity: '3', averageEntryPrice: '115', collateral: '345' }, closedQuantity: '1', realizedPnl: '15', marginReleased: '115', openedQuantity: '0' });
    const close = applyFill(part.after, 'SELL', '3', '110');
    expect(close).toMatchObject({ after: null, closedQuantity: '3', realizedPnl: '-15', marginReleased: '345' });
  });

  test('a non-terminating average never leaves collateral dust after a full close', () => {
    const a = applyFill(applyFill(null, 'BUY', '1', '100').after, 'BUY', '2', '101').after!;
    expect(a.averageEntryPrice).toBe('100.666666666667'); // rounded…
    expect(a.collateral).toBe('302'); // …but the cost basis is exact
    const third = applyFill(a, 'SELL', '1', '110');
    const rest = applyFill(third.after, 'SELL', '2', '110');
    expect(dec.add(third.marginReleased, rest.marginReleased)).toBe('302'); // everything locked is released
    expect(dec.add(third.realizedPnl, rest.realizedPnl)).toBe('28'); // 330 − 302, exactly
  });

  test('shorts profit when price falls', () => {
    const short = applyFill(null, 'SELL', '2', '50');
    expect(short.after).toEqual({ side: 'SHORT', quantity: '2', averageEntryPrice: '50', collateral: '100' });
    expect(applyFill(short.after, 'BUY', '2', '40')).toMatchObject({ after: null, realizedPnl: '20' });
    expect(applyFill(short.after, 'BUY', '1', '55').realizedPnl).toBe('-5');
  });

  test('crossing zero reverses at the fill price', () => {
    const r = applyFill({ side: 'LONG', quantity: '2', averageEntryPrice: '100', collateral: '200' }, 'SELL', '5', '90');
    expect(r).toMatchObject({ reversed: true, closedQuantity: '2', openedQuantity: '3', realizedPnl: '-20', marginReleased: '200', marginAdded: '270', after: { side: 'SHORT', quantity: '3', averageEntryPrice: '90', collateral: '270' } });
  });

  test('exact decimals over many fills', () => {
    let p = applyFill(null, 'BUY', '0.1', '0.1').after;
    for (let i = 0; i < 9; i++) p = applyFill(p, 'BUY', '0.1', '0.1').after;
    expect(p).toEqual({ side: 'LONG', quantity: '1', averageEntryPrice: '0.1', collateral: '0.1' });
  });

  test('opening vs reducing quantity', () => {
    const long = { side: 'LONG' as const, quantity: '2', averageEntryPrice: '100', collateral: '200' };
    expect(openingQuantity(long, 'SELL', '5', false)).toBe('3');
    expect(openingQuantity(long, 'SELL', '1', false)).toBe('0');
    expect(openingQuantity(long, 'BUY', '1', false)).toBe('1');
    expect(openingQuantity(long, 'SELL', '5', true)).toBe('0');
    expect(reducibleQuantity(long, 'SELL', '5')).toBe('2');
    expect(reducibleQuantity(long, 'BUY', '5')).toBe('0');
  });
});

describe('fill rules', () => {
  const market = { type: 'MARKET' as const, limitPrice: null, stopPrice: null, triggered: false, marketableOnArrival: false };

  test('market orders fill at the touch, slipped against the order, on the tick grid', () => {
    expect(decideFill({ ...market, side: 'BUY' }, quote('100', '99.98', '100.02'), now, settings)).toEqual({ kind: 'fill', price: '100.08', liquidity: 'taker', reference: '100.02' }); // 100.02 × 1.0005 = 100.07001 → up
    expect(decideFill({ ...market, side: 'SELL' }, quote('100', '99.98', '100.02'), now, settings)).toMatchObject({ price: '99.93' }); // 99.98 × 0.9995 = 99.93001 → down
    expect(marketFillPrice('BUY', quote('100'), 0, '0.01')).toBe('100'); // no bid/ask: last price
  });

  test('stale quotes never fill', () => {
    expect(decideFill({ ...market, side: 'BUY' }, quote('100', undefined, undefined, 20_000), now, settings)).toEqual({ kind: 'stale', ageMs: 20_000 });
  });

  test('limit orders: eligibility and maker vs taker prices', () => {
    const buy = { side: 'BUY' as const, type: 'LIMIT' as const, limitPrice: '100', stopPrice: null, triggered: false, marketableOnArrival: false };
    expect(decideFill(buy, quote('101', '100.9', '101.1'), now, settings)).toEqual({ kind: 'wait', reason: 'NOT_REACHED' });
    expect(decideFill(buy, quote('99', '98.9', '99.1'), now, settings)).toMatchObject({ kind: 'fill', price: '100', liquidity: 'maker' }); // resting: at the limit
    expect(decideFill({ ...buy, marketableOnArrival: true }, quote('99', '98.9', '99.1'), now, settings)).toMatchObject({ kind: 'fill', price: '99.1', liquidity: 'taker' });
    const sell = { ...buy, side: 'SELL' as const, limitPrice: '110' };
    expect(decideFill(sell, quote('109', '108.9', '109.1'), now, settings).kind).toBe('wait');
    expect(decideFill(sell, quote('112', '111.9', '112.1'), now, settings)).toMatchObject({ price: '110', liquidity: 'maker' });
  });

  test('stop-market orders trigger on the last price and then fill like market orders, including through gaps', () => {
    const stopBuy = { side: 'BUY' as const, type: 'STOP_MARKET' as const, limitPrice: null, stopPrice: '105', triggered: false, marketableOnArrival: false };
    expect(decideFill(stopBuy, quote('104.99'), now, settings).kind).toBe('wait');
    expect(decideFill(stopBuy, quote('105'), now, settings).kind).toBe('trigger');
    expect(decideFill({ ...stopBuy, triggered: true }, quote('120', '119.9', '120.1'), now, { ...settings, slippageBps: 0 })).toMatchObject({ kind: 'fill', price: '120.1' }); // gapped
    const stopSell = { ...stopBuy, side: 'SELL' as const, stopPrice: '95' };
    expect(decideFill(stopSell, quote('95.01'), now, settings).kind).toBe('wait');
    expect(decideFill(stopSell, quote('80'), now, settings).kind).toBe('trigger');
  });

  test('commission is notional × percent, rounded up to 8 decimals', () => {
    expect(commissionFor('0.01234', '73886.01', '0.1')).toBe('0.91175337'); // 0.9117533634 → up
    expect(commissionFor('1', '100', '0')).toBe('0');
  });
});

describe('order rules', () => {
  test('tick, lot, minimum quantity and minimum notional', () => {
    expect(validateAgainstSymbol({ side: 'BUY', type: 'LIMIT', quantity: '0.000015', price: '100.005' }, rules, '100')).toMatchObject({ quantity: expect.stringContaining('lot size'), price: expect.stringContaining('tick size') });
    expect(validateAgainstSymbol({ side: 'BUY', type: 'MARKET', quantity: '0.00001' }, rules, '73886')).toEqual({ quantity: expect.stringContaining('minimum notional') }); // 0.74 USDT
    expect(validateAgainstSymbol({ side: 'BUY', type: 'MARKET', quantity: '0.001' }, rules, '73886')).toEqual({});
  });

  test('reservation: collateral for the opening part plus the commission, with headroom for unknown fill prices', () => {
    expect(reservationPrice({ side: 'BUY', type: 'LIMIT', quantity: '1', price: '100' }, null)).toBe('100');
    expect(reservationPrice({ side: 'BUY', type: 'MARKET', quantity: '1' }, '100')).toBe('102');
    expect(reservationFor('1', '1', '102', '0.1')).toBe('102.102');
    expect(reservationFor('0', '1', '102', '0.1')).toBe('0.102'); // closing order: only the fee
  });
});

describe('P/L', () => {
  test('unrealized, exposure, loss ratio and return', () => {
    const long = { side: 'LONG' as const, quantity: '2', averageEntryPrice: '100', collateral: '200' };
    expect(unrealizedPnl(long, '110')).toBe('20');
    expect(unrealizedPnl({ ...long, side: 'SHORT' }, '110')).toBe('-20');
    expect(exposure(long, '110')).toBe('220');
    expect(lossRatio({ ...long, side: 'SHORT' }, '200')).toBe('1'); // short collateral gone at 2× price
    expect(returnPercent('10500', '10000')).toBe('5');
    expect(dec.floorToStep('0.123456789', '0.00001')).toBe('0.12345');
    expect(dec.ceilToStep('0.123451', '0.00001')).toBe('0.12346');
  });
});
