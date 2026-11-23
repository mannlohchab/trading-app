import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { amount, createdAt, id, jsonObject, updatedAt } from '../columns';
import { assetType } from '../enums';
import { exchanges } from './exchanges';

export const tradingSymbols = pgTable(
  'trading_symbols',
  {
    id: id(),
    exchangeId: uuid().notNull().references(() => exchanges.id, { onDelete: 'restrict' }),
    symbol: varchar({ length: 50 }).notNull(),
    baseAsset: varchar({ length: 30 }).notNull(),
    quoteAsset: varchar({ length: 30 }).notNull(),
    assetType: assetType().notNull().default('SPOT'),
    pricePrecision: integer(),
    quantityPrecision: integer(),
    priceTickSize: amount(),
    quantityStepSize: amount(),
    isActive: boolean().notNull().default(true),
    metadata: jsonObject(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('trading_symbols_exchange_symbol_uq').on(t.exchangeId, t.symbol),
    check(
      'trading_symbols_precision_chk',
      sql`(${t.pricePrecision} IS NULL OR ${t.pricePrecision} >= 0) AND (${t.quantityPrecision} IS NULL OR ${t.quantityPrecision} >= 0)`,
    ),
    index('trading_symbols_base_quote_idx').on(t.baseAsset, t.quoteAsset),
  ],
);

export type TradingSymbol = typeof tradingSymbols.$inferSelect;
export type NewTradingSymbol = typeof tradingSymbols.$inferInsert;
