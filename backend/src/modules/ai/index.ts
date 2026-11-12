// AI assistant module: conversations, tool-using assistant turns, strategy drafts and usage tracking.
// Model providers are adapters behind ChatModelProvider; add one plus its ModelProfiles to support it.
import type { MiddlewareHandler } from 'hono';
import type { AppDatabase } from '../../db/types';
import type { Logger } from '../../logger';
import type { AuthVariables } from '../identity';
import type { MarketDataService } from '../market/application/market-data.service';
import type { ProfileService } from '../profiles/application/profile.service';
import type { StrategyService } from '../strategies';
import { AssistantService } from './application/assistant.service';
import { ConversationService } from './application/conversation.service';
import type { ChatModelProvider, Clock, ModelProfile, UsageRepository } from './application/ports';
import { createTools } from './application/tools';
import type { UsageLimits } from './domain/usage-policy';
import { aiRoutes } from './http/ai.routes';
import { DrizzleConversationRepository } from './infrastructure/drizzle-conversation.repository';
import { DrizzleUsageRepository } from './infrastructure/drizzle-usage.repository';
import { marketGateway, personaSource, strategyGateway } from './infrastructure/gateways';

export type { ChatModelProvider, ChatRequest, ChatStreamEvent, ModelProfile } from './application/ports';
export { AiProviderError } from './application/errors';
export { WORKERS_AI_MODELS } from './infrastructure/model-registry';
export { WorkersAiProvider } from './infrastructure/workers-ai.provider';

export function createAiModule(deps: {
  db: AppDatabase;
  requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }>;
  providers: ChatModelProvider[];
  models: ModelProfile[];
  defaultModelId: string;
  fallbackModelIds?: string[];
  limits: UsageLimits;
  market: MarketDataService;
  strategies: StrategyService;
  profiles: ProfileService;
  clock?: Clock;
  /** Structured events for observability (one `AI turn recorded` per stored usage event). */
  events?: Logger;
}) {
  const conversationsRepo = new DrizzleConversationRepository(deps.db);
  const strategies = strategyGateway(deps.strategies);
  const market = marketGateway(deps.market);
  const log = (message: string, error?: unknown) => console.warn(`[ai] ${message}`, error ?? '');
  const assistant = new AssistantService({
    providers: deps.providers,
    models: deps.models,
    defaultModelId: deps.defaultModelId,
    fallbackModelIds: deps.fallbackModelIds ?? [],
    conversations: conversationsRepo,
    usage: withUsageEvents(new DrizzleUsageRepository(deps.db), deps.events),
    persona: personaSource(deps.profiles),
    tools: () => createTools(market, strategies),
    limits: deps.limits,
    clock: deps.clock ?? { now: () => new Date() },
    log,
  });
  const conversations = new ConversationService({ conversations: conversationsRepo, strategies });
  return { assistant, conversations, routes: aiRoutes({ assistant, conversations, requireActiveUser: deps.requireActiveUser }) };
}

export type AiModule = ReturnType<typeof createAiModule>;

/** Emits one structured event per recorded turn (no user identifiers), after it is stored. */
function withUsageEvents(repo: UsageRepository, events?: Logger): UsageRepository {
  if (!events) return repo;
  return {
    totals: (userId, since) => repo.totals(userId, since),
    async record(event) {
      await repo.record(event);
      events('info', 'AI turn recorded', {
        provider: event.provider, model: event.model, status: event.status,
        inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens,
        toolCalls: event.toolCalls, latencyMs: event.latencyMs, errorCode: event.errorCode ?? null,
      });
    },
  };
}
