import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, jsonObject, timestamptz, updatedAt } from '../columns';
import { users } from '../identity/users';
import { tradingSymbols } from '../market/trading-symbols';
import { strategies } from '../strategies/strategies';
import { strategyVersions } from '../strategies/strategy-versions';
import { paperAccounts } from './paper-accounts';

export const PAPER_STRATEGY_STATUSES = ['CREATED', 'RUNNING', 'PAUSED', 'STOPPED', 'FAILED'] as const;

/**
 * An automated run of one immutable strategy version on one paper account and market.
 * Its configuration (including the generated script) is fixed at start; it never switches version.
 */
export const paperStrategyInstances = pgTable(
  'paper_strategy_instances',
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    paperAccountId: uuid().notNull().references(() => paperAccounts.id, { onDelete: 'cascade' }),
    strategyId: uuid().notNull().references(() => strategies.id, { onDelete: 'cascade' }),
    strategyVersionId: uuid().notNull().references(() => strategyVersions.id, { onDelete: 'restrict' }),
    symbolId: uuid().notNull().references(() => tradingSymbols.id, { onDelete: 'restrict' }),
    timeframe: varchar({ length: 10 }).notNull(),
    status: varchar({ length: 10, enum: PAPER_STRATEGY_STATUSES }).notNull().default('CREATED'),
    /** Sizing, execution settings, script source and engine identity, fixed at start. */
    configuration: jsonObject(),
    /** Open time (Unix ms) of the last fully processed closed candle. */
    lastProcessedCandleTime: bigint({ mode: 'number' }),
    lastSignalId: uuid(),
    errorMessage: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    startedAt: timestamptz(),
    pausedAt: timestamptz(),
    stoppedAt: timestamptz(),
  },
  t => [
    check('paper_strategy_instances_status_chk', sql`${t.status} IN ('CREATED', 'RUNNING', 'PAUSED', 'STOPPED', 'FAILED')`),
    // One live strategy per account and symbol: two would fight over the same one-way position.
    uniqueIndex('paper_strategy_instances_live_uq').on(t.paperAccountId, t.symbolId).where(sql`${t.status} IN ('CREATED', 'RUNNING', 'PAUSED')`),
    index('paper_strategy_instances_user_created_idx').on(t.userId, t.createdAt.desc().nullsFirst()),
    index('paper_strategy_instances_live_idx').on(t.symbolId, t.timeframe).where(sql`${t.status} IN ('CREATED', 'RUNNING')`),
  ],
);

export type PaperStrategyInstance = typeof paperStrategyInstances.$inferSelect;
