import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { httpMetrics } from './http/metrics-middleware';
import type { AiModule } from './modules/ai';
import type { BacktestingModule } from './modules/backtesting';
import type { CommunityModule } from './modules/community';
import type { IdentityModule } from './modules/identity';
import type { MarketModule } from './modules/market';
import type { NewsModule } from './modules/news';
import type { PaperTradingModule } from './modules/paper-trading';
import type { ProfilesModule } from './modules/profiles';
import type { StrategiesModule } from './modules/strategies';

export type AppDeps = {
  /** Allowed CORS origins, or "*" to echo any origin (development). */
  clientOrigin: '*' | string[];
  pingDatabase: () => Promise<boolean>;
  identity: IdentityModule;
  profiles: ProfilesModule;
  market: MarketModule;
  strategies: StrategiesModule;
  ai: AiModule;
  backtesting: BacktestingModule;
  paperTrading: PaperTradingModule;
  news: NewsModule;
  community: CommunityModule;
  /** Optional Prometheus HTTP metrics (count and latency per route pattern). */
  metrics?: { recordHttp: (method: string, route: string, status: number, seconds: number) => void };
};

/** Builds the HTTP app from its modules. No I/O happens here; see ./index.ts for production wiring. */
export function createApp({ clientOrigin, pingDatabase, identity, profiles, market, strategies, ai, backtesting, paperTrading, news, community, metrics }: AppDeps) {
  const app = new Hono();

  if (metrics) app.use(httpMetrics(metrics.recordHttp));

  app.use(requestId());
  app.use(logger());
  app.use(secureHeaders());
  // Browsers reject "*" with credentials, so in open mode echo back the caller's origin.
  app.use(cors({
    origin: clientOrigin === '*' ? origin => origin : clientOrigin,
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'expo-origin', 'Idempotency-Key'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['set-auth-token'],
  }));

  // Liveness: the process is up. Readiness: it can also reach Postgres.
  app.get('/health', c => c.json({ ok: true, service: 'trading-backend' }));
  app.get('/health/ready', async c => {
    const database = await pingDatabase();
    return c.json({ ok: database, database: database ? 'up' : 'down' }, database ? 200 : 503);
  });

  app.route('/', identity.routes);
  app.route('/', profiles.routes);
  app.route('/', market.routes);
  app.route('/', strategies.routes);
  app.route('/', ai.routes);
  app.route('/', backtesting.routes);
  app.route('/', paperTrading.routes);
  app.route('/', news.routes);
  app.route('/', community.routes);

  app.notFound(c => c.json({ error: 'Not found' }, 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(`[${c.get('requestId')}]`, err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
