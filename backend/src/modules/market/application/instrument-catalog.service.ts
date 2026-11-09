import type { Clock, InstrumentRepository, MarketDataProvider } from './ports';

/** Keeps each exchange's instrument list in Postgres in step with the exchange. */
export class InstrumentCatalogService {
  constructor(private readonly deps: {
    providers: MarketDataProvider[];
    instruments: InstrumentRepository;
    clock: Clock;
    /** Re-sync when the stored catalog is older than this. */
    maxAgeMs?: number;
  }) {}

  async sync(exchange: string) {
    const provider = this.deps.providers.find(p => p.exchange === exchange);
    if (!provider) throw new Error(`No market data provider for ${exchange}`);
    const instruments = (await provider.fetchInstruments()).filter(i => i.exchange === exchange);
    // An empty answer is far more likely an upstream glitch than a delisting of everything.
    if (!instruments.length) throw new Error(`${exchange} returned no instruments; keeping the current catalog`);
    return this.deps.instruments.sync(exchange, instruments);
  }

  /** Syncs every exchange whose catalog is missing or stale. Returns per-exchange results. */
  async syncStale() {
    const maxAge = this.deps.maxAgeMs ?? 24 * 3_600_000;
    const results: Record<string, { upserted: number; deactivated: number } | { skipped: true } | { error: string }> = {};
    for (const { exchange } of this.deps.providers) {
      try {
        const last = await this.deps.instruments.lastSyncedAt(exchange);
        results[exchange] = last && this.deps.clock.now().getTime() - last.getTime() < maxAge ? { skipped: true } : await this.sync(exchange);
      } catch (error) {
        results[exchange] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    return results;
  }
}
