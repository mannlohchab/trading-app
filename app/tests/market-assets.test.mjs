import assert from 'node:assert/strict';
import { test } from 'node:test';
import { marketAssets } from '../src/lib/marketAssets.ts';

test('market symbols split into base and quote assets for their icons', () => {
  assert.deepEqual(marketAssets('EUR/USD', 'FOREX'), ['EUR', 'USD']);
  assert.deepEqual(marketAssets('usdjpy', 'FOREX'), ['USD', 'JPY']);
  assert.deepEqual(marketAssets('BTCUSDT', 'BINANCE'), ['BTC', 'USDT']);
  assert.deepEqual(marketAssets('DOGEUSDT'), ['DOGE', 'USDT']);
  assert.equal(marketAssets('USDT', 'BINANCE'), null);
  assert.equal(marketAssets('UNKNOWN'), null);
});
