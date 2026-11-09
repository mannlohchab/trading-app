import { relations } from 'drizzle-orm';
import { backtestJobs, backtestTrades } from '../schema/backtesting';
import { exchanges, marketCandles, tradingSymbols } from '../schema/market';
import { paperOrders, paperPositions } from '../schema/paper-trading';

export const exchangesRelations = relations(exchanges, ({ many }) => ({
  symbols: many(tradingSymbols),
}));

export const tradingSymbolsRelations = relations(tradingSymbols, ({ one, many }) => ({
  exchange: one(exchanges, { fields: [tradingSymbols.exchangeId], references: [exchanges.id] }),
  candles: many(marketCandles),
  backtestJobs: many(backtestJobs),
  backtestTrades: many(backtestTrades),
  paperOrders: many(paperOrders),
  paperPositions: many(paperPositions),
}));

export const marketCandlesRelations = relations(marketCandles, ({ one }) => ({
  symbol: one(tradingSymbols, { fields: [marketCandles.symbolId], references: [tradingSymbols.id] }),
}));
