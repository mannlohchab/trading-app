import { index, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz, updatedAt } from '../columns';

/**
 * Better Auth's short-lived verification values (OAuth state, email tokens, etc.).
 * Phone OTPs are NOT kept here: they are hashed into `phone_verifications` instead.
 */
export const authVerifications = pgTable(
  'auth_verifications',
  {
    id: id(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamptz().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index('auth_verifications_identifier_idx').on(t.identifier)],
);

export type AuthVerification = typeof authVerifications.$inferSelect;
