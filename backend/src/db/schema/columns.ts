// Shared column builders used by every domain table.
import { sql } from 'drizzle-orm';
import { bigint, jsonb, numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

export type Json = Record<string, unknown>;

export const id = () => uuid().primaryKey().defaultRandom();
export const timestamptz = () => timestamp({ withTimezone: true });
export const createdAt = () => timestamptz().notNull().defaultNow();
/** Kept current by the set_updated_at trigger (drizzle/0001_*.sql), not by the app. */
export const updatedAt = () => timestamptz().notNull().defaultNow();
export const jsonObject = () => jsonb().$type<Json>().notNull().default({});
/** NUMERIC(30, 12): prices, quantities, balances. Returned as strings; never use JS floats for money. */
export const amount = () => numeric({ precision: 30, scale: 12 });
/** NUMERIC(18, 8): ratios and percentages. */
export const ratio = () => numeric({ precision: 18, scale: 8 });
/** NUMERIC(18, 12): fee and slippage rates. */
export const rate = () => numeric({ precision: 18, scale: 12 });
/** Unix milliseconds. */
export const unixMs = () => bigint({ mode: 'number' });
/** E.164 phone format for CHECK constraints. Backslash is doubled because this is a JS string. */
export const E164 = sql.raw(`'^\\+[1-9][0-9]{7,14}$'`);
