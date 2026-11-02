import { AppError } from '../lib/errors';
import { requireInstrument, globalInstruments } from './instruments';
import { RequestCache, requestJson, number, validCandles, type Fetcher } from './providerCache';
import type { Candle, Instrument, Quote, Timeframe } from './types';
export type BinanceOptions = { request?: Fetcher; now?: () => number };
export class BinanceMarketDataProvider {
  readonly name = 'binance';
  private cache: RequestCache;
  private now: () => number;
  private live = new Map<string, Quote>();
  private recovery = new Map<string, Promise<any>>();
  private metadata = new Map<string, Instrument>();
  constructor(private options: BinanceOptions = {}) { this.now=options.now ?? Date.now; this.cache=new RequestCache(this.now); }
  private get(path: string, params: Record<string,string>, ttl: number) {
    return this.cache.get(`${path}:${JSON.stringify(params)}`,ttl,()=>requestJson(this.options.request ?? fetch,`https://data-api.binance.vision/api/v3/${path}?${new URLSearchParams(params)}`));
  }
  async instrument(symbol: string): Promise<Instrument> {
    const i=requireInstrument(symbol,'BINANCE');
    const data=await this.get('exchangeInfo',{symbols:JSON.stringify(globalInstruments.filter(i=>i.exchange==='BINANCE').map(i=>i.symbol))},3600_000);
    const found=data.symbols?.find((s:any)=>s.symbol===i.symbol);
    if (!found || found.status!=='TRADING' || found.baseAsset!==i.baseCurrency || found.quoteAsset!==i.currency) throw new AppError(503,'Crypto market unavailable');
    const tick=found.filters?.find((f:any)=>f.filterType==='PRICE_FILTER')?.tickSize;
    number(tick);
    const pricePrecision=(String(tick).replace(/0+$/,'').split('.')[1] ?? '').length;
    const result={...i,pricePrecision}; this.metadata.set(i.symbol,result); return result;
  }
  parseTicker(b: any, instrument: Instrument, streaming=false): Quote {
    const symbol=streaming?b.s:b.symbol;
    if(symbol!==instrument.symbol) throw new AppError(503,'Mismatched Binance quote');
    const ltp=number(streaming?b.c:b.lastPrice),close=number(streaming?b.o:b.openPrice);
    const asOf=number(streaming?b.E:b.closeTime)/1000;
    const high=number(streaming?b.h:b.highPrice),low=number(streaming?b.l:b.lowPrice),volume=number(streaming?b.v:b.volume,true);
    validCandles([{time:asOf,open:close,high,low,close:ltp,volume}]);
    return {...instrument,ltp,close,open:close,high,low,volume,change:ltp-close,changePercent:(ltp-close)/close*100,
      source:'binance',asOf,stale:this.now()/1000-asOf>30};
  }
  ingestTicker(b: any): Quote | undefined {
    const instrument=this.metadata.get(b.s);
    if(!instrument) return;
    const q=this.parseTicker(b,instrument,true),previous=this.live.get(q.symbol);
    if(previous?.asOf && q.asOf! <= previous.asOf) return;
    this.live.set(q.symbol,q); return q;
  }
  markDisconnected() { for(const [s,q] of this.live) this.live.set(s,{...q,stale:true}); }
  async quote(symbol: string): Promise<Quote> {
    const i=await this.instrument(symbol); const live=this.live.get(i.symbol);
    if(live && !live.stale && this.now()/1000-live.asOf!<15) return {...live};
    try {
      const b=await this.get('ticker/24hr',{symbol:i.symbol},10_000);
      return this.parseTicker(b,i);
    } catch(err) { if(live) return {...live,stale:true}; throw err; }
  }
  async candles(symbol:string,timeframe:Timeframe,fresh=false):Promise<Candle[]> {
    const i=await this.instrument(symbol);
    const params={symbol:i.symbol,interval:timeframe,limit:'300'};
    const key=`${i.symbol}:${timeframe}`;
    let request: Promise<any>;
    if (fresh) {
      const existing=this.recovery.get(key);
      request=existing ?? requestJson(this.options.request ?? fetch,`https://data-api.binance.vision/api/v3/klines?${new URLSearchParams(params)}`);
      if (!existing) {
        this.recovery.set(key,request);
        const clear=()=>{if(this.recovery.get(key)===request)this.recovery.delete(key);};
        void request.then(clear,clear);
      }
    } else request=this.get('klines',params,30_000);
    const b=await request;
    if(!Array.isArray(b)) throw new AppError(503,'Crypto history unavailable');
    return validCandles(b.map((r:any[])=>({time:number(r[0])/1000,open:number(r[1]),high:number(r[2]),low:number(r[3]),close:number(r[4]),volume:number(r[5],true),source:'binance'})));
  }
}
