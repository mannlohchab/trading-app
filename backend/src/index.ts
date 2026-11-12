// Production composition root: real database, real config, real adapters.
import { hostname } from 'node:os';
import { createApp } from './app';
import { composeModules, startJobRunner } from './composition';
import { config } from './config';
import { closeDatabase, pingDatabase, sql } from './db/client';
import { observeLogs } from './logger';
import { createMetrics, type DatabaseStats } from './observability/metrics';

const metrics = config.metrics.port > 0 ? createMetrics({ databaseStats }) : undefined;
if (metrics) observeLogs(metrics.observeLogEvent);

const modules = composeModules();
const app = createApp({ clientOrigin: config.clientOrigin, pingDatabase, ...modules, metrics });
modules.market.startCatalogSync();

const server = Bun.serve({ port: config.port, fetch: app.fetch, websocket: modules.market.websocket });
console.log(`Trading backend listening on ${server.url}`);

// Prometheus scrapes this on the internal network only; the public proxy never routes to it.
const metricsServer = metrics
  ? Bun.serve({
      port: config.metrics.port,
      fetch: async req => {
        if (new URL(req.url).pathname !== '/metrics') return new Response('Not found', { status: 404 });
        const { body, contentType } = await metrics.render();
        return new Response(body, { headers: { 'Content-Type': contentType } });
      },
    })
  : undefined;
if (metricsServer) console.log(`Metrics on ${metricsServer.url}metrics`);

const stopJobs = config.backtesting.runJobs ? await startJobRunner(modules, `api:${hostname()}:${process.pid}`) : async () => {};

const shutdown = async () => {
  await stopJobs();
  modules.market.stop();
  await server.stop();
  await metricsServer?.stop();
  await closeDatabase();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

/** Cheap grouped counts for the metrics gauges (runs only when Prometheus scrapes). */
async function databaseStats(): Promise<DatabaseStats> {
  const [jobs, ai, users, orders] = await Promise.all([
    sql<{ type: string; status: string; count: number }[]>`select job_type as type, status::text as status, count(*)::int as count from background_jobs group by 1, 2`,
    sql<{ model: string; status: string; count: number; inputTokens: number; outputTokens: number }[]>`
      select model, status, count(*)::int as count, coalesce(sum(input_tokens), 0)::int as "inputTokens", coalesce(sum(output_tokens), 0)::int as "outputTokens"
      from ai_usage_events where created_at > now() - interval '24 hours' group by 1, 2`,
    sql<{ status: string; count: number }[]>`select status::text as status, count(*)::int as count from users group by 1`,
    sql<{ count: number }[]>`select count(*)::int as count from paper_orders where status in ('PENDING', 'OPEN', 'PARTIALLY_FILLED')`,
  ]);
  return { jobs, aiTurns24h: ai, users, openPaperOrders: orders[0]?.count ?? 0 };
}
