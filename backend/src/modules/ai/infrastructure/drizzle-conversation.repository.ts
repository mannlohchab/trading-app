import { and, asc, desc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { conversations, messages } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { Conversation, ConversationRepository, MessageMetadata, StoredMessage } from '../application/ports';

type MessageRow = typeof messages.$inferSelect;
const toMessage = (r: MessageRow): StoredMessage => ({
  id: r.id, conversationId: r.conversationId, role: r.role, content: r.content, metadata: r.metadata as MessageMetadata,
  modelProvider: r.modelProvider, modelName: r.modelName, tokenUsage: r.tokenUsage, createdAt: r.createdAt,
});
const toConversation = (r: typeof conversations.$inferSelect): Conversation => ({
  id: r.id, title: r.title, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt,
});

export class DrizzleConversationRepository implements ConversationRepository {
  constructor(private readonly db: AppDatabase) {}

  async create(userId: string, title: string | null) {
    const [row] = await this.db.insert(conversations).values({ userId, title }).returning();
    return toConversation(row!);
  }

  async find(userId: string, id: string) {
    const [row] = await this.db.select().from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId), ne(conversations.status, 'DELETED')));
    return row ? toConversation(row) : null;
  }

  async list(userId: string, { status, limit, before }: { status: 'ACTIVE' | 'ARCHIVED'; limit: number; before?: Date }) {
    const rows = await this.db.select().from(conversations)
      .where(and(eq(conversations.userId, userId), eq(conversations.status, status), before ? lt(conversations.updatedAt, before) : undefined))
      .orderBy(desc(conversations.updatedAt))
      .limit(limit);
    return rows.map(toConversation);
  }

  async update(userId: string, id: string, changes: { title?: string; status?: Conversation['status'] }) {
    const [row] = await this.db.update(conversations).set(changes)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId), ne(conversations.status, 'DELETED')))
      .returning();
    return row ? toConversation(row) : null;
  }

  async messages(conversationId: string, { limit, beforeId }: { limit: number; beforeId?: string }) {
    let cursor = undefined;
    if (beforeId) {
      const [anchor] = await this.db.select({ createdAt: messages.createdAt, id: messages.id }).from(messages)
        .where(and(eq(messages.id, beforeId), eq(messages.conversationId, conversationId)));
      if (!anchor) return [];
      // (created_at, id) keyset so equal timestamps page correctly.
      cursor = or(lt(messages.createdAt, anchor.createdAt), and(eq(messages.createdAt, anchor.createdAt), lt(messages.id, anchor.id)));
    }
    const rows = await this.db.select().from(messages)
      .where(and(eq(messages.conversationId, conversationId), cursor))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit);
    return rows.reverse().map(toMessage);
  }

  async history(conversationId: string, limit: number) {
    const rows = await this.db.select({ role: messages.role, content: messages.content }).from(messages)
      .where(and(eq(messages.conversationId, conversationId), inArray(messages.role, ['USER', 'ASSISTANT']), ne(messages.content, '')))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit);
    return rows.reverse() as { role: 'USER' | 'ASSISTANT'; content: string }[];
  }

  async addMessage(input: Parameters<ConversationRepository['addMessage']>[0]) {
    const [row] = await this.db.insert(messages).values({
      ...(input.id && { id: input.id }),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      metadata: (input.metadata ?? {}) as Record<string, unknown>,
      modelProvider: input.modelProvider,
      modelName: input.modelName,
      tokenUsage: input.tokenUsage,
    }).returning();
    return toMessage(row!);
  }

  async findMessage(userId: string, conversationId: string, messageId: string) {
    const [row] = await this.db.select({ m: messages }).from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId), eq(conversations.userId, userId), ne(conversations.status, 'DELETED')));
    return row ? toMessage(row.m) : null;
  }

  async updateMessageMetadata(messageId: string, metadata: MessageMetadata) {
    await this.db.update(messages).set({ metadata: metadata as Record<string, unknown> }).where(eq(messages.id, messageId));
  }

  async deleteMessage(messageId: string) {
    await this.db.delete(messages).where(eq(messages.id, messageId));
  }

  async touch(conversationId: string) {
    await this.db.update(conversations).set({ updatedAt: sql`now()` }).where(eq(conversations.id, conversationId));
  }
}
