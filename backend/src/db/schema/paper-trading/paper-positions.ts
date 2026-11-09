import { sql } from 'drizzle-orm';
import { check, index, pgTable, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { amount, id, timestamptz, updatedAt } from '../columns';
import { paperPositionSide } from '../enums';
import { tradingSymbols } from '../market/trading-symbols';
import { paperAccounts } from './paper-accounts';

export const paperPositions = pgTable(
  'paper_positions',
  {
    id: id(),
    paperAccountId: uuid().notNull().references(() => paperAccounts.id, { onDelete: 'cascade' }),
    symbolId: uuid().notNull().references(() => tradingSymbols.id, { onDelete: 'restrict' }),
    side: paperPositionSide().notNull(),
    quantity: amount().notNull(),
    averageEntryPrice: amount().notNull(),
    /** Exact cost basis locked as collateral (sum of opening fills minus releases); avoids average-price rounding drift. */
    collateral: amount().notNull().default(sql`0`),
    realizedPnl: amount().notNull().default(sql`0`),
    totalFees: amount().notNull().default(sql`0`),
    status: varchar({ length: 10, enum: ['OPEN', 'CLOSED'] }).notNull().default('OPEN'),
    /** Last mark price seen by the engine (informational; portfolio values use live prices). */
    lastMarkPrice: amount(),
    lastMarkAt: timestamptz(),
    openedAt: timestamptz().notNull().defaultNow(),
    updatedAt: updatedAt(),
    closedAt: timestamptz(),
  },
  t => [
    // One-way mode: at most one open position per account and symbol; closed ones are history.
    uniqueIndex('paper_positions_one_open_uq').on(t.paperAccountId, t.symbolId).where(sql`${t.status} = 'OPEN'`),
    check('paper_positions_quantity_chk', sql`(${t.status} = 'OPEN' AND ${t.quantity} > 0) OR (${t.status} = 'CLOSED' AND ${t.quantity} = 0)`),
    check('paper_positions_status_chk', sql`${t.status} IN ('OPEN', 'CLOSED')`),
    index('paper_positions_symbol_open_idx').on(t.symbolId).where(sql`${t.status} = 'OPEN'`),
    check('paper_positions_entry_price_chk', sql`${t.averageEntryPrice} > 0`),
    index('paper_positions_account_idx').on(t.paperAccountId),
  ],
);

export type PaperPosition = typeof paperPositions.$inferSelect;
export type NewPaperPosition = typeof paperPositions.$inferInsert;
