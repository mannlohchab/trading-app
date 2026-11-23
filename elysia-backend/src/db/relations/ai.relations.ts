import { relations } from 'drizzle-orm';
import { aiUsageEvents, conversations, messages } from '../schema/ai';
import { users } from '../schema/identity';

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, { fields: [conversations.userId], references: [users.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }),
}));

export const aiUsageEventsRelations = relations(aiUsageEvents, ({ one }) => ({
  user: one(users, { fields: [aiUsageEvents.userId], references: [users.id] }),
  conversation: one(conversations, { fields: [aiUsageEvents.conversationId], references: [conversations.id] }),
}));
