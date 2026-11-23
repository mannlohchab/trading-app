import { sql } from 'drizzle-orm';
import { check, integer, pgTable, uuid } from 'drizzle-orm/pg-core';
import { amount, createdAt, id, jsonObject, ratio } from '../columns';
import { backtestJobs } from './backtest-jobs';

/** One result per backtest job. */
export const backtestResults = pgTable(
  'backtest_results',
  {
    id: id(),
    backtestJobId: uuid()
      .notNull()
      .unique('backtest_results_backtest_job_id_key')
      .references(() => backtestJobs.id, { onDelete: 'cascade' }),
    finalBalance: amount(),
    netProfit: amount(),
    totalReturn: ratio(),
    winRate: ratio(),
    profitFactor: ratio(),
    maxDrawdown: ratio(),
    totalTrades: integer().notNull().default(0),
    winningTrades: integer().notNull().default(0),
    losingTrades: integer().notNull().default(0),
    averageProfit: amount(),
    averageLoss: amount(),
    metrics: jsonObject(),
    createdAt: createdAt(),
  },
  t => [
    check(
      'backtest_results_counts_chk',
      sql`${t.totalTrades} >= 0 AND ${t.winningTrades} >= 0 AND ${t.losingTrades} >= 0 AND ${t.winningTrades} + ${t.losingTrades} <= ${t.totalTrades}`,
    ),
  ],
);

export type BacktestResult = typeof backtestResults.$inferSelect;
export type NewBacktestResult = typeof backtestResults.$inferInsert;
