// AI assistant conversations on the backend (`/api/v1/ai`). The demo preview keeps its local assistant.
import type { AiKind } from './aiChat';
import { parseAiBlocks, type AiParsedBlocks } from './aiBlocks';
import { stepsFromToolCalls, type ToolStep } from './aiTrace';
import { api } from './api';
import { DEMO_MODE } from './demoMode';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'streaming' | 'stopped' | 'error';
  blocks?: AiParsedBlocks;
  steps?: ToolStep[];
};
export type ConversationSummary = { id: string; title: string; kind: AiKind; updatedAt: string };

type BackendConversation = { id: string; title: string | null; status: string; updatedAt: string };
type BackendMessage = { id: string; role: 'USER' | 'ASSISTANT' | 'SYSTEM'; content: string; metadata?: { blocks?: unknown; toolCalls?: unknown } };

const summary = (c: BackendConversation): ConversationSummary => ({ id: c.id, title: c.title || 'New conversation', kind: 'chat', updatedAt: c.updatedAt });

export async function listConversations(signal?: AbortSignal): Promise<{ conversations: ConversationSummary[] }> {
  if (DEMO_MODE) return api('/api/ai/conversations', { signal });
  const { conversations } = await api<{ conversations: BackendConversation[] }>('/api/v1/ai/conversations?limit=50', { signal });
  return { conversations: conversations.map(summary) };
}

export async function createConversation(title: string): Promise<ConversationSummary> {
  return summary(await api<BackendConversation>('/api/v1/ai/conversations', { method: 'POST', body: { title: title.slice(0, 200) } }));
}

export async function deleteConversation(id: string) {
  if (DEMO_MODE) return api(`/api/ai/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return api(`/api/v1/ai/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function conversationMessages(id: string, signal?: AbortSignal): Promise<ChatMessage[]> {
  if (DEMO_MODE) {
    const result = await api<{ messages: ChatMessage[] }>(`/api/ai/conversations/${encodeURIComponent(id)}`, { signal });
    return result.messages.filter(m => m.role === 'user' || m.role === 'assistant');
  }
  const { messages } = await api<{ messages: BackendMessage[] }>(`/api/v1/ai/conversations/${encodeURIComponent(id)}/messages?limit=100`, { signal });
  return messages
    .filter(m => m.role === 'USER' || m.role === 'ASSISTANT')
    .map(m => m.role === 'USER'
      ? { id: m.id, role: 'user' as const, content: m.content }
      : { id: m.id, role: 'assistant' as const, content: m.content, blocks: parseAiBlocks(m.metadata?.blocks), steps: stepsFromToolCalls(m.metadata?.toolCalls, m.id) });
}

/** A fact the assistant saved about the user (it can be deleted at any time). */
export type AiMemory = { id: string; content: string; createdAt: string };

export async function listAiMemories(signal?: AbortSignal): Promise<AiMemory[]> {
  return (await api<{ memories: AiMemory[] }>('/api/v1/ai/memories', { signal })).memories;
}
export async function deleteAiMemory(id: string) {
  await api(`/api/v1/ai/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export async function deleteAllAiMemories() {
  await api('/api/v1/ai/memories', { method: 'DELETE' });
}

/** Screens the backend accepts as "opened from" (elysia-backend/src/modules/ai/domain/turn-context.ts). */
export type AiOrigin =
  | 'home' | 'markets' | 'market' | 'instrument' | 'stock' | 'ai' | 'portfolio_holdings'
  | 'backtests' | 'backtest_result' | 'research' | 'live_test' | 'community' | 'news' | 'calendar' | 'profile';

export type AiTurnContext = { mode: AiKind; symbol?: string; exchange?: string; from?: AiOrigin };

const ORIGINS: readonly string[] = ['home', 'markets', 'market', 'instrument', 'stock', 'ai', 'portfolio_holdings', 'backtests', 'backtest_result', 'research', 'live_test', 'community', 'news', 'calendar', 'profile'];
export const asAiOrigin = (value: unknown): AiOrigin | undefined => (typeof value === 'string' && ORIGINS.includes(value) ? value as AiOrigin : undefined);

/** Where the user is, sent with each message so the assistant can resolve "this pair" and suggest next steps. */
export function turnContextFor(kind: AiKind, symbol: string, from?: AiOrigin): AiTurnContext {
  const pair = symbol.trim().toUpperCase();
  return {
    mode: kind,
    ...(kind === 'analysis' && pair && { symbol: pair, ...(!pair.includes('/') && { exchange: 'BINANCE' }) }),
    ...(from && { from }),
  };
}
