import { check, index, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, id } from '../columns';
import { users } from '../identity/users';

/**
 * Durable facts the user told the assistant about their trading (goals, experience, risk limits,
 * preferred markets). Written only by the assistant's remember tool, listed and deleted by the user
 * in the app. Never updated in place: a changed fact is forgotten and remembered again.
 */
export const aiUserMemories = pgTable(
  'ai_user_memories',
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    content: varchar({ length: 300 }).notNull(),
    createdAt: createdAt(),
  },
  t => [
    index('ai_user_memories_user_created_idx').on(t.userId, t.createdAt),
    check('ai_user_memories_content_chk', sql`length(btrim(${t.content})) > 0`),
  ],
);

export type AiUserMemoryRow = typeof aiUserMemories.$inferSelect;
