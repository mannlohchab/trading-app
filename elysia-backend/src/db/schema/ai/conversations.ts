import { index, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from '../columns';
import { conversationStatus } from '../enums';
import { users } from '../identity/users';

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    title: varchar({ length: 255 }),
    status: conversationStatus().notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index('conversations_user_updated_idx').on(t.userId, t.updatedAt.desc().nullsFirst())],
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
