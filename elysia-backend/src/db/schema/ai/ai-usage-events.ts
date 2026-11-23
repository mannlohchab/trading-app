import { index, integer, numeric, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id } from '../columns';
import { users } from '../identity/users';
import { conversations } from './conversations';

/**
 * One row per model call (an assistant turn may take several rounds when tools are used).
 * Postgres is the source of truth for quotas and cost reporting.
 */
export const aiUsageEvents = pgTable(
  'ai_usage_events',
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    conversationId: uuid().references(() => conversations.id, { onDelete: 'set null' }),
    /** Groups the calls of one assistant turn (the assistant message's id once saved). */
    turnId: uuid().notNull(),
    provider: varchar({ length: 50 }).notNull(),
    model: varchar({ length: 100 }).notNull(),
    status: varchar({ length: 20, enum: ['SUCCEEDED', 'FAILED', 'CANCELLED'] }).notNull(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    /** Provider-reported cost, e.g. Cloudflare "neurons". */
    costUnits: numeric({ precision: 18, scale: 6 }),
    costUnit: varchar({ length: 20 }),
    toolCalls: integer().notNull().default(0),
    latencyMs: integer().notNull(),
    errorCode: varchar({ length: 50 }),
    createdAt: createdAt(),
  },
  t => [
    index('ai_usage_events_user_created_idx').on(t.userId, t.createdAt.desc().nullsFirst()),
    index('ai_usage_events_turn_idx').on(t.turnId),
  ],
);

export type AiUsageEvent = typeof aiUsageEvents.$inferSelect;
