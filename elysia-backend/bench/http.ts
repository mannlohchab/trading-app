/**
 * HTTP overhead comparison using each backend's real application and market routes.
 * Run from elysia-backend: bun bench/http.ts > /tmp/http-benchmark.json
 * Install dependencies in both backend directories first.
 * BENCH_DURATION_MS=3000 BENCH_WARMUP_MS=1000 BENCH_CONCURRENCY=32 BENCH_ROUNDS=3
 *
 * Sessions and market data are in-memory fixtures: this does not measure Postgres,
 * Better Auth, Binance, background workers, or end-to-end production capacity.
 * Each framework runs in its own child process. The load generator runs here.
 */
import { Elysia } from 'elysia';
import { createRequire } from 'node:module';
import { createApp as createElysiaApp, type AppDeps } from '../src/app';
import { marketRoutes as elysiaMarketRoutes } from '../src/modules/market/http/market.routes';
import type { UserGuard } from '../src/modules/identity';

type Framework = 'hono' | 'elysia';
const token = 'benchmark-session';
const session = { user: { id: 'benchmark-user', status: 'ACTIVE' }, session: { id: token } };
const tickers = Array.from({ length: 25 }, (_, index) => ({
  exchange: 'BINANCE', symbol: `ASSET${index}USDT`, lastPrice: '70000.12345678',
  priceChange: '234.12345678', priceChangePercent: '0.33', openPrice: '69766',
  highPrice: '71000', lowPrice: '68000', volume: '10234.12345', quoteVolume: '716380000',
  bidPrice: '70000.12', askPrice: '70000.13', time: 1_700_000_000_000,
}));
const marketService = {
  listExchanges: async () => [{ code: 'BINANCE', name: 'Binance' }],
  tickerList: async () => tickers,
  tickersFor: async () => tickers,
};
const moduleNames = ['identity', 'profiles', 'strategies', 'ai', 'backtesting', 'paperTrading', 'news', 'community', 'portfolio', 'calendar'];

async function serve(framework: Framework) {
  // Hono's existing logger still executes, but terminal I/O must not dominate this comparison.
  console.log = () => {};
  console.info = () => {};
  let port: number;
  if (framework === 'elysia') {
    const guard: UserGuard = async request => {
      if (request.headers.get('authorization') !== `Bearer ${token}`) throw new Error('Missing benchmark session');
      return session as Awaited<ReturnType<UserGuard>>;
    };
    const routes = elysiaMarketRoutes({
      service: marketService as never, hub: {} as never, requireActiveUser: guard, defaultExchange: 'BINANCE',
    });
    const modules = Object.fromEntries(moduleNames.map(name => [name, { routes: new Elysia() }]));
    const app = createElysiaApp({ ...modules, market: { routes }, clientOrigin: '*', pingDatabase: async () => true } as AppDeps);
    app.listen({ port: 0, hostname: '127.0.0.1' });
    port = app.server!.port!;
  } else {
    const requireBackend = createRequire(new URL('../../backend/package.json', import.meta.url));
    const { Hono } = requireBackend('hono');
    const { createBunWebSocket } = requireBackend('hono/bun');
    const [{ createApp }, { marketRoutes }] = await Promise.all([
      import('../../backend/src/app'), import('../../backend/src/modules/market/http/market.routes'),
    ]);
    const { upgradeWebSocket, websocket } = createBunWebSocket();
    const routes = marketRoutes({
      service: marketService as never, hub: {} as never, defaultExchange: 'BINANCE', upgradeWebSocket,
      requireActiveUser: async (context, next) => {
        if (context.req.header('authorization') !== `Bearer ${token}`) throw new Error('Missing benchmark session');
        context.set('user', session.user as never);
        context.set('session', session.session as never);
        await next();
      },
    });
    const modules = Object.fromEntries(moduleNames.map(name => [name, { routes: new Hono() }]));
    const app = createApp({ ...modules, market: { routes }, clientOrigin: '*', pingDatabase: async () => true } as Parameters<typeof createApp>[0]);
    port = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: app.fetch, websocket }).port!;
  }
  process.stdout.write(`${JSON.stringify({ port })}\n`);
}

