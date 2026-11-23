import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createdAt, E164, id, timestamptz, updatedAt } from '../columns';
import { userStatus } from '../enums';

/**
 * Phone verification is required before a user becomes ACTIVE.
 *
 * Better Auth reads/writes `name`, `email`, `emailVerified`, `image`, `phoneNumber` and
 * `phoneNumberVerified` (property names match its field names). The `*VerifiedAt` timestamps are
 * the domain's record of when verification happened; CHECK constraints keep each boolean in sync.
 */
export const users = pgTable(
  'users',
  {
    id: id(),
    name: varchar({ length: 255 }),
    image: text(),
    phoneNumber: varchar({ length: 20 }),
    phoneNumberVerified: boolean().notNull().default(false),
    phoneVerifiedAt: timestamptz(),
    email: varchar({ length: 255 }),
    emailVerified: boolean().notNull().default(false),
    emailVerifiedAt: timestamptz(),
    username: varchar({ length: 30 }),
    status: userStatus().notNull().default('PENDING_PHONE_VERIFICATION'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamptz(),
  },
  t => [
    check('users_phone_number_format_chk', sql`${t.phoneNumber} IS NULL OR ${t.phoneNumber} ~ ${E164}`),
    check('users_username_format_chk', sql`${t.username} IS NULL OR ${t.username} ~ '^[A-Za-z0-9_]{3,30}$'`),
    check('users_active_requires_verified_phone_chk', sql`${t.status} <> 'ACTIVE' OR ${t.phoneVerifiedAt} IS NOT NULL`),
    check('users_phone_verified_sync_chk', sql`${t.phoneNumberVerified} = (${t.phoneVerifiedAt} IS NOT NULL)`),
    check('users_email_verified_sync_chk', sql`${t.emailVerified} = (${t.emailVerifiedAt} IS NOT NULL)`),
    uniqueIndex('users_phone_number_uq').on(t.phoneNumber).where(sql`${t.phoneNumber} IS NOT NULL`),
    uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`).where(sql`${t.email} IS NOT NULL`),
    uniqueIndex('users_username_lower_uq').on(sql`lower(${t.username})`).where(sql`${t.username} IS NOT NULL`),
    index('users_status_created_at_idx').on(t.status, t.createdAt.desc().nullsFirst()),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
