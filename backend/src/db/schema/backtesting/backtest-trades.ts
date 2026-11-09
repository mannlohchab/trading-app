import { sql } from 'drizzle-orm';
import { check, index, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { amount, createdAt, id, jsonObject, unixMs } from '../columns';
import { tradeSide } from '../enums';
import { tradingSymbols } from '../market/trading-symbols';
import { backtestResults } from './backtest-results';

/** Entry/exit times are Unix milliseconds. */
export const backtestTrades = pgTable(
  'backtest_trades',
  {
    id: id(),
    backtestResultId: uuid().notNull().references(() => backtestResults.id, { onDelete: 'cascade' }),
    symbolId: uuid().notNull().references(() => tradingSymbols.id, { onDelete: 'restrict' }),
    side: tradeSide().notNull(),
    entryTime: unixMs().notNull(),
    exitTime: unixMs(),
    entryPrice: amount().notNull(),
    exitPrice: amount(),
    quantity: amount().notNull(),
    profitLoss: amount(),
    fees: amount().notNull().default(sql`0`),
    exitReason: varchar({ length: 50 }),
    metadata: jsonObject(),
    createdAt: createdAt(),
  },
  t => [
    check('backtest_trades_quantity_chk', sql`${t.quantity} > 0`),
    check('backtest_trades_entry_price_chk', sql`${t.entryPrice} > 0`),
    check('backtest_trades_exit_time_chk', sql`${t.exitTime} IS NULL OR ${t.exitTime} >= ${t.entryTime}`),
    index('backtest_trades_result_entry_idx').on(t.backtestResultId, t.entryTime),
  ],
);

export type BacktestTrade = typeof backtestTrades.$inferSelect;
export type NewBacktestTrade = typeof backtestTrades.$inferInsert;
