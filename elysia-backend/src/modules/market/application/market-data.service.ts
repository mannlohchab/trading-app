import type { Timeframe } from '../domain/market-options';
import { clampCandleLimit, isValidCandle, LIMITS, normalizeExchange, normalizeSymbol } from '../domain/rules';
import type { Candle, Ticker } from '../domain/types';
import { MarketError, ProviderUnavailableError } from './errors';
import type { Cache, CandleRepository, Clock, InstrumentRepository, MarketDataProvider, StoredInstrument } from './ports';

export type TickerSort = 'volume' | 'gainers' | 'losers';

export class MarketDataService {
  private readonly providers: Map<string, MarketDataProvider>;

  constructor(private readonly deps: {
    providers: MarketDataProvider[];
    instruments: InstrumentRepository;
    candles: CandleRepository;
    cache: Cache;
    clock: Clock;
    log?: (message: string, error?: unknown) => void;
  }) {
    this.providers = new Map(deps.providers.map(p => [p.exchange, p]));
  }

  async isActiveInstrument(exchange: string, symbol: string) {
    const code = normalizeExchange(exchange), sym = normalizeSymbol(symbol);
    if (!code || !sym || !this.providers.has(code)) return false;
    return (await this.deps.instruments.findActive(code, [sym])).has(sym);
  }

  async listExchanges() {
    return (await this.deps.instruments.listExchanges()).filter(e => this.providers.has(e.code));
  }

  async searchSymbols(input: { exchange: string; quoteAsset?: string; query?: string; limit?: number; offset?: number }) {
    const exchange = this.provider(input.exchange).exchange;
    return this.deps.instruments.search({
      exchange,
      quoteAsset: input.quoteAsset?.trim().toUpperCase() || undefined,
      query: input.query?.trim().toUpperCase().slice(0, 30) || undefined,
      limit: Math.min(LIMITS.symbolsPageMax, Math.max(1, input.limit ?? 100)),
      offset: Math.max(0, input.offset ?? 0),
    });
  }

  /** 24h tickers for specific symbols. Unknown or inactive symbols are rejected. */
  async tickersFor(exchangeCode: string, rawSymbols: string[]): Promise<Ticker[]> {
    const provider = this.provider(exchangeCode);
    const symbols = [...new Set(rawSymbols.map(s => normalizeSymbol(s)))];
    if (!symbols.length || symbols.length > LIMITS.tickersPerRequest || symbols.includes(null)) {
      throw new MarketError('INVALID_REQUEST', `Provide 1 to ${LIMITS.tickersPerRequest} valid symbols.`);
    }
    const known = await this.deps.instruments.findActive(provider.exchange, symbols as string[]);
    const unknown = (symbols as string[]).filter(s => !known.has(s));
    if (unknown.length) throw new MarketError('UNKNOWN_SYMBOL', `Unknown or inactive symbols: ${unknown.join(', ')}`, { symbols: unknown });

    const all = await this.allTickers(provider);
    const bySymbol = new Map(all.map(t => [t.symbol, t]));
    return (symbols as string[]).flatMap(s => bySymbol.get(s) ?? []);
  }

  /** Market overview: tickers for active symbols (optionally one quote asset), sorted. */
  async tickerList(input: { exchange: string; quoteAsset?: string; sort?: TickerSort; limit?: number }): Promise<Ticker[]> {
    const provider = this.provider(input.exchange);
    const [tickers, active] = await Promise.all([
      this.allTickers(provider),
      this.deps.instruments.activeSymbols(provider.exchange, input.quoteAsset?.trim().toUpperCase() || undefined),
    ]);
    const key: Record<TickerSort, (t: Ticker) => number> = {
      volume: t => -Number(t.quoteVolume),
      gainers: t => -Number(t.priceChangePercent),
      losers: t => Number(t.priceChangePercent),
    };
    const by = key[input.sort ?? 'volume'];
    return tickers
      .filter(t => active.has(t.symbol))
      .sort((a, b) => by(a) - by(b)) // ordering only; values themselves stay exact strings
      .slice(0, Math.min(LIMITS.tickerListMax, Math.max(1, input.limit ?? 100)));
  }

  /**
   * Candles from the exchange. Closed candles are saved to Postgres; if the exchange is unavailable
   * the stored history is served instead (`source: "store"`).
   */
  async candles(input: { exchange: string; symbol: string; timeframe: Timeframe; limit?: number; endTime?: number }): Promise<{
    exchange: string; symbol: string; timeframe: Timeframe; source: 'exchange' | 'store'; candles: Candle[];
  }> {
    const provider = this.provider(input.exchange);
    const instrument = await this.instrument(provider.exchange, input.symbol);
    const limit = clampCandleLimit(input.limit);
    const now = this.deps.clock.now().getTime();
    if (input.endTime !== undefined && (!Number.isSafeInteger(input.endTime) || input.endTime < 0)) {
      throw new MarketError('INVALID_REQUEST', 'endTime must be Unix milliseconds.');
    }
    const result = { exchange: provider.exchange, symbol: instrument.symbol, timeframe: input.timeframe };

    try {
      const key = `candles:${provider.exchange}:${instrument.symbol}:${input.timeframe}:${limit}:${input.endTime ?? 'latest'}`;
      const candles = await this.deps.cache.getOrLoad(key, input.endTime === undefined ? 3_000 : 60_000, async () =>
        (await provider.fetchCandles(instrument.symbol, input.timeframe, { limit, endTime: input.endTime }))
          .filter(isValidCandle)
          .map(c => ({ ...c, isClosed: c.closeTime < now })),
      );
      const closed = candles.filter(c => c.isClosed);
      if (closed.length) {
        await this.deps.candles.saveClosed(instrument.id, input.timeframe, closed).catch(error => this.deps.log?.('Saving candles failed', error));
      }
      return { ...result, source: 'exchange', candles };
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      const stored = await this.deps.candles.latest(instrument.id, input.timeframe, { limit, endTime: input.endTime });
      if (!stored.length) throw new MarketError('PROVIDER_UNAVAILABLE', `${provider.exchange} market data is temporarily unavailable.`);
      return { ...result, source: 'store', candles: stored };
    }
  }

  private allTickers(provider: MarketDataProvider) {
    return this.deps.cache.getOrLoad(`tickers:${provider.exchange}:all`, 5_000, () => provider.fetchTickers()).catch(error => {
      if (error instanceof ProviderUnavailableError) {
        throw new MarketError('PROVIDER_UNAVAILABLE', `${provider.exchange} market data is temporarily unavailable.`);
      }
      throw error;
    });
  }

  private provider(rawExchange: string): MarketDataProvider {
    const code = normalizeExchange(rawExchange);
    const provider = code && this.providers.get(code);
    if (!provider) throw new MarketError('UNKNOWN_EXCHANGE', `Unsupported exchange "${rawExchange}".`);
    return provider;
  }

  private async instrument(exchange: string, rawSymbol: string): Promise<StoredInstrument> {
    const symbol = normalizeSymbol(rawSymbol);
    const found = symbol && (await this.deps.instruments.findActive(exchange, [symbol])).get(symbol);
    if (!found) throw new MarketError('UNKNOWN_SYMBOL', `Unknown or inactive symbol "${rawSymbol}" on ${exchange}.`);
    return found;
  }
}
