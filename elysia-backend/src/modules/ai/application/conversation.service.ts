import type { StrategyDraftBlock } from '../domain/blocks';
import { CONVERSATION_LIMITS } from '../domain/conversation';
import type { ConversationRepository, ConversationStatus } from './ports';

/** Saves an AI strategy draft as a real strategy (implemented by the strategies module). */
export interface StrategySaver {
  save(userId: string, draft: Record<string, unknown>, origin: { conversationId: string; messageId: string; draftId: string }): Promise<{ ok: true; strategyId: string } | { ok: false; errors: Record<string, string> }>;
}

export type SaveDraftResult =
  | { ok: true; strategyId: string; alreadySaved: boolean }
  | { ok: false; error: 'NOT_FOUND' | 'DRAFT_NOT_FOUND' | 'INVALID_DRAFT'; errors?: Record<string, string> };

export class ConversationService {
  constructor(private readonly deps: { conversations: ConversationRepository; strategies: StrategySaver }) {}

  create(userId: string, title?: string) {
    return this.deps.conversations.create(userId, title?.trim().slice(0, CONVERSATION_LIMITS.titleMaxChars) || null);
  }
  list(userId: string, options: { status?: 'ACTIVE' | 'ARCHIVED'; limit?: number; before?: Date }) {
    return this.deps.conversations.list(userId, { status: options.status ?? 'ACTIVE', limit: Math.min(100, Math.max(1, options.limit ?? 30)), before: options.before });
  }
  get(userId: string, conversationId: string) {
    return this.deps.conversations.find(userId, conversationId);
  }
  update(userId: string, conversationId: string, changes: { title?: string; status?: Exclude<ConversationStatus, 'DELETED'> }) {
    return this.deps.conversations.update(userId, conversationId, { ...changes, ...(changes.title !== undefined && { title: changes.title.trim().slice(0, CONVERSATION_LIMITS.titleMaxChars) }) });
  }
  /** Soft delete: hidden everywhere, purged with the account. */
  async remove(userId: string, conversationId: string) {
    return !!(await this.deps.conversations.update(userId, conversationId, { status: 'DELETED' }));
  }
  async messages(userId: string, conversationId: string, options: { limit?: number; beforeId?: string }) {
    if (!(await this.deps.conversations.find(userId, conversationId))) return null;
    return this.deps.conversations.messages(conversationId, { limit: Math.min(100, Math.max(1, options.limit ?? 50)), beforeId: options.beforeId });
  }

  /** Saves a strategy draft from an assistant message. Idempotent per draft. */
  async saveDraft(userId: string, conversationId: string, messageId: string, draftId: string): Promise<SaveDraftResult> {
    const message = await this.deps.conversations.findMessage(userId, conversationId, messageId);
    if (!message || message.role !== 'ASSISTANT') return { ok: false, error: 'NOT_FOUND' };
    const blocks = message.metadata.blocks ?? [];
    const block = blocks.find((b): b is StrategyDraftBlock => b.type === 'strategy_draft' && b.draftId === draftId);
    if (!block) return { ok: false, error: 'DRAFT_NOT_FOUND' };
    if (block.savedStrategyId) return { ok: true, strategyId: block.savedStrategyId, alreadySaved: true };

    // The draft comes from our stored message, not from the client, so it can't be tampered with.
    const saved = await this.deps.strategies.save(userId, block.draft, { conversationId, messageId, draftId });
    if (!saved.ok) return { ok: false, error: 'INVALID_DRAFT', errors: saved.errors };
    block.savedStrategyId = saved.strategyId;
    await this.deps.conversations.updateMessageMetadata(message.id, { ...message.metadata, blocks });
    return { ok: true, strategyId: saved.strategyId, alreadySaved: false };
  }
}
