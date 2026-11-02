import { AppError } from '../lib/errors';
import { demoMarketData } from './demoMarketData';
import { marketOverview, marketMovers, availableQuotes } from './marketSummary';
import type { Candle, MarketDataProvider, Quote, Timeframe } from './types';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type Chart = {
  meta: {
    symbol: string; currency: string; regularMarketPrice: number; regularMarketTime: number;
    previousClose?: number; chartPreviousClose?: number; longName?: string; shortName?: string;
    regularMarketDayHigh?: number; regularMarketDayLow?: number; regularMarketVolume?: number;
  };
  timestamp?: number[];
  indicators?: { quote?: { open: (number | null)[]; high: (number | null)[];
    low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[] };
};

const INDEX_SYMBOLS: Record<string, string> = {
  'NSE:NIFTY': '^NSEI', 'NSE:BANKNIFTY': '^NSEBANK', 'BSE:SENSEX': '^BSESN',
  'NSE:FINNIFTY': '^CNXFIN', 'NSE:INDIAVIX': '^INDIAVIX',
};
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

function yahooSymbol(symbol: string, exchange: string) {
  if (!['NSE', 'BSE'].includes(exchange)) {
    throw new AppError(503, `Yahoo fallback does not support ${exchange}`, 'MARKET_DATA_UNAVAILABLE');
  }
  const index = INDEX_SYMBOLS[`${exchange}:${symbol}`];
  if (index) return index;
  if (!/^[A-Z0-9&_-]+$/.test(symbol)) throw new AppError(400, 'Invalid stock symbol');
  return `${symbol}.${exchange === 'NSE' ? 'NS' : 'BO'}`;
}

function parseCandles(chart: Chart): Candle[] {
  const prices = chart.indicators?.quote?.[0];
  if (!prices || !Array.isArray(chart.timestamp)) return [];
  const candles = new Map<number, Candle>();
  chart.timestamp.forEach((time, i) => {
    const open = prices.open?.[i], high = prices.high?.[i], low = prices.low?.[i], close = prices.close?.[i];
    if (![time, open, high, low, close].every(positive)) return;
    if (high! < Math.max(open!, close!) || low! > Math.min(open!, close!)) return;
    const volume = prices.volume?.[i];
    candles.set(time, { time, open: open!, high: high!, low: low!, close: close!,
      volume: typeof volume === 'number' && Number.isFinite(volume) && volume >= 0 ? volume : 0, source: 'yahoo' });
  });
  return [...candles.values()].sort((a, b) => a.time - b.time);
}

function fourHourCandles(candles: Candle[]): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const candle of candles) {
    // Anchor bars at 09:15 IST and never combine candles from different sessions.
    const day = Math.floor((candle.time + 19_800) / 86_400) * 86_400 - 19_800;
    const start = day + 9 * 3600 + 15 * 60;
    const bucket = start + Math.floor((candle.time - start) / 14_400) * 14_400;
    const current = buckets.get(bucket);
    if (!current) buckets.set(bucket, { ...candle });
    else {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
      current.volume += candle.volume;
    }
  }
  return [...buckets.values()];
}

/** Yahoo's public chart endpoint supplies both quote metadata and unadjusted OHLCV. */
export class YahooMarketDataProvider implements MarketDataProvider {
  readonly name = 'yahoo';
  readonly isDemo = false;
  private cache = new Map<string, { expiresAt: number; result: Promise<Chart> }>();

  constructor(private readonly request: Fetcher = (url, init) => fetch(url, init)) {}

  private async chart(symbol: string, exchange: string, interval: string, range: string): Promise<Chart> {
    const ticker = yahooSymbol(symbol, exchange);
    const key = `${ticker}:${interval}:${range}`;
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) return cached.result;
    for (const [key, entry] of this.cache) if (entry.expiresAt <= now) this.cache.delete(key);
    if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
    const result = (async () => {
      try {
        const query = new URLSearchParams({ interval, range, includePrePost: 'false' });
        const response = await this.request(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${query}`, {
          headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json() as { chart?: { error?: unknown; result?: Chart[] } };
        const chart = body.chart?.result?.[0];
        if (body.chart?.error || !chart?.meta || chart.meta.symbol !== ticker || chart.meta.currency !== 'INR') {
          throw new Error('Missing or mismatched market data');
        }
        if (!positive(chart.meta.regularMarketPrice) || !positive(chart.meta.regularMarketTime)) {
          throw new Error('Invalid market price or observation time');
        }
        return chart;
      } catch {
        throw new AppError(503, `Yahoo market data unavailable for ${symbol} on ${exchange}`, 'MARKET_DATA_UNAVAILABLE');
      }
    })();
    this.cache.set(key, { expiresAt: now + 60_000, result });
    try { return await result; }
    catch (error) {
      if (this.cache.get(key)?.result === result) this.cache.delete(key);
      throw error;
    }
  }

  async search(query: string) {
    // Keep the existing instrument catalog; Yahoo fallback does not add brokerage tokens.
    return (await demoMarketData.search(query)).filter((i) => i.exchange === 'NSE' || i.exchange === 'BSE');
  }

  async quote(symbol: string, exchange = 'NSE'): Promise<Quote> {
    symbol = symbol.toUpperCase(); exchange = exchange.toUpperCase();
    const chart = await this.chart(symbol, exchange, '5m', '1d');
    const { meta } = chart;
    const candles = parseCandles(chart);
    const ltp = meta.regularMarketPrice;
    // chartPreviousClose is the preceding session only because this request covers one day.
    const close = meta.previousClose ?? meta.chartPreviousClose;
    if (!positive(close) || !candles.length) throw new AppError(503, `Incomplete Yahoo quote for ${symbol}`, 'MARKET_DATA_UNAVAILABLE');
    const change = Number((ltp - close).toFixed(8));
    return {
      symbol, exchange, name: meta.longName ?? meta.shortName ?? symbol,
      ltp, open: candles[0].open, close,
      high: positive(meta.regularMarketDayHigh) ? meta.regularMarketDayHigh : Math.max(...candles.map((c) => c.high)),
      low: positive(meta.regularMarketDayLow) ? meta.regularMarketDayLow : Math.min(...candles.map((c) => c.low)),
      change, changePercent: Number((change / close * 100).toFixed(8)),
      volume: meta.regularMarketVolume ?? candles.reduce((sum, c) => sum + c.volume, 0),
      sparkline: candles.map((c) => c.close), source: 'yahoo', asOf: meta.regularMarketTime,
    };
  }

  async quotes(symbols: { symbol: string; exchange?: string }[]) {
    return availableQuotes(this, symbols);
  }

  async candles(symbol: string, timeframe: Timeframe, exchange = 'NSE'): Promise<Candle[]> {
    const interval = timeframe === '4h' ? '1h' : timeframe === '1w' ? '1wk' : timeframe === '1M' ? '1mo' : timeframe;
    const range = timeframe === '1m' || timeframe === '5m' ? '5d'
      : timeframe === '1d' ? '1y' : timeframe === '1w' || timeframe === '1M' ? '5y' : '1mo';
    const chart = await this.chart(symbol.toUpperCase(), exchange.toUpperCase(), interval, range);
    const candles = parseCandles(chart);
    if (!candles.length) throw new AppError(503, `Yahoo history unavailable for ${symbol}`, 'MARKET_DATA_UNAVAILABLE');
    return timeframe === '4h' ? fourHourCandles(candles) : candles;
  }

  async overview() { return marketOverview(this); }
  async topMovers() { return marketMovers(this); }
}

export const yahooMarketData = new YahooMarketDataProvider();
