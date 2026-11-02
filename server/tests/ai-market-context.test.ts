import { expect, test } from 'bun:test';
import { buildMarketContext, findMentionedInstruments } from '../src/providers/aiMarketContext';
import type { MarketDataProvider, Quote } from '../src/providers/types';

const quote: Quote = { symbol: 'BTCUSDT', exchange: 'BINANCE', name: 'Bitcoin / Tether', ltp: 70000, open: 69000,
  high: 71000, low: 68000, close: 69000, change: 1000, changePercent: 1.45, volume: 500,
  currency: 'USDT', source: 'binance', asOf: 1793577600, stale: false };
function provider(overrides: Partial<MarketDataProvider> = {}) {
  const calls: string[] = [];
  return { calls, value: {
    quote: async (symbol: string) => { calls.push(symbol); return { ...quote, symbol }; },
    candles: async () => { throw new Error('History offline'); }, ...overrides,
  } as MarketDataProvider };
}

test('recognizes crypto names, bounded aliases and forex pair spellings', () => {
  expect(findMentionedInstruments('Compare Bitcoin, $ETH and eur/usd').map(i => i.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'EUR/USD']);
  expect(findMentionedInstruments('gbpusd versus dollar yen').map(i => i.symbol)).toEqual(['GBP/USD', 'USD/JPY']);
  expect(findMentionedInstruments('BTC, BTCUSDT, bitcoin, BTC/USDT').map(i => i.symbol)).toEqual(['BTCUSDT']);
  expect(findMentionedInstruments('absolute solutions and methodology')).toEqual([]);
  expect(findMentionedInstruments('AAPL and EUR/GBP')).toEqual([]);
});

test('normal chat receives sourced timestamped prices with actual quote currency', async () => {
  const p = provider();
  const context = await buildMarketContext({ message: 'What is Bitcoin trading at?' }, p.value);
  expect(p.calls).toEqual(['BTCUSDT']);
  expect(context).toContain('70000 USDT');
  expect(context).toContain('binance');
  expect(context).toContain('2026-11-02T00:00:00.000Z');
  expect(context).not.toContain('70000 USD,');
});

test('referential follow-ups refresh the previous pair but unrelated questions do not', async () => {
  const p = provider();
  await buildMarketContext({ message: 'What is its price now?', history: ['How is Bitcoin doing?'] }, p.value);
  expect(p.calls).toEqual(['BTCUSDT']);
  p.calls.length = 0;
  await buildMarketContext({ message: 'Explain position sizing', history: ['How is Bitcoin doing?'] }, p.value);
  expect(p.calls).toEqual([]);
  await buildMarketContext({ message: 'What about Ethereum?', history: ['How is Bitcoin doing?'] }, p.value);
  expect(p.calls).toEqual(['ETHUSDT']);
});

test('explicit market selection works and conflicting exchanges do not silently change the asset', async () => {
  const p = provider();
  expect(await buildMarketContext({ message: 'Analyze', symbol: 'BTCUSDT', exchange: 'BINANCE', kind: 'analysis' }, p.value)).toContain('70000 USDT');
  p.calls.length = 0;
  expect(await buildMarketContext({ message: 'Analyze', symbol: 'BTCUSDT', exchange: 'FOREX', kind: 'analysis' }, p.value)).toContain('unsupported');
  expect(p.calls).toEqual([]);
});

test('stale and missing data remain explicit; history failure does not discard a quote', async () => {
  const p = provider({ quote: async () => ({ ...quote, stale: true }) });
  const context = await buildMarketContext({ message: 'Analyze Bitcoin trend' }, p.value);
  expect(context).toContain('70000 USDT');
  expect(context).toContain('stale');
  expect(context).toContain('history unavailable');
  const unavailable = provider({ quote: async () => { throw new Error('secret upstream URL'); } });
  const failure = await buildMarketContext({ message: 'Bitcoin price' }, unavailable.value);
  expect(failure).toContain('quote unavailable');
  expect(failure).not.toContain('secret upstream URL');
  expect(failure).not.toContain('70000');
});

test('lookup is bounded, quote-only questions do not spend history credits, and abort stops lookup', async () => {
  let histories = 0;
  const p = provider({ candles: async () => { histories++; return []; } });
  const context = await buildMarketContext({ message: 'Price of BTC ETH SOL XRP DOGE' }, p.value);
  expect(p.calls).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  expect(histories).toBe(0);
  expect(context).toContain('limit');
  const controller = new AbortController(); controller.abort();
  p.calls.length = 0;
  await expect(buildMarketContext({ message: 'Bitcoin' }, p.value, controller.signal)).rejects.toThrow();
  expect(p.calls).toEqual([]);
});
