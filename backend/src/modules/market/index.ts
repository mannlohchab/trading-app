// Market module: instrument catalog, tickers, candles and live data. Crypto (Binance) today;
// forex or other exchanges are added by registering more adapters, nothing else changes.
import type { MiddlewareHandler } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import type { AppDatabase } from '../../db/types';
import type { AuthVariables } from '../identity';
import { InstrumentCatalogService } from './application/instrument-catalog.service';
import { LiveMarketHub } from './application/live-market.hub';
import { MarketDataService } from './application/market-data.service';
import type { Clock, LiveFeed, MarketDataProvider } from './application/ports';
import { BinanceLiveFeed } from './infrastructure/binance/binance-live-feed';
import { BinanceRestProvider } from './infrastructure/binance/binance-rest.provider';
import { DrizzleCandleRepository } from './infrastructure/drizzle-candle.repository';
import { DrizzleInstrumentRepository } from './infrastructure/drizzle-instrument.repository';
import { MemoryCache } from './infrastructure/memory-cache';
import { marketRoutes } from './http/market.routes';

export type { LiveFeed, MarketDataProvider } from './application/ports';
export type { Candle, Instrument, Ticker } from './domain/types';

/** One exchange's adapters. `feed` is optional for sources without live streaming. */
export type ExchangeAdapters = { provider: MarketDataProvider; feed?: LiveFeed };

export const binanceAdapters = (): ExchangeAdapters => ({ provider: new BinanceRestProvider(), feed: new BinanceLiveFeed() });

const systemClock: Clock = { now: () => new Date() };
const log = (message: string, error?: unknown) => console.warn(`[market] ${message}`, error ?? '');

export function createMarketModule(deps: {
  db: AppDatabase;
  requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }>;
  exchanges: ExchangeAdapters[];
  defaultExchange?: string;
  clock?: Clock;
}) {
  const clock = deps.clock ?? systemClock;
  const providers = deps.exchanges.map(e => e.provider);
  const instruments = new DrizzleInstrumentRepository(deps.db);
  const candles = new DrizzleCandleRepository(deps.db);
  const catalog = new InstrumentCatalogService({ providers, instruments, clock });
  const service = new MarketDataService({ providers, instruments, candles, cache: new MemoryCache(() => clock.now().getTime()), clock, log });
  const hub = new LiveMarketHub({ feeds: deps.exchanges.flatMap(e => e.feed ?? []), instruments, candles, log });
  const { upgradeWebSocket, websocket } = createBunWebSocket();

  let syncTimer: ReturnType<typeof setInterval> | undefined;
  return {
    catalog,
    service,
    hub,
    routes: marketRoutes({ service, hub, requireActiveUser: deps.requireActiveUser, upgradeWebSocket, defaultExchange: deps.defaultExchange ?? providers[0]?.exchange ?? 'BINANCE' }),
    /** Bun.serve `websocket` handler; pass it alongside `fetch`. */
    websocket,
    /** Syncs stale catalogs now and every few hours. */
    startCatalogSync(everyMs = 6 * 3_600_000) {
      const run = () => catalog.syncStale().then(r => console.info('[market] catalog sync', JSON.stringify(r))).catch(e => log('Catalog sync failed', e));
      void run();
      syncTimer = setInterval(run, everyMs);
    },
    stop() {
      clearInterval(syncTimer);
      hub.stop();
    },
  };
}

export type MarketModule = ReturnType<typeof createMarketModule>;
