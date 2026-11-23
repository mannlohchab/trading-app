import { index, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from '../columns';
import { strategySource, strategyStatus, strategyVisibility } from '../enums';
import { users } from '../identity/users';

export const strategies = pgTable(
  'strategies',
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: varchar({ length: 255 }).notNull(),
    description: text(),
    source: strategySource().notNull(),
    visibility: strategyVisibility().notNull().default('PRIVATE'),
    status: strategyStatus().notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index('strategies_user_updated_idx').on(t.userId, t.updatedAt.desc().nullsFirst())],
);

export type Strategy = typeof strategies.$inferSelect;
export type NewStrategy = typeof strategies.$inferInsert;
