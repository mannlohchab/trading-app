import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { amount, createdAt, id, jsonObject, rate, timestamptz, unixMs } from '../columns';
import { backtestStatus } from '../enums';
import { users } from '../identity/users';
import { tradingSymbols } from '../market/trading-symbols';
import { strategyVersions } from '../strategies/strategy-versions';

/** Start/end times are Unix milliseconds. */
export const backtestJobs = pgTable(
  'backtest_jobs',
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    strategyVersionId: uuid().notNull().references(() => strategyVersions.id, { onDelete: 'restrict' }),
    symbolId: uuid().notNull().references(() => tradingSymbols.id, { onDelete: 'restrict' }),
    timeframe: varchar({ length: 10 }).notNull(),
    startTime: unixMs().notNull(),
    endTime: unixMs().notNull(),
    initialBalance: amount().notNull(),
    feeRate: rate().notNull().default(sql`0`),
    slippageRate: rate().notNull().default(sql`0`),
    configuration: jsonObject(),
    status: backtestStatus().notNull().default('PENDING'),
    errorMessage: text(),
    createdAt: createdAt(),
    startedAt: timestamptz(),
    completedAt: timestamptz(),
  },
  t => [
    check('backtest_jobs_time_chk', sql`${t.endTime} > ${t.startTime}`),
    check('backtest_jobs_balance_chk', sql`${t.initialBalance} > 0`),
    check('backtest_jobs_costs_chk', sql`${t.feeRate} >= 0 AND ${t.slippageRate} >= 0`),
    index('backtest_jobs_user_created_idx').on(t.userId, t.createdAt.desc().nullsFirst()),
    index('backtest_jobs_status_created_idx').on(t.status, t.createdAt),
  ],
);

export type BacktestJob = typeof backtestJobs.$inferSelect;
export type NewBacktestJob = typeof backtestJobs.$inferInsert;
