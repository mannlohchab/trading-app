import { ProviderUnavailableError } from '../../application/errors';
import type { MarketDataProvider } from '../../application/ports';
import type { Timeframe } from '../../domain/market-options';
import {
  BINANCE, candleFromRest, tickerFromRest, toInstrument,
  type BinanceKlineRow, type BinanceRestTicker, type BinanceSymbol,
} from './binance-mappers';

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Binance public market data over REST. Uses the market-data-only host, which needs no API key.
 * On 429/418 (rate limited/banned) it stops calling Binance until the advised retry time.
 */
export class BinanceRestProvider implements MarketDataProvider {
  readonly exchange = BINANCE;
  private blockedUntil = 0;

  constructor(private readonly options: {
    baseUrl?: string;
    fetch?: Fetcher;
    timeoutMs?: number;
    now?: () => number;
  } = {}) {}

  async fetchInstruments() {
    const body = await this.get<{ symbols: BinanceSymbol[] }>('exchangeInfo', { permissions: 'SPOT', symbolStatus: 'TRADING' });
    if (!Array.isArray(body?.symbols)) throw new ProviderUnavailableError('Unexpected exchangeInfo response');
    return body.symbols.flatMap(s => toInstrument(s) ?? []);
  }

  async fetchTickers(symbols?: string[]) {
    const body = await this.get<BinanceRestTicker[]>('ticker/24hr', symbols ? { symbols: JSON.stringify(symbols) } : {});
    if (!Array.isArray(body)) throw new ProviderUnavailableError('Unexpected ticker response');
    return body.flatMap(t => {
      try { return [tickerFromRest(t)]; } catch { return []; }
    });
  }

  async fetchCandles(symbol: string, timeframe: Timeframe, { limit, endTime }: { limit: number; endTime?: number }) {
    const rows = await this.get<BinanceKlineRow[]>('klines', {
      symbol, interval: timeframe, limit: String(limit), ...(endTime !== undefined && { endTime: String(endTime) }),
    });
    if (!Array.isArray(rows)) throw new ProviderUnavailableError('Unexpected klines response');
    const now = this.now();
    return rows.flatMap(r => {
      try { return [candleFromRest(r, now)]; } catch { return []; }
    });
  }

  private now() {
    return (this.options.now ?? Date.now)();
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const now = this.now();
    if (now < this.blockedUntil) {
      throw new ProviderUnavailableError('Binance rate limit cooldown', this.blockedUntil - now);
    }
    const url = `${this.options.baseUrl ?? 'https://data-api.binance.vision'}/api/v3/${path}?${new URLSearchParams(params)}`;
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(url, { signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000) });
    } catch (error) {
      throw new ProviderUnavailableError(`Binance request failed: ${error instanceof Error ? error.message : error}`);
    }
    if (response.status === 429 || response.status === 418) {
      const retryAfter = Number(response.headers.get('retry-after')) || 60;
      this.blockedUntil = this.now() + retryAfter * 1000;
      throw new ProviderUnavailableError(`Binance rate limited (${response.status})`, retryAfter * 1000);
    }
    if (response.status >= 500) throw new ProviderUnavailableError(`Binance error ${response.status}`);
    if (!response.ok) {
      // 4xx other than rate limits means our request was wrong, e.g. a symbol Binance no longer knows.
      const detail = await response.text().catch(() => '');
      throw new ProviderUnavailableError(`Binance rejected the request (${response.status}): ${detail.slice(0, 200)}`);
    }
    // The timeout also covers reading the body; a stalled or cut-off body is an upstream failure too.
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new ProviderUnavailableError(`Binance response could not be read: ${error instanceof Error ? error.message : error}`);
    }
  }
}
