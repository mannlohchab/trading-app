// Syncs every exchange's instrument catalog into Postgres now: `bun run market:sync`.
import { closeDatabase, db } from '../db/client';
import { InstrumentCatalogService } from '../modules/market/application/instrument-catalog.service';
import { binanceAdapters } from '../modules/market';
import { DrizzleInstrumentRepository } from '../modules/market/infrastructure/drizzle-instrument.repository';

const catalog = new InstrumentCatalogService({
  providers: [binanceAdapters().provider],
  instruments: new DrizzleInstrumentRepository(db),
  clock: { now: () => new Date() },
  maxAgeMs: 0, // always sync
});
try {
  console.log(JSON.stringify(await catalog.syncStale(), null, 2));
} finally {
  await closeDatabase();
}
