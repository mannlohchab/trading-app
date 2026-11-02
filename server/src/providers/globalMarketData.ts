import { globalInstruments, requireInstrument } from './instruments';
import { availableQuotes } from './marketSummary';
import type { BinanceMarketDataProvider } from './binanceMarketData';
import type { TwelveDataProvider } from './twelveData';
import type { MarketDataProvider, MarketOverview, Quote, Timeframe } from './types';

export function forexSessionLabel(now = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',weekday:'short',hour:'numeric',hourCycle:'h23'}).formatToParts(new Date(now));
  const day = parts.find(p => p.type === 'weekday')?.value;
  const hour = Number(parts.find(p => p.type === 'hour')?.value);
  const closed = day === 'Sat' || (day === 'Fri' && hour >= 17) || (day === 'Sun' && hour < 17);
  return `Forex · indicative session ${closed ? 'closed' : 'open'} (holidays may vary)`;
}

export class GlobalMarketDataProvider implements MarketDataProvider {
  readonly name='twelvedata+binance'; readonly isDemo=false;
  constructor(public crypto: BinanceMarketDataProvider, public forex: TwelveDataProvider) {}
  async search(query:string) {
    const q=query.toUpperCase().replace(/[\s/_-]/g,'');
    return globalInstruments.filter(i=>`${i.symbol}${i.name}`.toUpperCase().replace(/[\s/_-]/g,'').includes(q));
  }
  async quote(symbol:string,exchange?:string):Promise<Quote> {
    const i=requireInstrument(symbol,exchange);
    return i.exchange==='BINANCE' ? this.crypto.quote(i.symbol) : this.forex.quote(i.symbol);
  }
  quotes(symbols:{symbol:string;exchange?:string}[]) { return availableQuotes(this,symbols); }
  candles(symbol:string,timeframe:Timeframe,exchange?:string,fresh=false) {
    const i=requireInstrument(symbol,exchange);
    return i.exchange==='BINANCE' ? this.crypto.candles(i.symbol,timeframe,fresh) : this.forex.candles(i.symbol,timeframe);
  }
  async explore() {
    const results=await Promise.allSettled(globalInstruments.map(i=>this.quote(i.symbol,i.exchange)));
    const quotes=results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
    const crypto=quotes.filter(q=>q.exchange==='BINANCE'),forex=quotes.filter(q=>q.exchange==='FOREX');
    const availability={crypto:crypto.length ? crypto.some(q=>q.stale)?'Last observation · update delayed':'Available' : 'Binance data unavailable',
      forex:!this.forex.configured ? 'Twelve Data key not configured' : forex.length ? forex.some(q=>q.stale)?'Last observation · update delayed':'Available' : 'Forex data unavailable or request budget exhausted'};
    const sorted=[...quotes].sort((a,b)=>b.changePercent-a.changePercent);
    return {crypto,forex,availability,marketSessions:{crypto:'Crypto · 24/7 trading hours',forex:forexSessionLabel()},constituents:quotes,
      gainers:sorted.filter(q=>q.changePercent>0).slice(0,5),losers:sorted.filter(q=>q.changePercent<0).reverse().slice(0,5),
      active:[...crypto].sort((a,b)=>b.volume-a.volume).slice(0,5),isDemo:false,status:'OPEN' as const,statusLabel:'Crypto · 24/7 trading hours'};
  }
  async overview():Promise<MarketOverview> {
    const data=await this.explore();
    const changes=[...data.crypto,...data.forex].map(q=>q.changePercent);
    const mean=changes.reduce((a,b)=>a+b,0)/(changes.length||1);
    return {...data,sentiment:mean>0.3?'Bullish':mean<-.3?'Bearish':'Neutral',volatilityLabel:'Across available pairs',news:[],events:[]};
  }
  async topMovers() { const {gainers,losers,active}=await this.explore(); return {gainers,losers,active}; }
}
