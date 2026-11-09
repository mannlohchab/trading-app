import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { amount, createdAt, id, jsonObject } from '../columns';
import { paperTransactionType } from '../enums';
import { paperAccounts } from './paper-accounts';
import { paperOrders } from './paper-orders';

/**
 * Append-only account ledger: the source of truth for every balance movement. A database trigger
 * rejects UPDATE and DELETE (drizzle/0008_*.sql); corrections are new, compensating entries.
 */
export const paperTransactions = pgTable(
  'paper_transactions',
  {
    id: id(),
    paperAccountId: uuid().notNull().references(() => paperAccounts.id, { onDelete: 'cascade' }),
    orderId: uuid().references(() => paperOrders.id, { onDelete: 'set null' }),
    transactionType: paperTransactionType().notNull(),
    /** Change to cash (current_balance). */
    amount: amount().notNull(),
    balanceAfter: amount().notNull(),
    /** Change to the reserved balance (reservations and position collateral). */
    reservedDelta: amount().notNull().default(sql`0`),
    reservedAfter: amount().notNull().default(sql`0`),
    /** Gap-free per-account order of entries; entries in one database transaction share a timestamp. */
    sequence: integer().notNull(),
    /** Idempotency key, unique per account (e.g. "order:<id>:fee"). */
    entryKey: varchar({ length: 150 }).notNull(),
    description: text(),
    metadata: jsonObject(),
    createdAt: createdAt(),
  },
  t => [
    index('paper_transactions_account_created_idx').on(t.paperAccountId, t.createdAt.desc().nullsFirst()),
    uniqueIndex('paper_transactions_account_entry_key_uq').on(t.paperAccountId, t.entryKey),
    uniqueIndex('paper_transactions_account_sequence_uq').on(t.paperAccountId, t.sequence),
  ],
);

export type PaperTransaction = typeof paperTransactions.$inferSelect;
export type NewPaperTransaction = typeof paperTransactions.$inferInsert;
