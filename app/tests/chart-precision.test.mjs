import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candlePrecision } from '../src/lib/pricePrecision.ts';

const candle = (close, extra = {}) => ({ open: close, high: close, low: close, close, ...extra });

test('chart precision does not flip with the last digit of the latest close', () => {
  // XRP ticks at 0.0001: a close ending in 0 used to drop the chart to 3 decimals and rebuild it.
  const history = [candle('1.113600000000'), candle('1.112100000000')];
  assert.equal(candlePrecision([...history, candle('1.113000000000')]), 4);
  assert.equal(candlePrecision([...history, candle('1.110000000000')]), 4);
  assert.equal(candlePrecision([...history, candle('1.113600000000')]), 4);
});

test('uses every price in the bar, with a 2-decimal floor and 8-decimal cap', () => {
  assert.equal(candlePrecision([candle('70123.000000000000')]), 2);
  assert.equal(candlePrecision([candle('0.5', { low: '0.48712' })]), 5);
  assert.equal(candlePrecision([candle('0.000000012345')]), 8);
  assert.equal(candlePrecision([]), 2);
});
