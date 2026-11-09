import { boolean, pgTable, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from '../columns';
import { exchangeType } from '../enums';

export const exchanges = pgTable('exchanges', {
  id: id(),
  name: varchar({ length: 100 }).notNull(),
  code: varchar({ length: 30 }).notNull().unique('exchanges_code_key'),
  exchangeType: exchangeType().notNull().default('CRYPTO'),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type Exchange = typeof exchanges.$inferSelect;
export type NewExchange = typeof exchanges.$inferInsert;
