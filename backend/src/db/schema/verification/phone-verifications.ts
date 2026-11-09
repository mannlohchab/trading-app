import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, E164, id, jsonObject, timestamptz } from '../columns';
import { phoneVerificationPurpose } from '../enums';
import { users } from '../identity/users';

/** OTP hashes only; never store plaintext OTPs. */
export const phoneVerifications = pgTable(
  'phone_verifications',
  {
    id: id(),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    phoneNumber: varchar({ length: 20 }).notNull(),
    otpHash: text().notNull(),
    purpose: phoneVerificationPurpose().notNull(),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(5),
    expiresAt: timestamptz().notNull(),
    verifiedAt: timestamptz(),
    consumedAt: timestamptz(),
    provider: varchar({ length: 50 }),
    requestMetadata: jsonObject(),
    createdAt: createdAt(),
  },
  t => [
    check('phone_verifications_phone_format_chk', sql`${t.phoneNumber} ~ ${E164}`),
    check('phone_verifications_attempts_chk', sql`${t.attempts} >= 0 AND ${t.maxAttempts} > 0`),
    index('phone_verifications_lookup_idx').on(t.phoneNumber, t.purpose, t.createdAt.desc().nullsFirst()),
    index('phone_verifications_user_idx').on(t.userId, t.createdAt.desc().nullsFirst()),
  ],
);

export type PhoneVerification = typeof phoneVerifications.$inferSelect;
export type NewPhoneVerification = typeof phoneVerifications.$inferInsert;
