// Users plus the tables that hang directly off a user: auth, sessions, verification, profile data.
import { relations } from 'drizzle-orm';
import { conversations } from '../schema/ai';
import { backtestJobs } from '../schema/backtesting';
import { authAccounts, userSessions, users } from '../schema/identity';
import { exchanges, tradingSymbols } from '../schema/market';
import { paperAccounts } from '../schema/paper-trading';
import { userConsents, userPreferences, userProfiles } from '../schema/profiles';
import { strategies } from '../schema/strategies';
import { phoneVerifications } from '../schema/verification';

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(userProfiles),
  preferences: one(userPreferences),
  authAccounts: many(authAccounts),
  sessions: many(userSessions),
  phoneVerifications: many(phoneVerifications),
  consents: many(userConsents),
  conversations: many(conversations),
  strategies: many(strategies),
  backtestJobs: many(backtestJobs),
  paperAccounts: many(paperAccounts),
}));

export const authAccountsRelations = relations(authAccounts, ({ one }) => ({
  user: one(users, { fields: [authAccounts.userId], references: [users.id] }),
}));

export const userSessionsRelations = relations(userSessions, ({ one }) => ({
  user: one(users, { fields: [userSessions.userId], references: [users.id] }),
}));

export const phoneVerificationsRelations = relations(phoneVerifications, ({ one }) => ({
  user: one(users, { fields: [phoneVerifications.userId], references: [users.id] }),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, { fields: [userProfiles.userId], references: [users.id] }),
}));

export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
  user: one(users, { fields: [userPreferences.userId], references: [users.id] }),
  defaultExchange: one(exchanges, { fields: [userPreferences.defaultExchangeId], references: [exchanges.id] }),
  defaultTradingSymbol: one(tradingSymbols, { fields: [userPreferences.defaultTradingSymbolId], references: [tradingSymbols.id] }),
}));

export const userConsentsRelations = relations(userConsents, ({ one }) => ({
  user: one(users, { fields: [userConsents.userId], references: [users.id] }),
}));
