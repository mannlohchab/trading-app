import { relations } from 'drizzle-orm';
import { backtestJobs } from '../schema/backtesting';
import { users } from '../schema/identity';
import { paperOrders } from '../schema/paper-trading';
import { strategies, strategyVersions } from '../schema/strategies';

export const strategiesRelations = relations(strategies, ({ one, many }) => ({
  user: one(users, { fields: [strategies.userId], references: [users.id] }),
  versions: many(strategyVersions),
}));

export const strategyVersionsRelations = relations(strategyVersions, ({ one, many }) => ({
  strategy: one(strategies, { fields: [strategyVersions.strategyId], references: [strategies.id] }),
  backtestJobs: many(backtestJobs),
  paperOrders: many(paperOrders),
}));
