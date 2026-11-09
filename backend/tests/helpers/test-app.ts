import { createApp } from '../../src/app';
import type { AuthConfig } from '../../src/config';
import { clientIpResolver } from '../../src/http/client-ip';
import { createIdentityModule, type SmsSender } from '../../src/modules/identity';
import { createAiModule } from '../../src/modules/ai';
import { createBacktestingModule } from '../../src/modules/backtesting';
import type { CandleHistory } from '../../src/modules/backtesting/backtesting.market-history';
import { silentLogger } from '../../src/logger';
import { createMarketModule } from '../../src/modules/market';
import { createNewsModule, type NewsSource } from '../../src/modules/news';
import { createPaperTradingModule } from '../../src/modules/paper-trading';
import { createProfilesModule } from '../../src/modules/profiles';
import { createStrategiesModule } from '../../src/modules/strategies';
import { FakeChatModel, FAKE_MODELS } from './fake-ai';
import { FakeFeed, FakeProvider } from './fake-market';
import { createTestDb } from './test-db';

export const TEST_ORIGIN = 'http://localhost:4001';

/** Records texts instead of sending them, so tests can read the OTP. */
export class FakeSms implements SmsSender {
  readonly name = 'fake';
  sent: { to: string; message: string }[] = [];
  fail = false;
  async send(to: string, message: string) {
    if (this.fail) throw new Error('provider down');
    this.sent.push({ to, message });
  }
  lastCode() {
    return this.sent.at(-1)?.message.match(/\b(\d{6})\b/)?.[1];
  }
}

/** Tests use the real sandbox: bubblewrap where available (as in production), else resource limits only. */
export const TEST_SANDBOX_MODE: 'bwrap' | 'process' = (process.env.TEST_SANDBOX_MODE as 'bwrap' | 'process') ?? (Bun.which('bwrap') ? 'bwrap' : 'process');

/** Candle backfill stand-in: tests seed market_candles directly; this records what was asked for. */
export class FakeHistory implements CandleHistory {
  calls: Parameters<CandleHistory['ensure']>[0][] = [];
  fail: Error | null = null;
  async ensure(input: Parameters<CandleHistory['ensure']>[0]) {
    this.calls.push(input);
    if (this.fail) throw this.fail;
  }
}

export class FakeClock {
  constructor(public current = new Date()) {}
  now = () => new Date(this.current);
  advance(seconds: number) { this.current = new Date(this.current.getTime() + seconds * 1000); }
}

const authConfig = (overrides: Partial<AuthConfig> = {}): AuthConfig => ({
  secret: 'test-secret-test-secret-test-secret-0000',
  baseUrl: TEST_ORIGIN,
  trustedOrigins: [TEST_ORIGIN],
  google: { clientId: 'test-google-client', clientSecret: 'test-google-secret' },
  apple: undefined,
  appleBundleId: undefined,
  ...overrides,
});

/** The real app (real Better Auth, real migrations) on an in-memory Postgres. */
export async function createTestApp(options: { auth?: Partial<AuthConfig>; pingDatabase?: () => Promise<boolean>; aiLimits?: { turnsPerDay: number; tokensPerDay: number }; aiConfigured?: boolean; backtestEngine?: import('../../src/modules/backtesting').BacktestEngine; signalEngine?: import('../../src/modules/backtesting').StrategySignalEngine; newsSources?: NewsSource[] } = {}) {
  const database = await createTestDb();
  const sms = new FakeSms();
  const clock = new FakeClock();
  // Tests act as a trusted reverse proxy that sets X-Forwarded-For.
  const identity = createIdentityModule({ db: database.appDb, config: authConfig(options.auth), sms, clock, clientIp: clientIpResolver('x-forwarded-for') });
  const profiles = createProfilesModule({ db: database.appDb, requireActiveUser: identity.requireActiveUser });
  const provider = new FakeProvider();
  const feed = new FakeFeed();
  const market = createMarketModule({ db: database.appDb, requireActiveUser: identity.requireActiveUser, exchanges: [{ provider, feed }], clock });
  const strategies = createStrategiesModule({
    db: database.appDb, requireActiveUser: identity.requireActiveUser,
    instruments: { isActive: (exchange, symbol) => market.service.isActiveInstrument(exchange, symbol) },
  });
  const model = new FakeChatModel();
  const ai = createAiModule({
    db: database.appDb, requireActiveUser: identity.requireActiveUser,
    providers: options.aiConfigured === false ? [] : [model], models: FAKE_MODELS, defaultModelId: 'fake-main', fallbackModelIds: ['fake-backup'],
    limits: options.aiLimits ?? { turnsPerDay: 50, tokensPerDay: 1_000_000 },
    market: market.service, strategies: strategies.service, profiles: profiles.service, clock,
  });
  const history = new FakeHistory();
  const backtesting = createBacktestingModule({
    db: database.appDb, requireActiveUser: identity.requireActiveUser, market: market.service, strategies: strategies.service,
    sandbox: { mode: TEST_SANDBOX_MODE }, history, clock, log: silentLogger, engine: options.backtestEngine,
  });
  const paperTrading = createPaperTradingModule({
    db: database.appDb, requireActiveUser: identity.requireActiveUser, market: { service: market.service, hub: market.hub },
    signals: options.signalEngine ?? backtesting.signals, queue: backtesting.queue, clock, log: silentLogger,
  });
  const news = createNewsModule({ db: database.appDb, requireActiveUser: identity.requireActiveUser, sources: options.newsSources ?? [], clock });
  const app = createApp({ clientOrigin: '*', pingDatabase: options.pingDatabase ?? (async () => true), identity, profiles, market, strategies, ai, backtesting, paperTrading, news });
  return { app, identity, profiles, market, strategies, ai, backtesting, paperTrading, news, history, model, provider, feed, sms, clock, ...database };
}

let clientCount = 0;

/**
 * Small cookie-jar client for driving the auth API like a browser/app would.
 * Each client gets its own IP so rate limits apply per client, as they would in production.
 */
export function client(app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }, ip = `10.0.${Math.floor(++clientCount / 250)}.${clientCount % 250}`) {
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { Origin: TEST_ORIGIN, 'X-Forwarded-For': ip, ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const setCookies = res.headers.getSetCookie();
    for (const c of setCookies) {
      const [pair] = c.split(';');
      const [name] = pair!.split('=');
      const rest = cookie.split('; ').filter(p => p && !p.startsWith(`${name}=`));
      cookie = (c.includes('Max-Age=0') ? rest : [...rest, pair!]).join('; ');
    }
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed, headers: res.headers };
  };
  return {
    get: (path: string) => call('GET', path),
    post: (path: string, body: unknown = {}) => call('POST', path, body),
    patch: (path: string, body: unknown = {}) => call('PATCH', path, body),
    delete: (path: string) => call('DELETE', path),
    get cookie() { return cookie; },
  };
}
