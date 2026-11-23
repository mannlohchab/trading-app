// Latest prices for the execution engine: live stream quotes when fresh, else the market module's
// REST tickers (shared, cached). Nothing here can place an exchange order: it only reads prices.
import type { MarketDataService } from '../../market/application/market-data.service';
import type { Ticker } from '../../market/domain/types';
import { dec } from '../../backtesting';
import { EXECUTION } from '../paper-trading.constants';
import type { MarketPrices, Quote, SymbolRules } from '../paper-trading.types';

export const quoteFromTicker = (t: Ticker, source: Quote['source']): Quote => ({
  last: dec.from(t.lastPrice), bid: t.bidPrice ? dec.from(t.bidPrice) : null, ask: t.askPrice ? dec.from(t.askPrice) : null, time: t.time, source,
});

export class QuoteBook implements MarketPrices {
  private readonly live = new Map<string, Quote>();
  constructor(private readonly market: MarketDataService, private readonly now: () => number) {}

  /** Records a streamed ticker. Out-of-order (older) events are ignored. Returns whether it was newer. */
  observe(exchange: string, ticker: Ticker): boolean {
    const key = `${exchange}:${ticker.symbol}`;
    const current = this.live.get(key);
    if (current && current.time >= ticker.time) return false;
    this.live.set(key, quoteFromTicker(ticker, 'stream'));
    return true;
  }

  latest(exchange: string, symbol: string) {
    return this.live.get(`${exchange}:${symbol}`) ?? null;
  }

  /** Marks streamed quotes unusable (e.g. the feed is reconnecting) until fresh events arrive. */
  invalidate(exchange: string) {
    for (const key of this.live.keys()) if (key.startsWith(`${exchange}:`)) this.live.delete(key);
  }

  async quote(s: SymbolRules): Promise<Quote | null> {
    const streamed = this.latest(s.exchange, s.symbol);
    if (streamed && this.now() - streamed.time <= EXECUTION.maxQuoteAgeMs) return streamed;
    try {
      const [ticker] = await this.market.tickersFor(s.exchange, [s.symbol]);
      return ticker ? quoteFromTicker(ticker, 'rest') : streamed;
    } catch {
      return streamed;
    }
  }
}
