import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, jsonObject, type Json } from '../columns';
import { strategies } from './strategies';

/** Immutable: create a new version instead of updating a row. */
export const strategyVersions = pgTable(
  'strategy_versions',
  {
    id: id(),
    strategyId: uuid().notNull().references(() => strategies.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    definition: jsonb().$type<Json>().notNull(),
    parameters: jsonObject(),
    riskSettings: jsonObject(),
    engineVersion: varchar({ length: 30 }).notNull(),
    createdAt: createdAt(),
  },
  t => [
    unique('strategy_versions_strategy_version_uq').on(t.strategyId, t.version),
    check('strategy_versions_version_chk', sql`${t.version} > 0`),
    check('strategy_versions_definition_object_chk', sql`jsonb_typeof(${t.definition}) = 'object'`),
    index('strategy_versions_strategy_created_idx').on(t.strategyId, t.createdAt.desc().nullsFirst()),
  ],
);

export type StrategyVersion = typeof strategyVersions.$inferSelect;
export type NewStrategyVersion = typeof strategyVersions.$inferInsert;
