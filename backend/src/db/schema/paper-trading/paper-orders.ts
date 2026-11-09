import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { amount, createdAt, id, jsonObject, timestamptz, updatedAt } from '../columns';
import { users } from '../identity/users';
import { paperOrderStatus, paperOrderType, tradeSide } from '../enums';
import { tradingSymbols } from '../market/trading-symbols';
import { strategyVersions } from '../strategies/strategy-versions';
import { paperAccounts } from './paper-accounts';

/** Use transactions and row locks when filling orders and changing balances. */
export const paperOrders = pgTable(
  'paper_orders',
  {
    id: id(),
    paperAccountId: uuid().notNull().references(() => paperAccounts.id, { onDelete: 'cascade' }),
    /** Owner (denormalized from the account for ownership checks and per-user queries). */
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    symbolId: uuid().notNull().references(() => tradingSymbols.id, { onDelete: 'restrict' }),
    side: tradeSide().notNull(),
    orderType: paperOrderType().notNull(),
    quantity: amount().notNull(),
    price: amount(),
    stopPrice: amount(),
    status: paperOrderStatus().notNull().default('PENDING'),
    filledQuantity: amount().notNull().default(sql`0`),
    averageFillPrice: amount(),
    timeInForce: varchar({ length: 10, enum: ['GTC', 'IOC', 'FOK'] }).notNull().default('GTC'),
    strategyVersionId: uuid().references(() => strategyVersions.id, { onDelete: 'set null' }),
    /** Client- or system-supplied key; the same key on the same account returns the same order. */
    idempotencyKey: varchar({ length: 120 }),
    source: varchar({ length: 20, enum: ['USER', 'STRATEGY', 'PROTECTIVE', 'CLOSE', 'LIQUIDATION'] }).notNull().default('USER'),
    strategyInstanceId: uuid(),
    /** Only reduces an existing position (closing and protective orders). */
    reduceOnly: boolean().notNull().default(false),
    /** One-cancels-other group (a position's stop loss and take profit). */
    ocoGroup: uuid(),
    commission: amount().notNull().default(sql`0`),
    /** Amount currently reserved for this order (released on fill or cancel). */
    reservedAmount: amount().notNull().default(sql`0`),
    rejectReason: text(),
    metadata: jsonObject(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    triggeredAt: timestamptz(),
    filledAt: timestamptz(),
    cancelledAt: timestamptz(),
  },
  t => [
    check(
      'paper_orders_quantity_chk',
      sql`${t.quantity} > 0 AND ${t.filledQuantity} >= 0 AND ${t.filledQuantity} <= ${t.quantity}`,
    ),
    check(
      'paper_orders_price_chk',
      sql`(${t.price} IS NULL OR ${t.price} > 0) AND (${t.stopPrice} IS NULL OR ${t.stopPrice} > 0) AND (${t.averageFillPrice} IS NULL OR ${t.averageFillPrice} > 0)`,
    ),
    check('paper_orders_tif_chk', sql`${t.timeInForce} IN ('GTC', 'IOC', 'FOK')`),
    check('paper_orders_reserved_chk', sql`${t.reservedAmount} >= 0 AND ${t.commission} >= 0`),
    uniqueIndex('paper_orders_account_idempotency_uq').on(t.paperAccountId, t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
    index('paper_orders_user_created_idx').on(t.userId, t.createdAt.desc().nullsFirst()),
    // The execution engine loads resting orders by symbol.
    index('paper_orders_symbol_open_idx').on(t.symbolId).where(sql`${t.status} IN ('PENDING', 'OPEN', 'PARTIALLY_FILLED')`),
    index('paper_orders_account_created_idx').on(t.paperAccountId, t.createdAt.desc().nullsFirst()),
    index('paper_orders_open_status_idx')
      .on(t.paperAccountId, t.status)
      .where(sql`${t.status} IN ('PENDING', 'OPEN', 'PARTIALLY_FILLED')`),
  ],
);

export type PaperOrder = typeof paperOrders.$inferSelect;
export type NewPaperOrder = typeof paperOrders.$inferInsert;
