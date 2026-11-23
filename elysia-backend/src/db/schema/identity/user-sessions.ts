import { sql } from 'drizzle-orm';
import { index, inet, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz, updatedAt } from '../columns';
import { users } from './users';

/**
 * Better Auth sessions. `token` is the opaque session token (sent to clients in a signed cookie
 * or bearer header). Sign-out deletes the row.
 */
export const userSessions = pgTable(
  'user_sessions',
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: text().notNull().unique('user_sessions_token_key'),
    deviceName: varchar({ length: 255 }),
    deviceType: varchar({ length: 30 }),
    ipAddress: inet(),
    userAgent: text(),
    expiresAt: timestamptz().notNull(),
    revokedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    index('user_sessions_user_active_idx')
      .on(t.userId, t.expiresAt.desc().nullsFirst())
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);

export type UserSession = typeof userSessions.$inferSelect;
export type NewUserSession = typeof userSessions.$inferInsert;
