import { expect, test } from 'bun:test';
import { resolveInstrument } from '../src/providers/instruments';
import { TwelveDataProvider } from '../src/providers/twelveData';
import { BinanceMarketDataProvider } from '../src/providers/binanceMarketData';

const fx = { symbol: 'EUR/USD', currency: 'USD', timestamp: 1793350800, last_quote_at: 1793350860,
  open: '1.08', high: '1.1', low: '1.07', close: '1.09123', previous_close: '1.08', is_market_open: true };
const ticker = { symbol: 'BTCUSDT', lastPrice: '70000.12', openPrice: '69000', highPrice: '71000', lowPrice: '68000',
  volume: '1234', closeTime: 1793350860000 };
const metadata = { symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT',
  filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01000000' }] }] };

test('pair aliases resolve and never match a different exchange', () => {
  expect(resolveInstrument('eurusd')).toMatchObject({ symbol: 'EUR/USD', exchange: 'FOREX', currency: 'USD', pricePrecision: 5 });
  expect(resolveInstrument('btc/usdt', 'crypto')).toMatchObject({ symbol: 'BTCUSDT', exchange: 'BINANCE' });
  expect(resolveInstrument('USDJPY', 'FOREX')?.pricePrecision).toBe(3);
  expect(resolveInstrument('BTCUSDT', 'NSE')).toBeUndefined();
  expect(() => resolveInstrument('INVALID', 'BINANCE')).toThrow();
});

test('forex coalesces requests and uses the observation timestamp rather than bar start', async () => {
  const urls: string[] = [];
  const p = new TwelveDataProvider({ apiKey: 'test', now: () => 1793350860000,
    request: async url => { urls.push(url); return Response.json(fx); } });
  const [a,b] = await Promise.all([p.quote('EUR/USD'), p.quote('EUR/USD')]);
  expect(a).toEqual(b); expect(urls).toHaveLength(1);
  expect(a).toMatchObject({ ltp: 1.09123, asOf: 1793350860, currency: 'USD', source: 'twelvedata', stale: false });
  expect(new URL(urls[0]).searchParams.get('timezone')).toBe('UTC');
});

test('forex quota blocks uncached history while retaining a stale quote', async () => {
  let now = 1793350860000; let calls = 0;
  const p = new TwelveDataProvider({ apiKey: 'test', minuteCredits: 1, dayCredits: 1, quoteTtlMs: 1000,
    now: () => now, request: async () => { calls++; return Response.json(fx); } });
  await p.quote('EUR/USD'); now += 2000;
  await expect(p.candles('EUR/USD', '5m')).rejects.toThrow('budget');
  expect((await p.quote('EUR/USD')).stale).toBe(true); expect(calls).toBe(1);
});

test('forex history translates intervals, parses UTC and sorts unique valid candles', async () => {
  let url = '';
  const p = new TwelveDataProvider({ apiKey: 'test', request: async u => { url=u; return Response.json({
    meta: { symbol: 'EUR/USD' }, values: [
      { datetime: '2026-10-30 10:00:00', open: '1.08', high: '1.1', low: '1.07', close: '1.09' },
      { datetime: '2026-10-30 09:00:00', open: '1.07', high: '1.1', low: '1.06', close: '1.08' },
    ] }); } });
  const candles = await p.candles('EUR/USD', '1M');
  expect(new URL(url).searchParams.get('interval')).toBe('1month');
  expect(candles[0]).toMatchObject({ time: Date.parse('2026-10-30T09:00:00Z')/1000, close: 1.08, volume: 0 });
});

test('missing credentials and malformed forex payloads fail explicitly', async () => {
  await expect(new TwelveDataProvider({ apiKey: '' }).quote('EUR/USD')).rejects.toThrow('configured');
  const p = new TwelveDataProvider({ apiKey: 'test', request: async () => Response.json({ ...fx, close: 'NaN' }) });
  await expect(p.quote('EUR/USD')).rejects.toThrow();
});

test('Binance validates exchange metadata and uses quote currency and tick precision', async () => {
  const p = new BinanceMarketDataProvider({ now: () => 1793350860000, request: async url => Response.json(url.includes('exchangeInfo') ? metadata : ticker) });
  expect(await p.quote('BTCUSDT')).toMatchObject({ ltp: 70000.12, asOf: 1793350860, currency: 'USDT', pricePrecision: 2, source: 'binance' });
});

test('Binance refuses mismatched tickers and suspended markets', async () => {
  const p = new BinanceMarketDataProvider({ request: async url => Response.json(url.includes('exchangeInfo') ? metadata : {...ticker, symbol:'ETHUSDT'}) });
  await expect(p.quote('BTCUSDT')).rejects.toThrow();
  const p2 = new BinanceMarketDataProvider({ request: async () => Response.json({ symbols: [{...metadata.symbols[0], status:'BREAK'}] }) });
  await expect(p2.quote('BTCUSDT')).rejects.toThrow();
});

test('Binance live cache ignores old events and becomes stale on disconnect', async()=>{
  const p=new BinanceMarketDataProvider({now:()=>1793350860000,request:async url=>url.includes('exchangeInfo')?Response.json(metadata):new Response('',{status:503})});
  await p.instrument('BTCUSDT');
  expect(p.ingestTicker({e:'24hrTicker',s:'BTCUSDT',E:1793350860000,c:'70000',o:'69000',h:'71000',l:'68000',v:'12'})?.ltp).toBe(70000);
  expect(p.ingestTicker({e:'24hrTicker',s:'BTCUSDT',E:1793350850000,c:'69999',o:'69000',h:'71000',l:'68000',v:'12'})).toBeUndefined();
  expect((await p.quote('BTCUSDT')).stale).toBe(false);
  p.markDisconnected();expect((await p.quote('BTCUSDT')).stale).toBe(true);
});

test('recovery history bypasses cached candles while sharing simultaneous recovery requests',async()=>{
  let requests=0;
  const p=new BinanceMarketDataProvider({request:async url=>{
    if(url.includes('exchangeInfo'))return Response.json(metadata);
    requests++;return Response.json([[1793350800000,'10','14','9',String(10+requests),'1']]);
  }});
  expect((await p.candles('BTCUSDT','5m'))[0].close).toBe(11);
  const [a,b]=await Promise.all([p.candles('BTCUSDT','5m',true),p.candles('BTCUSDT','5m',true)]);
  expect(a[0].close).toBe(12);expect(b[0].close).toBe(12);expect(requests).toBe(2);
});

test('concurrent quote requests take priority over background forex history within a tight budget',async()=>{
  const p=new TwelveDataProvider({apiKey:'test',minuteCredits:1,dayCredits:10,request:async url=>Response.json(url.includes('/quote?')?fx:{meta:{symbol:'EUR/USD'},values:[{datetime:'2026-10-30 09:00:00',open:'1.08',high:'1.1',low:'1.07',close:'1.09'}]})});
  const history=p.candles('EUR/USD','5m').then(()=>null,error=>error);
  const quote=await p.quote('EUR/USD');expect(quote.ltp).toBe(1.09123);
  expect((await history)?.code).toBe('MARKET_DATA_RATE_LIMIT');
});
