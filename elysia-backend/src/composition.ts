// Builds every module from configuration. Shared by the API server (index.ts) and the standalone
// jobs worker (jobs-worker.ts).
import { config } from './config';
import { db } from './db/client';
import { clientIpResolver } from './http/client-ip';
import { createLogger } from './logger';
import { createAiModule, NEMOTRON_FREE_MODEL, WORKERS_AI_MODELS, OpenRouterChatProvider, WorkersAiProvider } from './modules/ai';
import { backtestGateway } from './modules/ai/infrastructure/gateways';
import { backtestResearchGateway } from './modules/ai/infrastructure/backtest-research.gateway';
import { createLiveTestingGateway } from './modules/ai/infrastructure/live-testing.gateway';
import { createBacktestingModule } from './modules/backtesting';
import { verifySandboxIsolation } from './modules/backtesting/workers/backtest.worker-manager';
import { ConsoleSmsSender, createIdentityModule, type SmsSender } from './modules/identity';
import { binanceAdapters, createMarketModule } from './modules/market';
import { createCommunityModule, marketInstrumentResolver } from './modules/community';
import { createCalendarModule } from './modules/calendar';
import { createNewsModule, newsSourcesFromConfig } from './modules/news';
import { createPaperTradingModule } from './modules/paper-trading';
import { createPortfolioModule, marketPriceSource } from './modules/portfolio';
import { createProfilesModule } from './modules/profiles';
import { createStrategiesModule } from './modules/strategies';
import { JobRunner } from './modules/system/jobs';

function smsSender(provider: string): SmsSender {
  if (provider === 'console') return new ConsoleSmsSender();
  throw new Error(`Unknown SMS_PROVIDER "${provider}"`);
}

export function composeModules() {
  const identity = createIdentityModule({
    db,
    config: config.auth,
    sms: smsSender(config.sms.provider),
    clientIp: clientIpResolver(config.http.trustedProxyIpHeader),
  });
  const profiles = createProfilesModule({ db, requireActiveUser: identity.requireActiveUser });
  const calendar = createCalendarModule({ requireActiveUser: identity.requireActiveUser });
  const market = createMarketModule({ db, requireActiveUser: identity.requireActiveUser, exchanges: [binanceAdapters()] });
  const strategies = createStrategiesModule({
    db,
    requireActiveUser: identity.requireActiveUser,
    instruments: { isActive: (exchange, symbol) => market.service.isActiveInstrument(exchange, symbol) },
  });
  const portfolio = createPortfolioModule({ db, requireActiveUser: identity.requireActiveUser, prices: marketPriceSource(market.service) });
  const backtesting = createBacktestingModule({
    db,
    requireActiveUser: identity.requireActiveUser,
    market: market.service,
    strategies: strategies.service,
    sandbox: config.backtesting.sandbox,
  });
  const news = createNewsModule({
    db,
    requireActiveUser: identity.requireActiveUser,
    sources: newsSourcesFromConfig(config.news.sources),
    retentionDays: config.news.retentionDays,
    log: createLogger('news'),
  });
  const md = config.ai.morningDecode;
  const paperTrading = createPaperTradingModule({
    db,
    requireActiveUser: identity.requireActiveUser,
    market: { service: market.service, hub: market.hub },
    signals: backtesting.signals,
    queue: backtesting.queue,
  });
  const ai = createAiModule({
    db,
    requireActiveUser: identity.requireActiveUser,
    providers: [
      ...(config.ai.openRouter ? [new OpenRouterChatProvider(config.ai.openRouter)] : []),
      ...(config.ai.cloudflare ? [new WorkersAiProvider(config.ai.cloudflare)] : []),
    ],
    models: [
      ...(config.ai.openRouter ? [NEMOTRON_FREE_MODEL] : []),
      ...WORKERS_AI_MODELS,
    ],
    defaultModelId: config.ai.defaultModel,
    fallbackModelIds: config.ai.fallbackModels,
    limits: config.ai.limits,
    events: createLogger('ai'),
    market: market.service,
    strategies: strategies.service,
    profiles: profiles.service,
    portfolio: portfolio.service,
    research: backtestResearchGateway({ backtests: backtesting.service, experiments: backtesting.experiments, strategies: strategies.service }),
    liveTesting: createLiveTestingGateway({ paper: paperTrading.services, strategies: strategies.service }),
    backtest: backtestGateway(backtesting.service),
    morningDecode: md,
    webResearch: config.ai.webResearch,
    newsHeadlines: {
      latest: async (limit) => {
        const page = await news.service.list({ limit });
        return page.articles.map(a => ({ title: a.title, publisher: a.publisher.name, assets: a.assets }));
      },
    },
  });
  if (!config.ai.openRouter && !config.ai.cloudflare) console.warn('[ai] No chat model configured: set OPENROUTER_API_KEY or CF_ACCOUNT_ID/CF_API_TOKEN');
  else if (config.ai.openRouter) console.log('[ai] default chat model is free Nemotron when AI_DEFAULT_MODEL is nemotron-free');
  if (md.scriptProvider === 'gemini' && !md.gemini) console.warn('[ai] GEMINI_API_KEY not set: Morning Decode will use the factual fallback script');
  if (md.scriptProvider === 'openrouter' && !md.openRouter) console.warn('[ai] OPENROUTER_API_KEY not set: Morning Decode script provider openrouter is unavailable');
  if (config.ai.webResearch) {
    console.log(`[ai] web research enabled: ${config.ai.webResearch.model} via ${config.ai.webResearch.firecrawlBaseUrl}`);
  } else if (process.env.FIRECRAWL_API_URL?.trim()) {
    console.warn('[ai] FIRECRAWL_API_URL is set but web research is off: OPENROUTER_API_KEY is required, and RESEARCH_MODEL must be a free Nemotron id');
  }
  if (!md.openRouter) console.warn('[ai] OPENROUTER_API_KEY not set: Morning Decode audio (TTS) will be unavailable');

  const community = createCommunityModule({
    db,
    requireActiveUser: identity.requireActiveUser,
    instruments: marketInstrumentResolver(market.service),
    publicBaseUrl: config.auth.baseUrl,
  });
  return { identity, profiles, market, strategies, ai, backtesting, paperTrading, news, community, portfolio, calendar };
}

