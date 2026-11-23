// Allowed preference values. The database CHECK constraints are generated from these lists.

import type { MarketType, Timeframe } from '../../market/domain/market-options';

// Market types and timeframes are owned by the market module.
export { MARKET_TYPES, TIMEFRAMES } from '../../market/domain/market-options';
export type { MarketType, Timeframe };

export const THEMES = ['LIGHT', 'DARK', 'SYSTEM'] as const;
export const CHART_TYPES = ['CANDLES', 'HEIKIN_ASHI', 'BARS', 'LINE', 'AREA'] as const;
export const AI_RESPONSE_STYLES = ['CONCISE', 'BALANCED', 'DETAILED'] as const;
export const AI_EXPLANATION_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;

export type Theme = (typeof THEMES)[number];
export type ChartType = (typeof CHART_TYPES)[number];
export type AiResponseStyle = (typeof AI_RESPONSE_STYLES)[number];
export type AiExplanationLevel = (typeof AI_EXPLANATION_LEVELS)[number];
