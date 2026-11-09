import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, jsonObject, updatedAt } from '../columns';
import { paperOrders } from './paper-orders';
import { paperStrategyInstances } from './paper-strategy-instances';

/** Actionable signals from automated strategies: one per instance and candle, with what happened to it. */
export const paperSignals = pgTable(
  'paper_signals',
  {
    id: id(),
    strategyInstanceId: uuid().notNull().references(() => paperStrategyInstances.id, { onDelete: 'cascade' }),
    /** Open time (Unix ms) of the closed candle that produced the signal. */
    candleOpenTime: bigint({ mode: 'number' }).notNull(),
    action: varchar({ length: 20, enum: ['ENTER_LONG', 'EXIT_LONG'] }).notNull(),
    status: varchar({ length: 20, enum: ['GENERATED', 'EXECUTED', 'REJECTED', 'SKIPPED'] }).notNull().default('GENERATED'),
    reason: text(),
    orderId: uuid().references(() => paperOrders.id, { onDelete: 'set null' }),
    evaluation: jsonObject(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    uniqueIndex('paper_signals_instance_candle_uq').on(t.strategyInstanceId, t.candleOpenTime),
    check('paper_signals_status_chk', sql`${t.status} IN ('GENERATED', 'EXECUTED', 'REJECTED', 'SKIPPED')`),
    index('paper_signals_pending_idx').on(t.createdAt).where(sql`${t.status} = 'GENERATED'`),
  ],
);

export type PaperSignal = typeof paperSignals.$inferSelect;
