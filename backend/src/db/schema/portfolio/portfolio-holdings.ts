import { sql } from 'drizzle-orm';
import { check, date, integer, pgTable, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { amount, createdAt, id, updatedAt } from '../columns';
import { users } from '../identity/users';

/**
 * What a user really holds outside the app (one row per purchase lot), entered in the Portfolio
 * table so the AI assistant can analyse it. Not linked to paper trading. The whole table is saved
 * at once, so `position` is the row order the user sees.
 */
export const portfolioHoldings = pgTable(
  'portfolio_holdings',
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    /** As the user typed it, upper-cased: a coin (BTC), a pair (BTCUSDT) or anything else (RELIANCE). */
    asset: varchar({ length: 30 }).notNull(),
    quantity: amount().notNull(),
    boughtOn: date({ mode: 'string' }).notNull(),
    /** Price per unit paid, if the user knows it. */
    buyPrice: amount(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    check('portfolio_holdings_quantity_chk', sql`${t.quantity} > 0`),
    check('portfolio_holdings_buy_price_chk', sql`${t.buyPrice} IS NULL OR ${t.buyPrice} > 0`),
    check('portfolio_holdings_position_chk', sql`${t.position} >= 0`),
    unique('portfolio_holdings_user_position_uq').on(t.userId, t.position),
  ],
);

export type PortfolioHoldingRow = typeof portfolioHoldings.$inferSelect;
