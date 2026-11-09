// AI assistant module: conversations, tool-using assistant turns, strategy drafts and usage tracking.
// Model providers are adapters behind ChatModelProvider; add one plus its ModelProfiles to support it.
import type { MiddlewareHandler } from 'hono';
import type { AppDatabase } from '../../db/types';
import type { AuthVariables } from '../identity';
import type { MarketDataService } from '../market/application/market-data.service';
import type { ProfileService } from '../profiles/application/profile.service';
import type { StrategyService } from '../strategies';
import { AssistantService } from './application/assistant.service';
import { ConversationService } from './application/conversation.service';
import type { ChatModelProvider, Clock, ModelProfile } from './application/ports';
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
    usage: new DrizzleUsageRepository(deps.db),
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
