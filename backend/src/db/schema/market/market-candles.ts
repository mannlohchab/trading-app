import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, pgTable, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { amount, createdAt, unixMs } from '../columns';
import { tradingSymbols } from './trading-symbols';

/** One row per symbol/timeframe/open time. Times are Unix milliseconds. */
export const marketCandles = pgTable(
  'market_candles',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    symbolId: uuid().notNull().references(() => tradingSymbols.id, { onDelete: 'restrict' }),
    timeframe: varchar({ length: 10 }).notNull(),
    openTime: unixMs().notNull(),
    closeTime: unixMs().notNull(),
    open: amount().notNull(),
    high: amount().notNull(),
    low: amount().notNull(),
    close: amount().notNull(),
    volume: amount().notNull().default(sql`0`),
    quoteVolume: amount(),
    tradesCount: integer(),
    isClosed: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  t => [
    unique('market_candles_symbol_tf_open_uq').on(t.symbolId, t.timeframe, t.openTime),
    check('market_candles_time_chk', sql`${t.closeTime} >= ${t.openTime}`),
    check(
      'market_candles_ohlc_chk',
      sql`${t.high} >= ${t.low} AND ${t.high} >= ${t.open} AND ${t.high} >= ${t.close} AND ${t.low} <= ${t.open} AND ${t.low} <= ${t.close}`,
    ),
    check('market_candles_volume_chk', sql`${t.volume} >= 0 AND (${t.quoteVolume} IS NULL OR ${t.quoteVolume} >= 0)`),
    index('market_candles_range_idx').on(t.symbolId, t.timeframe, t.openTime.desc().nullsFirst()),
  ],
);

export type MarketCandle = typeof marketCandles.$inferSelect;
export type NewMarketCandle = typeof marketCandles.$inferInsert;
