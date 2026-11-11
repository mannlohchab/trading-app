// Ports for the AI module. Model providers, storage and other modules sit behind these.
import type { ResponseBlock } from '../domain/blocks';
import type { HistoryMessage } from '../domain/conversation';
import type { AiPersona } from '../domain/prompt';
import type { UsageToday } from '../domain/usage-policy';

// ---------------------------------------------------------------------------
// Model providers (Workers AI today; others later)
// ---------------------------------------------------------------------------

export type ToolCall = { id: string; name: string; arguments: string };

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

export type ModelUsage = { inputTokens: number; outputTokens: number; costUnits?: number; costUnit?: string };

export type ChatStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'done'; finishReason: 'stop' | 'length' | 'tool_calls' | 'other'; usage: ModelUsage };

export type ChatRequest = {
  /** Provider-specific model id, e.g. "@cf/meta/llama-4-scout-17b-16e-instruct". */
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxOutputTokens: number;
  temperature?: number;
  /** For reasoning models: how much hidden thinking to do before answering. */
  reasoningEffort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
};

export interface ChatModelProvider {
  /** e.g. "workers-ai". */
  readonly name: string;
  /** Streams one model response. Throws AiProviderError for expected failures. */
  stream(request: ChatRequest): AsyncIterable<ChatStreamEvent>;
}

/** A model the app can use: which provider serves it and what it can do. */
export type ModelProfile = {
  /** Stable id used by the API and stored on messages, e.g. "llama-4-scout". */
  id: string;
  provider: string;
  providerModel: string;
  label: string;
  supportsTools: boolean;
  contextWindow: number;
  /** For reasoning models this budget also covers their hidden thinking. */
  maxOutputTokens: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export type ConversationStatus = 'ACTIVE' | 'ARCHIVED' | 'DELETED';
export type Conversation = { id: string; title: string | null; status: ConversationStatus; createdAt: Date; updatedAt: Date };

export type MessageMetadata = {
  blocks?: ResponseBlock[];
  toolCalls?: { name: string; arguments: unknown; ok: boolean; durationMs: number; error?: string }[];
  finishReason?: string;
  rounds?: number;
  interrupted?: boolean;
  /** The model wrote code or a raw definition, which was removed before the user saw it. */
  codeRemoved?: boolean;
  modelId?: string;
};
export type StoredMessage = {
  id: string;
  conversationId: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  metadata: MessageMetadata;
  modelProvider: string | null;
  modelName: string | null;
  tokenUsage: Record<string, unknown> | null;
  createdAt: Date;
};

export interface ConversationRepository {
  create(userId: string, title: string | null): Promise<Conversation>;
  /** Null when missing, deleted or owned by someone else. */
  find(userId: string, conversationId: string): Promise<Conversation | null>;
  list(userId: string, options: { status: 'ACTIVE' | 'ARCHIVED'; limit: number; before?: Date }): Promise<Conversation[]>;
  update(userId: string, conversationId: string, changes: { title?: string; status?: ConversationStatus }): Promise<Conversation | null>;
  /** Oldest first. `before` pages backwards from a message id. */
  messages(conversationId: string, options: { limit: number; beforeId?: string }): Promise<StoredMessage[]>;
  history(conversationId: string, limit: number): Promise<HistoryMessage[]>;
  addMessage(input: { id?: string; conversationId: string; role: StoredMessage['role']; content: string; metadata?: MessageMetadata; modelProvider?: string; modelName?: string; tokenUsage?: Record<string, unknown> }): Promise<StoredMessage>;
  findMessage(userId: string, conversationId: string, messageId: string): Promise<StoredMessage | null>;
  updateMessageMetadata(messageId: string, metadata: MessageMetadata): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
  /** Bumps updated_at so the conversation sorts as recent. */
  touch(conversationId: string): Promise<void>;
}

export type UsageEvent = {
  userId: string;
  conversationId: string | null;
  turnId: string;
  provider: string;
  model: string;
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  usage: ModelUsage;
  toolCalls: number;
  latencyMs: number;
  errorCode?: string;
};

export interface UsageRepository {
  record(event: UsageEvent): Promise<void>;
  /** Turns (distinct turn ids) and tokens since `since`. */
  totals(userId: string, since: Date): Promise<UsageToday & { costUnits: number }>;
}

// ---------------------------------------------------------------------------
// Other modules
// ---------------------------------------------------------------------------

export interface PersonaSource {
  forUser(userId: string): Promise<AiPersona>;
}

export interface Clock {
  now(): Date;
}

export type { ResponseBlock };
