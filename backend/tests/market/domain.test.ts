import { expect, test } from 'bun:test';
import { decimalPlaces, isValidCandle, normalizeDecimal, parseTopic, topicKey } from '../../src/modules/market/domain/rules';
import { candle } from '../helpers/fake-market';

test('topics parse, normalize and round-trip', () => {
  expect(parseTopic('ticker:binance:btcusdt')).toEqual({ kind: 'ticker', exchange: 'BINANCE', symbol: 'BTCUSDT' });
  const c = parseTopic('candles:BINANCE:ETHUSDT:1M');
  expect(c).toEqual({ kind: 'candles', exchange: 'BINANCE', symbol: 'ETHUSDT', timeframe: '1M' });
  expect(topicKey(c!)).toBe('candles:BINANCE:ETHUSDT:1M');
  for (const bad of ['ticker:BINANCE', 'ticker:BINANCE:BTCUSDT:1m', 'candles:BINANCE:BTCUSDT:2h', 'trades:BINANCE:BTCUSDT', 'ticker:BIN ANCE:BTC', 'x'.repeat(100)]) {
    expect(parseTopic(bad)).toBeNull();
  }
});

test('decimals are normalized without float conversion', () => {
  expect(normalizeDecimal('73886.01000000')).toBe('73886.01');
  expect(normalizeDecimal('0.00000000')).toBe('0');
  expect(normalizeDecimal('-2.71100')).toBe('-2.711');
  expect(normalizeDecimal('100')).toBe('100');
  expect(normalizeDecimal('123456789012345678.123456789012')).toBe('123456789012345678.123456789012');
  expect(() => normalizeDecimal('1e5')).toThrow();
  expect(decimalPlaces('0.01000000')).toBe(2);
  expect(decimalPlaces('1.00000000')).toBe(0);
});

test('candles that would violate the database constraints are rejected', () => {
  expect(isValidCandle(candle(0, '10'))).toBe(true);
  expect(isValidCandle({ ...candle(0, '10'), high: '9' })).toBe(false);
  expect(isValidCandle({ ...candle(0, '10'), volume: '-1' })).toBe(false);
  expect(isValidCandle({ ...candle(0, '10'), closeTime: -1 })).toBe(false);
});
