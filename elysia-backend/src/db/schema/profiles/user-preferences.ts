import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import {
  AI_EXPLANATION_LEVELS,
  AI_RESPONSE_STYLES,
  CHART_TYPES,
  MARKET_TYPES,
  THEMES,
  TIMEFRAMES,
} from '../../../modules/profiles/domain/preference-options';
import { createdAt, id, updatedAt } from '../columns';
import { assetType } from '../enums';
import { users } from '../identity/users';
import { exchanges } from '../market/exchanges';
import { tradingSymbols } from '../market/trading-symbols';

const oneOf = (values: readonly string[]) => sql.raw(`(${values.map(v => `'${v}'`).join(', ')})`);

/** One row per user, created on first save. Missing rows mean "all defaults". */
export const userPreferences = pgTable(
  'user_preferences',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .unique('user_preferences_user_id_key')
      .references(() => users.id, { onDelete: 'cascade' }),
    // General
    language: varchar({ length: 16 }).notNull().default('en'),
    timezone: varchar({ length: 64 }).notNull().default('UTC'),
    defaultCurrency: varchar({ length: 10 }).notNull().default('USDT'),
    theme: varchar({ length: 20, enum: THEMES }).notNull().default('SYSTEM'),
    notificationsEnabled: boolean().notNull().default(true),
    // Trading
    defaultExchangeId: uuid(),
    defaultMarketType: assetType().notNull().default('SPOT'),
    defaultTradingSymbolId: uuid(),
    defaultTimeframe: varchar({ length: 10, enum: TIMEFRAMES }).notNull().default('1h'),
    chartType: varchar({ length: 20, enum: CHART_TYPES }).notNull().default('CANDLES'),
    // AI
    aiResponseStyle: varchar({ length: 20, enum: AI_RESPONSE_STYLES }).notNull().default('BALANCED'),
    aiExplanationLevel: varchar({ length: 20, enum: AI_EXPLANATION_LEVELS }).notNull().default('BEGINNER'),
    /** Null = answer in the app language. */
    aiLanguage: varchar({ length: 16 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    check('user_preferences_theme_chk', sql`${t.theme} IN ('LIGHT', 'DARK', 'SYSTEM')`),
    check('user_preferences_timeframe_chk', sql`${t.defaultTimeframe} IN ${oneOf(TIMEFRAMES)}`),
    check('user_preferences_market_type_chk', sql`${t.defaultMarketType} IN ${oneOf(MARKET_TYPES)}`),
    check('user_preferences_chart_type_chk', sql`${t.chartType} IN ${oneOf(CHART_TYPES)}`),
    check('user_preferences_ai_response_style_chk', sql`${t.aiResponseStyle} IN ${oneOf(AI_RESPONSE_STYLES)}`),
    check('user_preferences_ai_explanation_level_chk', sql`${t.aiExplanationLevel} IN ${oneOf(AI_EXPLANATION_LEVELS)}`),
    check('user_preferences_currency_format_chk', sql`${t.defaultCurrency} ~ '^[A-Z]{3,10}$'`),
    foreignKey({
      name: 'user_preferences_default_exchange_fk',
      columns: [t.defaultExchangeId],
      foreignColumns: [exchanges.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'user_preferences_default_symbol_fk',
      columns: [t.defaultTradingSymbolId],
      foreignColumns: [tradingSymbols.id],
    }).onDelete('set null'),
  ],
);

export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;
