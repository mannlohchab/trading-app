// AI assistant module: conversations, tool-using assistant turns, strategy drafts and usage tracking.
// Model providers are adapters behind ChatModelProvider; add one plus its ModelProfiles to support it.
import type { AppDatabase } from '../../db/types';
import type { Logger } from '../../logger';
import type { UserGuard } from '../identity';
import type { MarketDataService } from '../market/application/market-data.service';
import type { ProfileService } from '../profiles/application/profile.service';
import type { StrategyService } from '../strategies';
import { AssistantService } from './application/assistant.service';
import { ConversationService } from './application/conversation.service';
import { MorningDecodeService, type NewsHeadline } from './application/morning-decode.service';
import type { ChatModelProvider, Clock, ModelProfile, UsageRepository } from './application/ports';
import { createTools, type BacktestGateway, type PortfolioGateway } from './application/tools';
import type { BacktestResearchGateway } from './infrastructure/backtest-research.gateway';
import type { LiveTestingGateway } from './infrastructure/live-testing.gateway';
import type { UsageLimits } from './domain/usage-policy';
import { aiRoutes } from './http/ai.routes';
import { DrizzleConversationRepository } from './infrastructure/drizzle-conversation.repository';
import { DrizzleUsageRepository } from './infrastructure/drizzle-usage.repository';
import { GeminiScriptLlm } from './infrastructure/gemini-script';
import { marketGateway, personaSource, strategyGateway } from './infrastructure/gateways';
import { OpenRouterResearchModel } from './infrastructure/openrouter-research';
import { OpenRouterScriptLlm } from './infrastructure/openrouter-script';
import { OpenRouterTts } from './infrastructure/openrouter-tts';
import { FirecrawlClient } from './infrastructure/firecrawl-client';
import { WebResearchAgent } from './application/web-research-agent';
import { MimoResearchModel, MimoScriptLlm } from './infrastructure/mimo';
import { userSnapshotSource } from './infrastructure/user-snapshot';
import { DrizzleMemoryRepository } from './infrastructure/drizzle-memory.repository';
import { createMemoryTools } from './application/memory-tools';

export type { ChatModelProvider, ChatRequest, ChatStreamEvent, ModelProfile } from './application/ports';
export { AiProviderError } from './application/errors';
export { MIMO_DEFAULT_MODEL, MIMO_FALLBACK_MODELS, MIMO_MODELS, NEMOTRON_FREE_MODEL, WORKERS_AI_MODELS } from './infrastructure/model-registry';
export { MIMO_DEFAULT_BASE_URL, MimoChatProvider, MimoResearchModel, MimoScriptLlm } from './infrastructure/mimo';
export { OpenRouterChatProvider } from './infrastructure/openrouter-chat';
export { WorkersAiProvider } from './infrastructure/workers-ai.provider';

export type MorningDecodeConfig = {
  scriptProvider: 'mimo' | 'gemini' | 'openrouter';
  mimo?: { apiKey: string; baseUrl?: string; model: string };
  gemini?: { apiKey: string; model: string };
  openRouter?: { apiKey: string; scriptModel: string; ttsModel: string; voice: string };
};

