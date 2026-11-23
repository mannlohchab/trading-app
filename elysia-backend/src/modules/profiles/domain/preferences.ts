// Preference rules. Pure functions: no framework, database or I/O.
import type { AiExplanationLevel, AiResponseStyle, ChartType, MarketType, Theme, Timeframe } from './preference-options';
import { canonicalLanguage, isCurrencyCode, isValidTimeZone, type FieldErrors, type Validated } from './validation';

export type Preferences = {
  general: { language: string; timezone: string; currency: string; theme: Theme; notificationsEnabled: boolean };
  /** `exchange` is an exchange code (e.g. "BINANCE"), `tradingPair` a symbol on it (e.g. "BTCUSDT"). */
  trading: { exchange: string | null; marketType: MarketType; tradingPair: string | null; timeframe: Timeframe; chartType: ChartType };
  /** `language` null = reply in the app language. */
  ai: { responseStyle: AiResponseStyle; explanationLevel: AiExplanationLevel; language: string | null };
};

/** Must match the column defaults in db/schema/profiles/user-preferences.ts (a test checks this). */
export const DEFAULT_PREFERENCES: Preferences = {
  general: { language: 'en', timezone: 'UTC', currency: 'USDT', theme: 'SYSTEM', notificationsEnabled: true },
  trading: { exchange: null, marketType: 'SPOT', tradingPair: null, timeframe: '1h', chartType: 'CANDLES' },
  ai: { responseStyle: 'BALANCED', explanationLevel: 'BEGINNER', language: null },
};

export type PreferencesPatch = {
  general?: Partial<Preferences['general']>;
  trading?: Partial<Preferences['trading']>;
  ai?: Partial<Preferences['ai']>;
};

/** Applies a partial update and validates the result's free-form fields. Enum fields are checked at the edge. */
export function applyPreferencesPatch(current: Preferences, patch: PreferencesPatch): Validated<Preferences> {
  const next: Preferences = {
    general: { ...current.general, ...patch.general },
    trading: { ...current.trading, ...patch.trading },
    ai: { ...current.ai, ...patch.ai },
  };
  const errors: FieldErrors = {};

  const language = canonicalLanguage(next.general.language);
  if (!language) errors['general.language'] = 'Use a language tag such as "en" or "hi-IN".';
  else next.general.language = language;

  if (!isValidTimeZone(next.general.timezone)) errors['general.timezone'] = 'Unknown time zone. Use an IANA name such as Asia/Kolkata.';

  next.general.currency = next.general.currency.toUpperCase();
  if (!isCurrencyCode(next.general.currency)) errors['general.currency'] = 'Use a currency code such as USD, INR or USDT.';

  if (next.ai.language !== null) {
    const aiLanguage = canonicalLanguage(next.ai.language);
    if (!aiLanguage) errors['ai.language'] = 'Use a language tag such as "en" or "hi-IN", or null for the app language.';
    else next.ai.language = aiLanguage;
  }

  if (next.trading.exchange) next.trading.exchange = next.trading.exchange.toUpperCase();
  if (next.trading.tradingPair) next.trading.tradingPair = next.trading.tradingPair.toUpperCase();
  // Changing the exchange without naming a pair drops a pair that belonged to the old exchange.
  if (patch.trading?.exchange !== undefined && patch.trading.tradingPair === undefined && patch.trading.exchange !== current.trading.exchange) {
    next.trading.tradingPair = null;
  }
  if (next.trading.tradingPair && !next.trading.exchange) errors['trading.tradingPair'] = 'Choose an exchange before a trading pair.';

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: next };
}

export type ExchangeRef = { id: string; code: string; isActive: boolean };
export type SymbolRef = { id: string; symbol: string; exchangeId: string; assetType: string; isActive: boolean };

/** Checks the chosen exchange/pair against what exists. `exchange`/`symbol` are the lookups (null = not found). */
export function validateTradingSelection(
  trading: Preferences['trading'],
  exchange: ExchangeRef | null,
  symbol: SymbolRef | null,
): FieldErrors {
  const errors: FieldErrors = {};
  if (trading.exchange && (!exchange || !exchange.isActive)) errors['trading.exchange'] = `Unknown or inactive exchange "${trading.exchange}".`;
  if (trading.tradingPair) {
    if (!symbol || !symbol.isActive || (exchange && symbol.exchangeId !== exchange.id)) {
      errors['trading.tradingPair'] = `"${trading.tradingPair}" is not an active pair on ${trading.exchange}.`;
    } else if (symbol.assetType !== trading.marketType) {
      errors['trading.marketType'] = `${trading.tradingPair} is a ${symbol.assetType} market, not ${trading.marketType}.`;
    }
  }
  return errors;
}
