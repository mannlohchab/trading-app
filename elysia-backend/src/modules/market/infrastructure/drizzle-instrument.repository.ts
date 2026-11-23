import { and, asc, count, eq, ilike, inArray, max, notInArray, or, sql } from 'drizzle-orm';
import { exchanges, tradingSymbols } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { InstrumentRepository, StoredInstrument } from '../application/ports';
import type { MarketType } from '../domain/market-options';
import { normalizeDecimal } from '../domain/rules';
import type { Instrument } from '../domain/types';

const CHUNK = 500;
type Row = typeof tradingSymbols.$inferSelect;

const toInstrument = (exchange: string, r: Row): StoredInstrument => ({
  id: r.id,
  exchange,
  symbol: r.symbol,
  baseAsset: r.baseAsset,
  quoteAsset: r.quoteAsset,
  marketType: r.assetType as MarketType,
  pricePrecision: r.pricePrecision,
  quantityPrecision: r.quantityPrecision,
  tickSize: r.priceTickSize === null ? null : normalizeDecimal(r.priceTickSize),
  stepSize: r.quantityStepSize === null ? null : normalizeDecimal(r.quantityStepSize),
  isActive: r.isActive,
  metadata: r.metadata,
});

export class DrizzleInstrumentRepository implements InstrumentRepository {
  constructor(private readonly db: AppDatabase) {}

  private async exchangeId(code: string, db: Pick<AppDatabase, 'select'> = this.db) {
    const [row] = await db.select({ id: exchanges.id }).from(exchanges).where(eq(exchanges.code, code));
    if (!row) throw new Error(`Exchange ${code} is not in the exchanges table`);
    return row.id;
  }

  sync(exchange: string, instruments: Instrument[]) {
    return this.db.transaction(async tx => {
      const exchangeId = await this.exchangeId(exchange, tx);
      for (let i = 0; i < instruments.length; i += CHUNK) {
        const rows = instruments.slice(i, i + CHUNK).map(x => ({
          exchangeId,
          symbol: x.symbol,
          baseAsset: x.baseAsset,
          quoteAsset: x.quoteAsset,
          assetType: x.marketType,
          pricePrecision: x.pricePrecision,
          quantityPrecision: x.quantityPrecision,
          priceTickSize: x.tickSize,
          quantityStepSize: x.stepSize,
          isActive: true,
          metadata: x.metadata,
        }));
        await tx.insert(tradingSymbols).values(rows).onConflictDoUpdate({
          target: [tradingSymbols.exchangeId, tradingSymbols.symbol],
          set: {
            baseAsset: sql`excluded.base_asset`,
            quoteAsset: sql`excluded.quote_asset`,
            assetType: sql`excluded.asset_type`,
            pricePrecision: sql`excluded.price_precision`,
            quantityPrecision: sql`excluded.quantity_precision`,
            priceTickSize: sql`excluded.price_tick_size`,
            quantityStepSize: sql`excluded.quantity_step_size`,
            isActive: sql`true`,
            metadata: sql`excluded.metadata`,
            updatedAt: sql`now()`, // marks the row as seen in this sync, even when nothing else changed
          },
        });
      }
      // Delisted symbols are deactivated, never deleted: orders, positions and candles reference them.
      const deactivated = await tx
        .update(tradingSymbols)
        .set({ isActive: false })
        .where(and(
          eq(tradingSymbols.exchangeId, exchangeId),
          eq(tradingSymbols.isActive, true),
          notInArray(tradingSymbols.symbol, instruments.map(x => x.symbol)),
        ))
        .returning({ id: tradingSymbols.id });
      return { upserted: instruments.length, deactivated: deactivated.length };
    });
  }

  async lastSyncedAt(exchange: string) {
    const [row] = await this.db
      .select({ at: max(tradingSymbols.updatedAt) })
      .from(tradingSymbols)
      .innerJoin(exchanges, eq(exchanges.id, tradingSymbols.exchangeId))
      .where(eq(exchanges.code, exchange));
    return row?.at ?? null;
  }

  async listExchanges() {
    const rows = await this.db
      .select({ code: exchanges.code, name: exchanges.name, type: exchanges.exchangeType })
      .from(exchanges)
      .where(eq(exchanges.isActive, true))
      .orderBy(asc(exchanges.code));
    return rows;
  }

  async search(filter: { exchange: string; quoteAsset?: string; query?: string; limit: number; offset: number }) {
    const exchangeId = await this.exchangeId(filter.exchange);
    const pattern = filter.query && `%${filter.query.replace(/[\\%_]/g, '\\$&')}%`;
    const where = and(
      eq(tradingSymbols.exchangeId, exchangeId),
      eq(tradingSymbols.isActive, true),
      filter.quoteAsset ? eq(tradingSymbols.quoteAsset, filter.quoteAsset) : undefined,
      pattern ? or(ilike(tradingSymbols.symbol, pattern), ilike(tradingSymbols.baseAsset, pattern)) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db.select().from(tradingSymbols).where(where).orderBy(asc(tradingSymbols.symbol)).limit(filter.limit).offset(filter.offset),
      this.db.select({ n: count() }).from(tradingSymbols).where(where),
    ]);
    return { items: rows.map(r => toInstrument(filter.exchange, r)), total: total?.n ?? 0 };
  }

  async findActive(exchange: string, symbols: string[]) {
    if (!symbols.length) return new Map();
    const rows = await this.db
      .select({ s: tradingSymbols })
      .from(tradingSymbols)
      .innerJoin(exchanges, eq(exchanges.id, tradingSymbols.exchangeId))
      .where(and(eq(exchanges.code, exchange), eq(tradingSymbols.isActive, true), inArray(tradingSymbols.symbol, symbols)));
    return new Map(rows.map(({ s }) => [s.symbol, toInstrument(exchange, s)]));
  }

  async activeSymbols(exchange: string, quoteAsset?: string) {
    const rows = await this.db
      .select({ symbol: tradingSymbols.symbol })
      .from(tradingSymbols)
      .innerJoin(exchanges, eq(exchanges.id, tradingSymbols.exchangeId))
      .where(and(
        eq(exchanges.code, exchange),
        eq(tradingSymbols.isActive, true),
        quoteAsset ? eq(tradingSymbols.quoteAsset, quoteAsset) : undefined,
      ));
    return new Set(rows.map(r => r.symbol));
  }
}
