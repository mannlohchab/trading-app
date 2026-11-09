import { relations } from 'drizzle-orm';
import { users } from '../schema/identity';
import { tradingSymbols } from '../schema/market';
import { paperAccounts, paperOrders, paperPositions, paperTransactions } from '../schema/paper-trading';
import { strategyVersions } from '../schema/strategies';

export const paperAccountsRelations = relations(paperAccounts, ({ one, many }) => ({
  user: one(users, { fields: [paperAccounts.userId], references: [users.id] }),
  orders: many(paperOrders),
  positions: many(paperPositions),
  transactions: many(paperTransactions),
}));

export const paperOrdersRelations = relations(paperOrders, ({ one, many }) => ({
  account: one(paperAccounts, { fields: [paperOrders.paperAccountId], references: [paperAccounts.id] }),
  symbol: one(tradingSymbols, { fields: [paperOrders.symbolId], references: [tradingSymbols.id] }),
  strategyVersion: one(strategyVersions, { fields: [paperOrders.strategyVersionId], references: [strategyVersions.id] }),
  transactions: many(paperTransactions),
}));

export const paperPositionsRelations = relations(paperPositions, ({ one }) => ({
  account: one(paperAccounts, { fields: [paperPositions.paperAccountId], references: [paperAccounts.id] }),
  symbol: one(tradingSymbols, { fields: [paperPositions.symbolId], references: [tradingSymbols.id] }),
}));

export const paperTransactionsRelations = relations(paperTransactions, ({ one }) => ({
  account: one(paperAccounts, { fields: [paperTransactions.paperAccountId], references: [paperAccounts.id] }),
  order: one(paperOrders, { fields: [paperTransactions.orderId], references: [paperOrders.id] }),
}));
