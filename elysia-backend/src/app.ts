import { Elysia, type Context } from 'elysia';
import { WS_LIMITS } from './modules/market/http/market.routes';
import { HttpError } from './http/errors';
import { httpMetrics } from './http/metrics-middleware';
import type { AiModule } from './modules/ai';
import type { BacktestingModule } from './modules/backtesting';
import type { CommunityModule } from './modules/community';
import type { CalendarModule } from './modules/calendar';
import type { IdentityModule } from './modules/identity';
import type { MarketModule } from './modules/market';
import type { NewsModule } from './modules/news';
import type { PaperTradingModule } from './modules/paper-trading';
import type { PortfolioModule } from './modules/portfolio';
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
  portfolio: PortfolioModule;
  calendar: CalendarModule;
  /** Optional Prometheus HTTP metrics (count and latency per route pattern). */
  metrics?: { recordHttp: (method: string, route: string, status: number, seconds: number) => void };
};

const securityHeaders = {
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Origin-Agent-Cluster': '?1',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-DNS-Prefetch-Control': 'off',
  'X-Download-Options': 'noopen',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'X-XSS-Protection': '0',
};

/** Native Elysia routes, compiled once and served through Bun's router in production. */
export function createApp({ clientOrigin, pingDatabase, identity, profiles, market, strategies, ai, backtesting, paperTrading, news, community, portfolio, calendar, metrics }: AppDeps) {
  const app = new Elysia({
    name: 'trading-api',
    websocket: { maxPayloadLength: WS_LIMITS.maxMessageBytes, backpressureLimit: WS_LIMITS.maxBufferedBytes, closeOnBackpressureLimit: true },
  });
  if (metrics) app.use(httpMetrics(metrics.recordHttp));

  app.onRequest(({ request, set }) => {
    const suppliedId = request.headers.get('x-request-id');
    set.headers['X-Request-Id'] = suppliedId && /^[\w-]{1,255}$/.test(suppliedId) ? suppliedId : crypto.randomUUID();
    Object.assign(set.headers, securityHeaders);
    const origin = request.headers.get('origin');
    if (origin && (clientOrigin === '*' || clientOrigin.includes(origin))) set.headers['Access-Control-Allow-Origin'] = origin;
    set.headers['Access-Control-Allow-Credentials'] = 'true';
    set.headers['Access-Control-Expose-Headers'] = 'set-auth-token';
    set.headers.Vary = 'Origin';
    // Preflight must finish before authentication, including unknown API paths.
    if (request.method === 'OPTIONS') {
      set.status = 204;
      set.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization,expo-origin,Idempotency-Key';
      set.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
      set.headers.Vary = 'Origin, Access-Control-Request-Headers';
    }
  });

  const handleApiError = ({ error, code, set }: Pick<Context, 'set'> & { error: unknown; code: string | number }) => {
    if (error instanceof HttpError) { set.status = error.status; return error.payload; }
    if (code === 'NOT_FOUND') { set.status = 404; return { error: 'Not found' }; }
    if (code === 'PARSE') { set.status = 400; return { error: 'Request body must be JSON.', code: 'INVALID_JSON' }; }
    console.error(`[${set.headers['X-Request-Id']}]`, error);
    set.status = 500;
    return { error: 'Internal server error' };
  };

  // A group appends its fallback to every contained route after the module's own error hooks.
  // Registering only on the parent after .use() misses errors in already registered routes.
  app.group('', group => group
    .use(identity.routes)
    .use(profiles.routes)
    .use(market.routes)
    .use(strategies.routes)
    .use(ai.routes)
    .use(backtesting.routes)
    .use(paperTrading.routes)
    .use(news.routes)
    .use(community.routes)
    .use(portfolio.routes)
    .use(calendar.routes)
    .onError(handleApiError));

  app.onError(handleApiError);
  app.options('/*', () => new Response(null, { status: 204 }), { parse: 'none' });
  app.get('/health', () => ({ ok: true, service: 'trading-backend' }));
  app.get('/health/version', () => ({ framework: 'elysia', revision: process.env.BUILD_REVISION?.trim() || null, runtime: Bun.version }));
  app.get('/health/ready', async ({ set }) => {
    const database = await pingDatabase();
    set.status = database ? 200 : 503;
    return { ok: database, database: database ? 'up' : 'down' };
  });

  return app;
}
