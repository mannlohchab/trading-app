import { index, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from '../columns';
import { consentType } from '../enums';
import { users } from '../identity/users';

/** Consent history: one row per accept/withdraw event, newest wins. */
export const userConsents = pgTable(
  'user_consents',
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    consentType: consentType().notNull(),
    documentVersion: varchar({ length: 30 }).notNull(),
    acceptedAt: timestamptz(),
    withdrawnAt: timestamptz(),
    createdAt: createdAt(),
  },
  t => [index('user_consents_user_type_idx').on(t.userId, t.consentType, t.createdAt.desc().nullsFirst())],
);

export type UserConsent = typeof userConsents.$inferSelect;
export type NewUserConsent = typeof userConsents.$inferInsert;
