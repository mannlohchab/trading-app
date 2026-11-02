import { expect, test } from 'bun:test';
import { BinanceStream } from '../src/providers/binanceStream';
import { normalizeSubscription } from '../src/marketSocket';
class FakeSocket {
  onopen:any; onmessage:any; onclose:any; onerror:any; closed=false;
  close(){this.closed=true;this.onclose?.();}
  message(data:any){this.onmessage?.({data:JSON.stringify(data)});}
}
function setup(){
  let now=1000; const jobs=new Map<number,()=>void>();let id=0;
  const sockets:FakeSocket[]=[];const urls:string[]=[];const messages:any[]=[];const states:string[]=[];
  const stream=new BinanceStream({createSocket:url=>{urls.push(url);const s=new FakeSocket();sockets.push(s);return s;},now:()=>now,
    schedule:fn=>{jobs.set(++id,fn);return id;},cancel:n=>{jobs.delete(n as number);},onMessage:b=>{messages.push(b);return true;},onStatus:s=>states.push(s)});
  const tick=()=>{const entries=[...jobs];jobs.clear();for(const [,fn] of entries)fn();};
  return {stream,sockets,urls,messages,states,tick,setNow:(n:number)=>now=n};
}
test('stream connects once for deduplicated symbols and closes when unused',()=>{
  const x=setup();x.stream.setStreams(['btcusdt@ticker','btcusdt@ticker']);x.tick();
  expect(x.urls).toEqual(['wss://stream.binance.com:443/stream?streams=btcusdt@ticker']);
  x.stream.setStreams(['btcusdt@ticker']);expect(x.sockets).toHaveLength(1);
  x.stream.stop();expect(x.sockets[0].closed).toBe(true);
});
test('stream reconnects subscriptions and ignores events from superseded sockets',()=>{
  const x=setup();x.stream.setStreams(['ethusdt@ticker']);x.tick();const first=x.sockets[0];first.onopen();first.close();x.tick();
  expect(x.sockets).toHaveLength(2);expect(x.urls[1]).toContain('ethusdt@ticker');
  first.message({data:{e:'24hrTicker'}});expect(x.messages).toEqual([]);
  x.sockets[1].message({data:{e:'24hrTicker',s:'ETHUSDT',E:1000}});expect(x.messages).toHaveLength(1);x.stream.stop();
});
test('silent stream transitions to reconnecting and invalid input never connects',()=>{
  const x=setup();x.stream.setStreams(['bad@whatever']);x.tick();expect(x.sockets).toHaveLength(0);
  x.stream.setStreams(['btcusdt@ticker']);x.tick();x.sockets[0].onopen();x.setNow(50000);x.tick();
  expect(x.states).toContain('reconnecting');expect(x.sockets[0].closed).toBe(true);x.stream.stop();
});
test('subscriptions validate keys and preserve exchange identity',()=>{
  expect(normalizeSubscription('FOREX:eurusd')).toBe('FOREX:EUR/USD');
  expect(normalizeSubscription('BINANCE:BTCUSDT:5m',true)).toBe('BINANCE:BTCUSDT:5m');
  expect(normalizeSubscription('BINANCE:BTCUSDT:bad',true)).toBeNull();
  expect(normalizeSubscription('btcusdt')).toBe('BINANCE:BTCUSDT');
  expect(normalizeSubscription('TCS')).toBeNull();
  expect(normalizeSubscription('BSE:TCS')).toBeNull();
  expect(normalizeSubscription('NSE:NIFTY')).toBeNull();
  expect(normalizeSubscription('FOREX:unlisted')).toBeNull();
});

test('rejected replay events cannot revive an unhealthy stream',()=>{
  let now=1000;const states:string[]=[];const jobs=new Map<number,()=>void>();let id=0;const s=new FakeSocket();
  const stream=new BinanceStream({createSocket:()=>s,onMessage:()=>false,onStatus:v=>states.push(v),now:()=>now,
    schedule:fn=>{jobs.set(++id,fn);return id;},cancel:n=>jobs.delete(n as number)});
  stream.setStreams(['btcusdt@ticker']);const connect=[...jobs.values()][0];jobs.clear();connect();s.onopen();
  now=20000;s.message({data:{e:'24hrTicker',E:20000}});
  expect(states).not.toContain('live');now=40000;for(const fn of [...jobs.values()])fn();
  expect(states).toContain('reconnecting');stream.stop();
});

test('shutdown cannot reopen an upstream socket after pending metadata resolves',async()=>{
  const {attachMarketSocket}=await import('../src/marketSocket');
  let connect:any;const handlers=new Map<string,Function>();let resolve:any;let opened=0;
  const metadata=new Promise(r=>resolve=r);const original=globalThis.WebSocket;
  globalThis.WebSocket=class extends FakeSocket {constructor(){super();opened++;}} as any;
  const io={on:(_event:string,fn:any)=>{connect=fn;},emit:()=>{},to:()=>({emit:()=>{}})};
  const stop=attachMarketSocket(io as any,{crypto:{instrument:()=>metadata,markDisconnected:()=>{}},forex:{configured:false}} as any);
  try {
    connect({id:'client',on:(event:string,fn:Function)=>handlers.set(event,fn),emit:()=>{},join:()=>{},leave:()=>{}});
    handlers.get('subscribe')!(['BINANCE:BTCUSDT']);stop();resolve({symbol:'BTCUSDT'});
    await Bun.sleep(600);expect(opened).toBe(0);
  } finally {stop();globalThis.WebSocket=original;}
});