export function createAiModule(deps: {
  db: AppDatabase;
  requireActiveUser: UserGuard;
  providers: ChatModelProvider[];
  models: ModelProfile[];
  defaultModelId: string;
  fallbackModelIds?: string[];
  limits: UsageLimits;
  market: MarketDataService;
  strategies: StrategyService;
  profiles: ProfileService;
  /** The user's real holdings; without it the assistant has no portfolio tool. */
  portfolio?: PortfolioGateway;
  /** Sandboxed strategy backtests; without it the assistant cannot run_backtest. */
  backtest?: BacktestGateway;
  research?: BacktestResearchGateway;
  liveTesting?: LiveTestingGateway;
  /** Morning Decode script + TTS providers (Gemini / OpenRouter). */
  morningDecode?: MorningDecodeConfig;
  /**
   * Web research sub-agent: MiMo when configured, otherwise free Nemotron on OpenRouter (whose id
   * must already be a `:free` Nemotron id). Firecrawl is the self-hosted crawler; it gets no LLM key.
   */
  webResearch?: {
    model:
      | { provider: 'mimo'; apiKey: string; baseUrl?: string; model: string }
      | { provider: 'openrouter'; apiKey: string; baseUrl?: string; model: string };
    firecrawlBaseUrl: string;
    firecrawlApiKey?: string;
  };
  /** Optional headlines for the shared daily briefing. */
  newsHeadlines?: { latest(limit: number): Promise<NewsHeadline[]> };
  clock?: Clock;
  /** Structured events for observability (one `AI turn recorded` per stored usage event). */
  events?: Logger;
}) {
  const conversationsRepo = new DrizzleConversationRepository(deps.db);
  const memories = new DrizzleMemoryRepository(deps.db);
  const strategies = strategyGateway(deps.strategies);
  const market = marketGateway(deps.market);
  const log = (message: string, error?: unknown) => console.warn(`[ai] ${message}`, error ?? '');
  const clock = deps.clock ?? { now: () => new Date() };
  const webResearch = deps.webResearch
    ? new WebResearchAgent({
      model: deps.webResearch.model.provider === 'mimo'
        ? new MimoResearchModel({ apiKey: deps.webResearch.model.apiKey, model: deps.webResearch.model.model, ...(deps.webResearch.model.baseUrl && { baseUrl: deps.webResearch.model.baseUrl }) })
        : new OpenRouterResearchModel({ apiKey: deps.webResearch.model.apiKey, model: deps.webResearch.model.model, ...(deps.webResearch.model.baseUrl && { baseUrl: deps.webResearch.model.baseUrl }) }),
      crawler: new FirecrawlClient({
        baseUrl: deps.webResearch.firecrawlBaseUrl,
        ...(deps.webResearch.firecrawlApiKey && { apiKey: deps.webResearch.firecrawlApiKey }),
      }),
    })
    : undefined;
  const assistant = new AssistantService({
    providers: deps.providers,
    models: deps.models,
    defaultModelId: deps.defaultModelId,
    fallbackModelIds: deps.fallbackModelIds ?? [],
    conversations: conversationsRepo,
    usage: withUsageEvents(new DrizzleUsageRepository(deps.db), deps.events),
    persona: personaSource(deps.profiles),
    snapshot: userSnapshotSource({
      strategies: deps.strategies,
      backtests: deps.research,
      liveTests: deps.liveTesting,
      holdings: deps.portfolio,
      memories,
      log,
    }),
    tools: userId => [
      ...createTools(
        market,
        strategies,
        deps.portfolio && { gateway: deps.portfolio, userId },
        deps.backtest && { gateway: deps.backtest, userId },
        deps.research && { gateway: deps.research, userId },
        deps.liveTesting && { gateway: deps.liveTesting, userId },
        webResearch,
      ),
      ...createMemoryTools(memories, userId),
    ],
    limits: deps.limits,
    clock,
    webResearch: !!webResearch,
    log,
  });
  const conversations = new ConversationService({ conversations: conversationsRepo, strategies });

  const md = deps.morningDecode;
  const script = md?.scriptProvider === 'mimo' && md.mimo
    ? new MimoScriptLlm({ apiKey: md.mimo.apiKey, model: md.mimo.model, ...(md.mimo.baseUrl && { baseUrl: md.mimo.baseUrl }) })
    : md?.scriptProvider === 'openrouter' && md.openRouter
    ? new OpenRouterScriptLlm({ apiKey: md.openRouter.apiKey, model: md.openRouter.scriptModel })
    : md?.gemini
      ? new GeminiScriptLlm({ apiKey: md.gemini.apiKey, model: md.gemini.model })
      : md?.openRouter
        ? new OpenRouterScriptLlm({ apiKey: md.openRouter.apiKey, model: md.openRouter.scriptModel })
        : undefined;
  const tts = md?.openRouter
    ? new OpenRouterTts({ apiKey: md.openRouter.apiKey, model: md.openRouter.ttsModel, voice: md.openRouter.voice })
    : undefined;

  const morningDecode = new MorningDecodeService({
    db: deps.db,
    market: deps.market,
    script,
    tts,
    news: deps.newsHeadlines,
    clock,
  });

  /** Pre-publish once per UTC day in the jobs process so Home rarely waits on first open. */
  let warmTimer: ReturnType<typeof setInterval> | undefined;
  const warmMorningDecode = () =>
    morningDecode.today().catch(error =>
      console.warn('[ai] morning decode warm failed', error instanceof Error ? error.message : error),
    );

  return {
    assistant,
    conversations,
    memories,
    morningDecode,
    /** @deprecated alias */
    dailyBrief: morningDecode,
    routes: aiRoutes({ assistant, conversations, morningDecode, memories, requireActiveUser: deps.requireActiveUser }),
    async startScheduling(everyMs = 30 * 60_000) {
      await warmMorningDecode();
      warmTimer = setInterval(() => void warmMorningDecode(), everyMs);
    },
    stop() {
      clearInterval(warmTimer);
    },
  };
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
