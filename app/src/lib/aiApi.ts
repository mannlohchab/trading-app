// AI assistant conversations on the backend (`/api/v1/ai`). The demo preview keeps its local assistant.
import type { AiKind } from './aiChat';
import { api } from './api';
import { DEMO_MODE } from './demoMode';

export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; status?: 'streaming' | 'stopped' | 'error' };
export type ConversationSummary = { id: string; title: string; kind: AiKind; updatedAt: string };

type BackendConversation = { id: string; title: string | null; status: string; updatedAt: string };
type BackendMessage = { id: string; role: 'USER' | 'ASSISTANT' | 'SYSTEM'; content: string };

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
    .map(m => ({ id: m.id, role: m.role === 'USER' ? 'user' : 'assistant', content: m.content }));
}

/** The assistant has market tools but no access to the paper portfolio, so "Market" mode names the pair in the prompt. */
export function promptFor(kind: AiKind, text: string, symbol: string) {
  return kind === 'analysis' && symbol.trim() ? `About ${symbol.trim().toUpperCase()} on Binance: ${text}` : text;
}
