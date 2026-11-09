import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz, updatedAt } from '../columns';
import { authProvider } from '../enums';
import { users } from './users';

/**
 * One row per login method (Better Auth "account"). `provider` holds Better Auth provider ids:
 * `credential` (email + password), `google`, `apple`. OAuth tokens are encrypted by Better Auth
 * before they are stored (`account.encryptOAuthTokens`).
 */
export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: authProvider().notNull(),
    providerAccountId: varchar({ length: 255 }).notNull(),
    passwordHash: text(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamptz(),
    refreshTokenExpiresAt: timestamptz(),
    scope: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('auth_accounts_provider_account_uq').on(t.provider, t.providerAccountId),
    check(
      'auth_accounts_email_password_chk',
      sql`(${t.provider} = 'credential' AND ${t.passwordHash} IS NOT NULL) OR (${t.provider} <> 'credential' AND ${t.passwordHash} IS NULL)`,
    ),
    index('auth_accounts_user_id_idx').on(t.userId),
  ],
);

export type AuthAccount = typeof authAccounts.$inferSelect;
export type NewAuthAccount = typeof authAccounts.$inferInsert;
