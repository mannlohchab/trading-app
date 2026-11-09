import { index, jsonb, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, jsonObject, type Json } from '../columns';
import { messageRole } from '../enums';
import { conversations } from './conversations';

export const messages = pgTable(
  'messages',
  {
    id: id(),
    conversationId: uuid().notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    role: messageRole().notNull(),
    content: text().notNull(),
    metadata: jsonObject(),
    modelProvider: varchar({ length: 50 }),
    modelName: varchar({ length: 100 }),
    tokenUsage: jsonb().$type<Json>(),
    createdAt: createdAt(),
  },
  t => [index('messages_conversation_created_idx').on(t.conversationId, t.createdAt.asc())],
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
