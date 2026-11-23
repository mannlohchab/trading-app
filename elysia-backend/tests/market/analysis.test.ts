import { expect, test } from 'bun:test';
import { bollinger, ema, macd, rsi, sma, summarizeMarket } from '../../src/modules/market/domain/analysis';
import { candle } from '../helpers/fake-market';

test('moving averages', () => {
  expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
  expect(sma([1, 2], 5)).toBeNull();
  expect(ema([1, 2, 3, 4, 5], 5)).toBe(3); // seed is the SMA
  expect(ema([2, 4, 6, 8, 10, 12], 5)).toBeCloseTo(6 + (12 - 6) / 3); // k = 1/3
});

test('RSI is 100 on only gains, 0 on only losses, and ~50 on alternating moves', () => {
  expect(rsi([...Array(20).keys()])).toBe(100);
  expect(rsi([...Array(20).keys()].reverse())).toBe(0);
  const alternating = rsi(Array.from({ length: 60 }, (_, i) => (i % 2 ? 11 : 10)))!;
  expect(alternating).toBeGreaterThan(45); // Wilder smoothing leans toward the latest move (51.9 here)
  expect(alternating).toBeLessThan(55);
  expect(rsi([1, 2, 3])).toBeNull();
});

test('MACD and Bollinger behave on a rising series', () => {
  const up = Array.from({ length: 60 }, (_, i) => 100 + i);
  expect(macd(up)!.macd).toBeGreaterThan(0);
  const flat = bollinger(Array(20).fill(5))!;
  expect(flat).toEqual({ upper: 5, middle: 5, lower: 5 });
});

test('summary describes trend, momentum and levels from closed candles only', () => {
  const series = Array.from({ length: 60 }, (_, i) => candle(i * 60_000, String(100 + i)));
  const s = summarizeMarket([...series, candle(60 * 60_000, '1', false)])!;
  expect(s).toMatchObject({ candles: 60, lastClose: 159, trend: 'UP', rsiState: 'OVERBOUGHT', support: 130, resistance: 159 });
  expect(s.changePercent).toBe(59);
  expect(summarizeMarket([candle(0, '1')])).toBeNull();
});
