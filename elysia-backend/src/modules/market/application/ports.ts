// Ports for the market module. One provider (and optionally one live feed) per exchange.
// Crypto exchanges, and later forex sources, are adapters behind these interfaces.
import type { Timeframe } from '../domain/market-options';
import type { Candle, Instrument, Ticker, Topic } from '../domain/types';

export interface MarketDataProvider {
  /** Exchange code this provider serves, e.g. "BINANCE". */
  readonly exchange: string;
  fetchInstruments(): Promise<Instrument[]>;
  /** 24h tickers for `symbols`, or for every listed symbol when omitted. */
  fetchTickers(symbols?: string[]): Promise<Ticker[]>;
  /** Newest `limit` candles ending at `endTime` (or now), oldest first. */
  fetchCandles(symbol: string, timeframe: Timeframe, options: { limit: number; endTime?: number }): Promise<Candle[]>;
}

export type FeedStatus = 'idle' | 'connecting' | 'live' | 'reconnecting';
export type FeedEvent =
  | { type: 'ticker'; topic: Topic & { kind: 'ticker' }; ticker: Ticker }
  | { type: 'candle'; topic: Topic & { kind: 'candles' }; candle: Candle };

/** Streams live data for a set of topics on one exchange. */
export interface LiveFeed {
  readonly exchange: string;
  /** Replaces the full set of wanted topics. The feed connects, subscribes and disconnects as needed. */
  setTopics(topics: Topic[]): void;
  onEvent(listener: (event: FeedEvent) => void): void;
  onStatus(listener: (status: FeedStatus) => void): void;
  readonly status: FeedStatus;
  stop(): void;
}

/** An active instrument plus its database id. */
export type StoredInstrument = Instrument & { id: string };

export interface InstrumentRepository {
  /** Upserts the exchange's instruments and deactivates ones it no longer lists. */
  sync(exchange: string, instruments: Instrument[]): Promise<{ upserted: number; deactivated: number }>;
  lastSyncedAt(exchange: string): Promise<Date | null>;
  listExchanges(): Promise<{ code: string; name: string; type: string }[]>;
  search(filter: { exchange: string; quoteAsset?: string; query?: string; limit: number; offset: number }): Promise<{ items: StoredInstrument[]; total: number }>;
  /** Active instruments among `symbols`, keyed by symbol. */
  findActive(exchange: string, symbols: string[]): Promise<Map<string, StoredInstrument>>;
  /** Symbols of all active instruments, optionally for one quote asset. */
  activeSymbols(exchange: string, quoteAsset?: string): Promise<Set<string>>;
}

export interface CandleRepository {
  /** Stores closed candles; already-stored ones are left unchanged (closed candles are final). */
  saveClosed(symbolId: string, timeframe: Timeframe, candles: Candle[]): Promise<void>;
  /** Newest `limit` stored candles ending at `endTime` (or the latest), oldest first. */
  latest(symbolId: string, timeframe: Timeframe, options: { limit: number; endTime?: number }): Promise<Candle[]>;
}

/** Short-lived cache with request coalescing (concurrent callers share one load). */
export interface Cache {
  getOrLoad<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}
