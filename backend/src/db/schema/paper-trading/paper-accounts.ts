import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { amount, createdAt, id, timestamptz, updatedAt } from '../columns';
import { users } from '../identity/users';

export const paperAccounts = pgTable(
  'paper_accounts',
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: varchar({ length: 100 }).notNull(),
    initialBalance: amount().notNull(),
    /** Cash: initial deposit + realized P/L − fees. Every change has a ledger entry. */
    currentBalance: amount().notNull(),
    /** Cash set aside for open orders and as collateral for open positions. Available = current − reserved. */
    reservedBalance: amount().notNull().default(sql`0`),
    /** Running totals, reconciled against the ledger. */
    realizedPnl: amount().notNull().default(sql`0`),
    totalFees: amount().notNull().default(sql`0`),
    /** Sequence number of the latest ledger entry (entries are numbered 1, 2, 3, … per account). */
    ledgerSequence: integer().notNull().default(0),
    currency: varchar({ length: 10 }).notNull().default('USDT'),
    status: varchar({ length: 20, enum: ['ACTIVE', 'PAUSED', 'CLOSED', 'ARCHIVED'] }).notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    closedAt: timestamptz(),
  },
  t => [
    check('paper_accounts_initial_balance_chk', sql`${t.initialBalance} >= 0`),
    check('paper_accounts_status_chk', sql`${t.status} IN ('ACTIVE', 'PAUSED', 'CLOSED', 'ARCHIVED')`),
    check('paper_accounts_reserved_chk', sql`${t.reservedBalance} >= 0 AND ${t.totalFees} >= 0`),
    index('paper_accounts_user_created_idx').on(t.userId, t.createdAt.desc().nullsFirst()),
  ],
);

export type PaperAccount = typeof paperAccounts.$inferSelect;
export type NewPaperAccount = typeof paperAccounts.$inferInsert;
