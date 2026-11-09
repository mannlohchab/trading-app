import assert from 'node:assert/strict';
import {test} from 'node:test';
import {formatMarketPrice} from '../src/lib/format.ts';
import {groupQuotes} from '../src/lib/marketGroups.ts';
import {buildHistoryChart} from '../src/lib/marketHistory.ts';
import {QuoteSubscriptions} from '../src/lib/quoteSubscriptions.ts';
import {patchMarketData,mergeLiveCandle} from '../src/lib/liveMarket.ts';

test('prices preserve forex pip precision and explicit crypto quote currency',()=>{
  assert.equal(formatMarketPrice(1.09123,{exchange:'FOREX',symbol:'EUR/USD'}),'1.09123 USD');
  assert.equal(formatMarketPrice(153.125,{exchange:'FOREX',symbol:'USD/JPY'}),'153.125 JPY');
  assert.equal(formatMarketPrice(.00001234,{exchange:'BINANCE',currency:'USDT',pricePrecision:8}),'0.00001234 USDT');
  assert.equal(formatMarketPrice(100,{exchange:'BINANCE',symbol:'SOLUSDT'}),'100.00 USDT');
});
test('watchlist groups only crypto and forex, dropping unsupported exchanges',()=>{
  const g=groupQuotes([{symbol:'BTCUSDT',exchange:'BINANCE'},{symbol:'EUR/USD',exchange:'FOREX'},{symbol:'TCS',exchange:'NSE'}]);
  assert.deepEqual(Object.keys(g),['crypto','forex']);assert.equal(g.crypto.length,1);assert.equal(g.forex.length,1);
});
test('crypto mini-chart keeps a rolling hour crossing UTC midnight',()=>{
  const chart=buildHistoryChart({isDemo:false,source:'binance',candles:[
    {time:Date.parse('2026-10-29T23:00:00Z')/1000,close:10},
    {time:Date.parse('2026-10-30T23:40:00Z')/1000,close:12},
    {time:Date.parse('2026-10-31T00:20:00Z')/1000,close:13},
  ]});
  assert.equal(chart.points.length,2);assert.equal(chart.points[0].value,12);
});
test('shared subscribers reconnect and release upstream interest only after the last consumer',()=>{
  const emitted=[];const handlers=new Map();const socket={emit:(...args)=>emitted.push(args),on:(e,fn)=>handlers.set(e,fn),off:e=>handlers.delete(e)};
  const m=new QuoteSubscriptions(socket);const got=[];
  const a=m.subscribe(['BINANCE:BTCUSDT'],q=>got.push(q));const b=m.subscribe(['BINANCE:BTCUSDT'],()=>{});
  assert.equal(emitted.filter(e=>e[0]==='subscribe').length,1);
  handlers.get('quote')({exchange:'FOREX',symbol:'BTCUSDT'});assert.equal(got.length,0);
  handlers.get('quote')({exchange:'BINANCE',symbol:'BTCUSDT'});assert.equal(got.length,1);
  handlers.get('connect')();assert.equal(emitted.filter(e=>e[0]==='subscribe').length,2);
  a();assert.equal(emitted.filter(e=>e[0]==='unsubscribe').length,0);b();assert.equal(emitted.at(-1)[0],'unsubscribe');
});
test('quote patches preserve history, distinguish exchanges and ignore old events',()=>{
  const data={items:[{symbol:'BTCUSDT',exchange:'BINANCE',quote:{symbol:'BTCUSDT',exchange:'BINANCE',ltp:100,asOf:20,sparkline:[90,100]}},{symbol:'BTCUSDT',exchange:'FOREX',quote:null}]};
  const updated=patchMarketData(data,{symbol:'BTCUSDT',exchange:'BINANCE',ltp:110,asOf:21});
  assert.equal(updated.items[0].quote.ltp,110);assert.deepEqual(updated.items[0].quote.sparkline,[90,100]);assert.equal(updated.items[1].quote,null);
  assert.equal(patchMarketData(updated,{symbol:'BTCUSDT',exchange:'BINANCE',ltp:95,asOf:19}),updated);
});
test('live candles update last bar, append new bars, and ignore older bars',()=>{
  const a=[{time:100,close:1},{time:200,close:2}];
  assert.deepEqual(mergeLiveCandle(a,{time:200,close:3}),[{time:100,close:1},{time:200,close:3}]);
  assert.equal(mergeLiveCandle(a,{time:50,close:9}),a);assert.equal(mergeLiveCandle(a,{time:300,close:4}).length,3);
});

test('crypto detail preview retains the rolling day across midnight', async()=>{
  const {buildPreviewChart}=await import('../src/lib/stockPreview.ts');
  const history={isDemo:false,source:'binance',candles:[{time:100000,close:10},{time:180000,close:11},{time:185000,close:12}]};
  assert.equal(buildPreviewChart(history,'1D').points.length,3);
});

test('subscription union is bounded, reports excess, promotes waiting keys and survives reconnect',()=>{
  const events=[];const handlers=new Map();const limits=[];
  const m=new QuoteSubscriptions({emit:(...e)=>events.push(e),on:(e,f)=>handlers.set(e,f),off:e=>handlers.delete(e)});
  const first=m.subscribe(Array.from({length:50},(_,i)=>`BINANCE:S${i}USDT`),()=>{});
  const second=m.subscribe(['BINANCE:BTCUSDT'],()=>{},n=>limits.push(n));
  handlers.get('connect')();
  assert.ok(events.every(e=>e[1].length<=50));
  assert.equal(limits.at(-1),1);
  first();assert.equal(limits.at(-1),0);assert.deepEqual(events.at(-1),['subscribe',['BINANCE:BTCUSDT']]);
  second();
});

test('late REST history cannot overwrite live bars received while the request was in flight',async()=>{
  const {CandleBuffer}=await import('../src/lib/liveMarket.ts');
  const {QueryClient}=await import('@tanstack/react-query');
  const buffer=new CandleBuffer();const client=new QueryClient();let resolve;
  const response=new Promise(r=>resolve=r);const key=['candles','BTCUSDT','BINANCE','5m'];
  client.setQueryData(key,{candles:[{time:100,close:1,volume:1}]});
  const fetching=client.fetchQuery({queryKey:key,queryFn:async()=>{const version=buffer.version;const snapshot=await response;return {candles:buffer.reconcile(snapshot.candles,version)};}});
  buffer.observe({time:100,close:2,volume:2});buffer.observe({time:200,close:3,volume:1});
  resolve({candles:[{time:100,close:1,volume:1}]});await fetching;
  assert.deepEqual(client.getQueryData(key).candles,[{time:100,close:2,volume:2},{time:200,close:3,volume:1}]);
  // A later authoritative snapshot can supersede an older streamed observation.
  assert.equal(buffer.reconcile([{time:200,close:4,volume:2}],buffer.version).at(-1).close,4);client.clear();
});
