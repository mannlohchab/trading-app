// Builds every module from configuration. Shared by the API server (index.ts) and the standalone
// jobs worker (jobs-worker.ts).
import { config } from './config';
import { db } from './db/client';
import { clientIpResolver } from './http/client-ip';
import { createLogger } from './logger';
import { createAiModule, WORKERS_AI_MODELS, WorkersAiProvider } from './modules/ai';
import { createBacktestingModule } from './modules/backtesting';
import { verifySandboxIsolation } from './modules/backtesting/workers/backtest.worker-manager';
import { ConsoleSmsSender, createIdentityModule, type SmsSender } from './modules/identity';
import { binanceAdapters, createMarketModule } from './modules/market';
import { createPaperTradingModule } from './modules/paper-trading';
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
  const market = createMarketModule({ db, requireActiveUser: identity.requireActiveUser, exchanges: [binanceAdapters()] });
  const strategies = createStrategiesModule({
    db,
    requireActiveUser: identity.requireActiveUser,
    instruments: { isActive: (exchange, symbol) => market.service.isActiveInstrument(exchange, symbol) },
  });
  const ai = createAiModule({
    db,
    requireActiveUser: identity.requireActiveUser,
    providers: config.ai.cloudflare ? [new WorkersAiProvider(config.ai.cloudflare)] : [],
    models: WORKERS_AI_MODELS,
    defaultModelId: config.ai.defaultModel,
    fallbackModelIds: config.ai.fallbackModels,
    limits: config.ai.limits,
    market: market.service,
    strategies: strategies.service,
    profiles: profiles.service,
  });
  if (!config.ai.cloudflare) console.warn('[ai] CF_ACCOUNT_ID/CF_API_TOKEN not set: the AI assistant will answer 503 AI_NOT_CONFIGURED');
  const backtesting = createBacktestingModule({
    db,
    requireActiveUser: identity.requireActiveUser,
    market: market.service,
    strategies: strategies.service,
    sandbox: config.backtesting.sandbox,
  });
  const paperTrading = createPaperTradingModule({
    db,
    requireActiveUser: identity.requireActiveUser,
    market: { service: market.service, hub: market.hub },
    signals: backtesting.signals,
    queue: backtesting.queue,
  });
  return { identity, profiles, market, strategies, ai, backtesting, paperTrading };
}

/** Starts the job runner after proving the sandbox isolates. Returns a stop function. */
export async function startJobRunner(modules: ReturnType<typeof composeModules>, workerId: string) {
  const log = createLogger('jobs');
  const { backtesting } = modules;
  try {
    await backtesting.workers.prepare();
    const check = await verifySandboxIsolation(backtesting.workers, new URL('..', import.meta.url).pathname);
    if (!check.isolated) {
      log(config.isProduction ? 'error' : 'warn', 'Backtest sandbox is NOT isolated', { mode: config.backtesting.sandbox.mode, problems: check.problems });
      if (config.isProduction && config.backtesting.sandbox.mode === 'bwrap') throw new Error(`Backtest sandbox is not isolated: ${check.problems.join('; ')}`);
    } else {
      log('info', 'Backtest sandbox verified', { mode: config.backtesting.sandbox.mode });
    }
  } catch (error) {
    log('error', 'Backtest sandbox unavailable; backtest jobs will not run', { error: error instanceof Error ? error.message : String(error) });
    return async () => {};
  }
  const runner = new JobRunner({
    queue: backtesting.queue,
    handlers: [backtesting.jobHandler, modules.paperTrading.jobHandler],
    workerId,
    concurrency: config.backtesting.jobConcurrency,
    leaseMs: backtesting.leaseMs,
    log,
  });
  runner.start();
  if (config.paperTrading.engineEnabled) await modules.paperTrading.engine.start();
  return async () => {
    await modules.paperTrading.engine.stop();
    await runner.stop();
  };
}