/** Starts the job runner after proving the sandbox isolates. Returns a stop function. */
export async function startJobRunner(modules: ReturnType<typeof composeModules>, workerId: string) {
  const log = createLogger('jobs');
  const { backtesting } = modules;
  // Without a sandbox, backtest jobs are not run, but paper trading (resting orders, liquidations) still is.
  let sandboxReady = false;
  try {
    await backtesting.workers.prepare();
    const check = await verifySandboxIsolation(backtesting.workers, new URL('..', import.meta.url).pathname);
    if (!check.isolated) {
      log(config.isProduction ? 'error' : 'warn', 'Backtest sandbox is NOT isolated', { mode: config.backtesting.sandbox.mode, problems: check.problems });
      if (config.isProduction && config.backtesting.sandbox.mode === 'bwrap') throw new Error(`Backtest sandbox is not isolated: ${check.problems.join('; ')}`);
    } else {
      log('info', 'Backtest sandbox verified', { mode: config.backtesting.sandbox.mode });
    }
    sandboxReady = true;
  } catch (error) {
    log('error', 'Backtest sandbox unavailable; backtest jobs will not run (paper trading continues)', { error: error instanceof Error ? error.message : String(error) });
  }
  const runner = new JobRunner({
    queue: backtesting.queue,
    handlers: [...(sandboxReady ? [backtesting.jobHandler, backtesting.experimentJobHandler] : []), modules.paperTrading.jobHandler, modules.news.jobHandler],
    workerId,
    concurrency: config.backtesting.jobConcurrency,
    leaseMs: backtesting.leaseMs,
    log,
  });
  runner.start();
  if (config.paperTrading.engineEnabled) await modules.paperTrading.engine.start();
  await modules.news.startScheduling();
  await modules.ai.startScheduling();
  return async () => {
    modules.ai.stop();
    modules.news.stop();
    await modules.paperTrading.engine.stop();
    await runner.stop();
    await backtesting.portfolio.dispose();
  };
}
