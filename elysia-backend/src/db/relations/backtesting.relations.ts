import { relations } from 'drizzle-orm';
import { backtestJobs, backtestResults, backtestTrades } from '../schema/backtesting';
import { users } from '../schema/identity';
import { tradingSymbols } from '../schema/market';
import { strategyVersions } from '../schema/strategies';

export const backtestJobsRelations = relations(backtestJobs, ({ one }) => ({
  user: one(users, { fields: [backtestJobs.userId], references: [users.id] }),
  strategyVersion: one(strategyVersions, { fields: [backtestJobs.strategyVersionId], references: [strategyVersions.id] }),
  symbol: one(tradingSymbols, { fields: [backtestJobs.symbolId], references: [tradingSymbols.id] }),
  result: one(backtestResults),
}));

export const backtestResultsRelations = relations(backtestResults, ({ one, many }) => ({
  job: one(backtestJobs, { fields: [backtestResults.backtestJobId], references: [backtestJobs.id] }),
  trades: many(backtestTrades),
}));

export const backtestTradesRelations = relations(backtestTrades, ({ one }) => ({
  result: one(backtestResults, { fields: [backtestTrades.backtestResultId], references: [backtestResults.id] }),
  symbol: one(tradingSymbols, { fields: [backtestTrades.symbolId], references: [tradingSymbols.id] }),
}));
