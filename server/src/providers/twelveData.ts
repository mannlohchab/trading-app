import { AppError } from '../lib/errors';
import { requireInstrument } from './instruments';
import { RequestCache, requestJson, number, validCandles, type Fetcher } from './providerCache';
import type { Candle, Quote, Timeframe } from './types';
const intervals: Record<Timeframe,string> = { '1m':'1min','5m':'5min','15m':'15min','30m':'30min','1h':'1h','4h':'4h','1d':'1day','1w':'1week','1M':'1month' };
type Options = { apiKey: string; request?: Fetcher; now?: () => number; minuteCredits?: number; dayCredits?: number; quoteTtlMs?: number; historyTtlMs?: number };
export class TwelveDataProvider {
  readonly name = 'twelvedata';
  private cache: RequestCache;
  private last = new Map<string, Quote>();
  private credits: number[] = [];
  private pending: { priority: number; run: () => void }[] = [];
  private now: () => number;
  readonly quoteTtlMs: number;
  constructor(private options: Options) {
    this.now = options.now ?? Date.now; this.cache = new RequestCache(this.now);
    this.quoteTtlMs = options.quoteTtlMs ?? 60_000;
  }
  get configured() { return Boolean(this.options.apiKey); }
  private consumeCredit() {
    const now = this.now();
    this.credits = this.credits.filter(t => t > now - 86_400_000);
    if (this.credits.length >= (this.options.dayCredits ?? 800) || this.credits.filter(t => t > now-60_000).length >= (this.options.minuteCredits ?? 8)) {
      throw new AppError(503, 'Twelve Data request budget exhausted; showing last observation where available', 'MARKET_DATA_RATE_LIMIT');
    }
    this.credits.push(now);
  }
  private load(endpoint: string, symbol: string, params: Record<string,string>, ttl: number): Promise<any> {
    if (!this.configured) return Promise.reject(new AppError(503, 'Twelve Data API key is not configured', 'MARKET_DATA_NOT_CONFIGURED'));
    return this.cache.get(`${endpoint}:${symbol}:${JSON.stringify(params)}`, ttl, () => new Promise((resolve,reject) => {
      const first = this.pending.length === 0;
      this.pending.push({ priority: endpoint === 'quote' ? 0 : 1, run: () => {
        try {
          this.consumeCredit();
          const query = new URLSearchParams({ ...params, symbol, timezone:'UTC', apikey:this.options.apiKey });
          requestJson(this.options.request ?? fetch, `https://api.twelvedata.com/${endpoint}?${query}`).then(resolve,reject);
        } catch (error) { reject(error); }
      }});
      // Coalesced requests arriving together spend credits on quotes before background charts.
      if (first) queueMicrotask(() => {
        const jobs = this.pending.splice(0).sort((a,b) => a.priority-b.priority);
        for (const job of jobs) job.run();
      });
    }));
  }
  async quote(symbol: string): Promise<Quote> {
    const instrument = requireInstrument(symbol, 'FOREX'); symbol = instrument.symbol;
    try {
      const b = await this.load('quote',symbol,{},this.quoteTtlMs);
      if (b.symbol !== symbol || (b.currency && b.currency !== instrument.currency)) throw new AppError(503,'Mismatched forex quote');
      const ltp=number(b.close), close=number(b.previous_close), asOf=number(b.last_quote_at ?? b.timestamp);
      const open=number(b.open), high=number(b.high), low=number(b.low);
      validCandles([{time:asOf,open,high,low,close:ltp,volume:0}]);
      const q: Quote = { ...instrument, ltp, close, open, high, low, asOf, volume:0, source:'twelvedata',
        change: ltp-close, changePercent:(ltp-close)/close*100, stale:this.now()/1000-asOf > this.quoteTtlMs/1000+120,
        marketOpen: typeof b.is_market_open === 'boolean' ? b.is_market_open : undefined };
      this.last.set(symbol,q); return q;
    } catch (err) { const last=this.last.get(symbol); if (last) return {...last,stale:true}; throw err; }
  }
  async candles(symbol: string, timeframe: Timeframe): Promise<Candle[]> {
    symbol = requireInstrument(symbol,'FOREX').symbol;
    const b = await this.load('time_series',symbol,{interval:intervals[timeframe],outputsize:'300',order:'asc'},this.options.historyTtlMs ?? 300_000);
    if (b.meta?.symbol !== symbol || !Array.isArray(b.values)) throw new AppError(503,'Forex history unavailable');
    return validCandles(b.values.map((v:any) => ({time:Date.parse(String(v.datetime).replace(' ','T')+(String(v.datetime).length===10?'T00:00:00Z':'Z'))/1000,
      open:number(v.open),high:number(v.high),low:number(v.low),close:number(v.close),volume:0,source:'twelvedata'})));
  }
}
