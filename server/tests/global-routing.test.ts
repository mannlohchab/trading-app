import { expect, test } from 'bun:test';
import { GlobalMarketDataProvider } from '../src/providers/globalMarketData';
import { requireTradableInstrument } from '../src/providers/instruments';
import { placeOrder } from '../src/modules/trading/engine';
const cryptoQuote = {symbol:'BTCUSDT',exchange:'BINANCE',name:'Bitcoin',ltp:70000,open:69000,close:69000,high:71000,low:68000,change:1000,changePercent:1.45,volume:500,currency:'USDT',source:'binance'};
test('discovery keeps crypto when forex is unconfigured, and exposes separate availability',async()=>{
  const p=new GlobalMarketDataProvider({quote:async()=>cryptoQuote} as any,
    {configured:false,quote:async()=>{throw new Error('missing key');}} as any);
  const result=await p.explore();
  expect(result.crypto.length).toBeGreaterThan(0);expect(result.forex).toEqual([]);
  expect(result.availability.forex).toContain('configured');
});
test('router honors aliases and rejects instruments outside forex and crypto',async()=>{
  const p=new GlobalMarketDataProvider({quote:async()=>cryptoQuote} as any,{quote:async()=>({symbol:'EUR/USD',exchange:'FOREX'})} as any);
  expect((await p.quote('btc/usdt')).symbol).toBe('BTCUSDT');
  expect((await p.quote('eurusd')).exchange).toBe('FOREX');
  await expect(p.quote('TCS','BSE')).rejects.toMatchObject({code:'INVALID_INSTRUMENT'});
  await expect(p.quote('RELIANCE')).rejects.toMatchObject({code:'INVALID_INSTRUMENT'});
  expect(()=>p.candles('NIFTY','1d','NSE')).toThrow('Unsupported');
  expect(await p.search('TCS')).toEqual([]);
});
test('USD paper accounts accept USD/USDT-quoted pairs and reject other quote currencies before market data',async()=>{
  expect(requireTradableInstrument('btc/usdt')).toMatchObject({symbol:'BTCUSDT',exchange:'BINANCE'});
  expect(requireTradableInstrument('EUR/USD','FOREX').currency).toBe('USD');
  expect(()=>requireTradableInstrument('USD/JPY','FOREX')).toThrow('USD');
  expect(()=>requireTradableInstrument('RELIANCE','NSE')).toThrow('Unsupported');
  await expect(placeOrder({userId:'not-a-real-account',symbol:'USD/JPY',exchange:'FOREX',side:'BUY',orderType:'MARKET',quantity:1}))
    .rejects.toMatchObject({code:'UNSUPPORTED_ACCOUNT_CURRENCY'});
  await expect(placeOrder({userId:'x',symbol:'BTCUSDT',exchange:'BINANCE',side:'BUY',orderType:'MARKET',quantity:0.000000001}))
    .rejects.toThrow('positive number');
});

test('pending orders in unsupported quote currencies cannot reach quote retrieval or account mutation', async()=>{
  const {spyOn}=await import('bun:test');
  const {db}=await import('../src/db');
  const {processPendingOrders}=await import('../src/modules/trading/engine');
  const {getMarketDataProvider}=await import('../src/providers/marketData');
  const rows=spyOn(db.query.orders,'findMany').mockResolvedValue([{id:'pending',symbol:'USD/JPY',exchange:'FOREX',side:'BUY',limitPrice:2}] as any);
  let quoteCalls=0;const quotes=spyOn(getMarketDataProvider(),'quote').mockImplementation(async()=>{quoteCalls++;throw Error('must not reach provider');});
  const warnings=spyOn(console,'warn').mockImplementation(()=>{});
  try {await processPendingOrders();expect(quoteCalls).toBe(0);expect(warnings.mock.calls[0][2].code).toBe('UNSUPPORTED_ACCOUNT_CURRENCY');}
  finally{rows.mockRestore();quotes.mockRestore();warnings.mockRestore();}
});

test('indicative forex session follows New York weekend hours across daylight saving', async()=>{
  const {forexSessionLabel}=await import('../src/providers/globalMarketData');
  expect(forexSessionLabel(Date.parse('2026-10-30T22:00:00Z'))).toContain('closed');
  expect(forexSessionLabel(Date.parse('2026-11-01T21:30:00Z'))).toContain('closed');
  expect(forexSessionLabel(Date.parse('2026-11-01T22:30:00Z'))).toContain('open');
});
