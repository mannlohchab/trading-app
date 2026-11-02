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
  expect(findMentionedInstruments('BTC/USD and BTC / USD')).toEqual([]);
  expect(findMentionedInstruments('EUR / USD and BTC / USDT').map(i => i.symbol)).toEqual(['EUR/USD', 'BTCUSDT']);
});

test('a comparison follow-up refreshes both the earlier asset and the newly named asset', async () => {
  const p = provider();
  await buildMarketContext({ message: 'Compare it with Ethereum', history: ['Bitcoin price?'] }, p.value);
  expect(p.calls).toEqual(['BTCUSDT', 'ETHUSDT']);
  p.calls.length = 0;
  await buildMarketContext({ message: 'Compare them again', history: ['Bitcoin price?', 'Compare it with Ethereum'] }, p.value);
  expect(p.calls).toEqual(['BTCUSDT', 'ETHUSDT']);
});

test('unsupported or unrelated newer topics cannot resurrect an older instrument', async () => {
  for (const request of [
    { message: 'Tell me about LTC/USDT. What is its price?', history: ['Bitcoin price'] },
    { message: 'What is its price?', history: ['Bitcoin price', 'What about LTC/USDT?'] },
    { message: 'What is its price?', history: ['Bitcoin price', 'What about Litecoin?'] },
    { message: 'Explain it further', history: ['Bitcoin price', 'What is position sizing?'] },
  ]) {
    const p = provider();
    const { context } = await buildMarketContext(request, p.value);
    expect(p.calls).toEqual([]);
    expect(context).not.toContain('70000');
  }
});

test('normal chat receives sourced timestamped prices with actual quote currency', async () => {
  const p = provider();
  const { context } = await buildMarketContext({ message: 'What is Bitcoin trading at?' }, p.value);
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

test('current-price follow-ups resolve the last instruments without an explicit ticker', async () => {
  for (const message of ["What's the price now?", 'current price', 'What are their prices now?']) {
    const p = provider();
    await buildMarketContext({ message, history: ['Bitcoin price?'] }, p.value);
    expect(p.calls).toEqual(['BTCUSDT']);
  }
});

test('price summaries preserve forex precision and clearly label stale quotes', async () => {
  const p = provider({ quote: async () => ({ ...quote, symbol: 'EUR/USD', exchange: 'FOREX', currency: 'USD',
    source: 'twelvedata', ltp: 1.08456, pricePrecision: 5, stale: true }) });
  const result = await buildMarketContext({ message: 'EUR/USD price' }, p.value);
  expect(result.priceSummary).toContain('1.08456 USD');
  expect(result.priceSummary).toContain('Last available price');
  expect(result.priceSummary).toContain('stale');
  expect(result.priceSummary).toContain('Twelve Data');
  expect(result.priceSummary).not.toContain('**Current price');
});

test('explicit market selection works and conflicting exchanges do not silently change the asset', async () => {
  const p = provider();
  expect((await buildMarketContext({ message: 'Analyze', symbol: 'BTCUSDT', exchange: 'BINANCE', kind: 'analysis' }, p.value)).context).toContain('70000 USDT');
  p.calls.length = 0;
  expect((await buildMarketContext({ message: 'Analyze', symbol: 'BTCUSDT', exchange: 'FOREX', kind: 'analysis' }, p.value)).context).toContain('unsupported');
  expect(p.calls).toEqual([]);
});

test('stale and missing data remain explicit; history failure does not discard a quote', async () => {
  const p = provider({ quote: async () => ({ ...quote, stale: true }) });
  const { context } = await buildMarketContext({ message: 'Analyze Bitcoin trend' }, p.value);
  expect(context).toContain('70000 USDT');
  expect(context).toContain('stale');
  expect(context).toContain('history unavailable');
  const unavailable = provider({ quote: async () => { throw new Error('secret upstream URL'); } });
  const { context: failure } = await buildMarketContext({ message: 'Bitcoin price' }, unavailable.value);
  expect(failure).toContain('quote unavailable');
  expect(failure).not.toContain('secret upstream URL');
  expect(failure).not.toContain('70000');
});

test('lookup is bounded, quote-only questions do not spend history credits, and abort stops lookup', async () => {
  let histories = 0;
  const p = provider({ candles: async () => { histories++; return []; } });
  const { context } = await buildMarketContext({ message: 'Price of BTC ETH SOL XRP DOGE' }, p.value);
  expect(p.calls).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  expect(histories).toBe(0);
  expect(context).toContain('limit');
  const controller = new AbortController(); controller.abort();
  p.calls.length = 0;
  await expect(buildMarketContext({ message: 'Bitcoin' }, p.value, controller.signal)).rejects.toThrow();
  expect(p.calls).toEqual([]);
});
