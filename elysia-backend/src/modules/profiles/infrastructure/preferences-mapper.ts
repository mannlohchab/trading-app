import type { userPreferences } from '../../../db/schema';
import type { Preferences } from '../domain/preferences';
import type { MarketType } from '../domain/preference-options';

type Row = typeof userPreferences.$inferSelect;

export function toPreferences(row: Row, exchangeCode: string | null, symbol: string | null): Preferences {
  return {
    general: {
      language: row.language,
      timezone: row.timezone,
      currency: row.defaultCurrency,
      theme: row.theme,
      notificationsEnabled: row.notificationsEnabled,
    },
    trading: {
      exchange: exchangeCode,
      marketType: row.defaultMarketType as MarketType,
      tradingPair: symbol,
      timeframe: row.defaultTimeframe,
      chartType: row.chartType,
    },
    ai: { responseStyle: row.aiResponseStyle, explanationLevel: row.aiExplanationLevel, language: row.aiLanguage },
  };
}

export function toRow(p: Preferences, refs: { exchangeId: string | null; symbolId: string | null }) {
  return {
    language: p.general.language,
    timezone: p.general.timezone,
    defaultCurrency: p.general.currency,
    theme: p.general.theme,
    notificationsEnabled: p.general.notificationsEnabled,
    defaultExchangeId: refs.exchangeId,
    defaultMarketType: p.trading.marketType,
    defaultTradingSymbolId: refs.symbolId,
    defaultTimeframe: p.trading.timeframe,
    chartType: p.trading.chartType,
    aiResponseStyle: p.ai.responseStyle,
    aiExplanationLevel: p.ai.explanationLevel,
    aiLanguage: p.ai.language,
  } satisfies Partial<Row>;
}