function positiveSetting(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

async function startServer(framework: Framework) {
  const child = Bun.spawn([process.execPath, import.meta.path, '--server', framework], {
    cwd: new URL('..', import.meta.url).pathname, stdout: 'pipe', stderr: 'inherit',
  });
  try {
    const reader = child.stdout.getReader();
    const ready = await reader.read();
    reader.releaseLock();
    if (!ready.value) throw new Error(`${framework} server exited before listening`);
    const { port } = JSON.parse(new TextDecoder().decode(ready.value));
    return { child, origin: `http://127.0.0.1:${port}` };
  } catch (error) {
    child.kill();
    await child.exited;
    throw error;
  }
}

const requestHeaders = { Authorization: `Bearer ${token}`, Origin: 'http://localhost:8081' };

async function measure(url: string, durationMs: number, concurrency: number) {
  const latencies: number[] = [];
  let errors = 0;
  const started = performance.now();
  const deadline = started + durationMs;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (performance.now() < deadline) {
      const start = performance.now();
      try {
        const response = await fetch(url, { headers: requestHeaders });
        await response.arrayBuffer();
        if (response.status !== 200) errors++;
      } catch { errors++; }
      latencies.push(performance.now() - start);
    }
  }));
  const elapsedMs = performance.now() - started;
  latencies.sort((a, b) => a - b);
  const percentile = (fraction: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))] ?? 0;
  return {
    requests: latencies.length, errors, elapsedMs: Math.round(elapsedMs),
    requestsPerSecond: Math.round(latencies.length * 1000 / elapsedMs),
    p50Ms: +percentile(0.5).toFixed(3), p95Ms: +percentile(0.95).toFixed(3), p99Ms: +percentile(0.99).toFixed(3),
  };
}

async function benchmark() {
  const config = {
    durationMs: positiveSetting('BENCH_DURATION_MS', 3000),
    warmupMs: positiveSetting('BENCH_WARMUP_MS', 1000),
    concurrency: positiveSetting('BENCH_CONCURRENCY', 32),
    rounds: positiveSetting('BENCH_ROUNDS', 3),
  };
  const results = [];
  const expectedBodies = new Map<string, string>();
  for (let round = 1; round <= config.rounds; round++) {
    // Alternate order to reduce bias from warm caches and clock/temperature drift.
    const order: Framework[] = round % 2 ? ['hono', 'elysia'] : ['elysia', 'hono'];
    for (const framework of order) {
      const { child, origin } = await startServer(framework);
      try {
        for (const path of ['/health', '/api/v1/market/tickers?limit=25']) {
          const url = `${origin}${path}`;
          const probe = await fetch(url, { headers: requestHeaders });
          const body = JSON.stringify(await probe.json());
          if (probe.status !== 200) throw new Error(`${framework} ${path}: HTTP ${probe.status}`);
          if (expectedBodies.has(path) && expectedBodies.get(path) !== body) throw new Error(`Response mismatch on ${path}`);
          expectedBodies.set(path, body);
          await measure(url, config.warmupMs, config.concurrency);
          const sample = { framework, round, path, ...await measure(url, config.durationMs, config.concurrency) };
          results.push(sample);
          console.error(`${framework} round ${round} ${path}: ${sample.requestsPerSecond} req/s, p95 ${sample.p95Ms} ms, ${sample.errors} errors`);
        }
      } finally {
        child.kill();
        await child.exited;
      }
    }
  }
  console.log(JSON.stringify({
    runtime: Bun.version, platform: `${process.platform}/${process.arch}`, config,
    scope: 'Loopback HTTP transport, real application middleware and market routes, stub sessions and cached tickers. No database or external provider I/O; console output disabled in both servers.',
    results,
  }, null, 2));
  if (results.some(result => result.errors > 0)) process.exitCode = 1;
}

if (process.argv[2] === '--server') {
  const framework = process.argv[3];
  if (framework !== 'hono' && framework !== 'elysia') throw new Error('Expected --server hono|elysia');
  await serve(framework);
} else {
  await benchmark();
}
