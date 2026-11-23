// Prometheus metrics for the backend. Framework-free: HTTP and database details are passed in.
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { LogEvent } from '../logger';

/** Point-in-time figures read from Postgres at scrape time. */
export type DatabaseStats = {
  jobs: { type: string; status: string; count: number }[];
  aiTurns24h: { model: string; status: string; count: number; inputTokens: number; outputTokens: number }[];
  users: { status: string; count: number }[];
  openPaperOrders: number;
};

export type Metrics = ReturnType<typeof createMetrics>;

export function createMetrics(deps: { databaseStats?: () => Promise<DatabaseStats>; defaultMetrics?: boolean } = {}) {
  const registry = new Registry();
  if (deps.defaultMetrics !== false) collectDefaultMetrics({ register: registry });

  const httpRequests = new Counter({
    name: 'http_requests_total', help: 'HTTP requests handled, by route pattern',
    labelNames: ['method', 'route', 'status'] as const, registers: [registry],
  });
  const httpDuration = new Histogram({
    name: 'http_request_duration_seconds', help: 'HTTP request duration, by route pattern',
    labelNames: ['method', 'route', 'status'] as const, registers: [registry],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  });
  const logEvents = new Counter({
    name: 'trading_log_events_total', help: 'Structured log events, by scope, level and message',
    labelNames: ['scope', 'level', 'event'] as const, registers: [registry],
  });
  const jobsFinished = new Counter({
    name: 'trading_jobs_finished_total', help: 'Background jobs that finished, by type and status',
    labelNames: ['type', 'status'] as const, registers: [registry],
  });
  const jobsFailed = new Counter({
    name: 'trading_jobs_failed_total', help: 'Background job attempts that failed, by type and outcome',
    labelNames: ['type', 'outcome'] as const, registers: [registry],
  });
  const jobDuration = new Histogram({
    name: 'trading_job_duration_seconds', help: 'Background job run time, by type',
    labelNames: ['type'] as const, registers: [registry], buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60, 300],
  });
  const paperFills = new Counter({ name: 'trading_paper_order_fills_total', help: 'Paper orders filled', registers: [registry] });
  const newsInserted = new Counter({
    name: 'trading_news_articles_inserted_total', help: 'New news articles stored, by source',
    labelNames: ['source'] as const, registers: [registry],
  });
  const newsItems = new Counter({
    name: 'trading_news_poll_items_total', help: 'Items received from news sources, by source',
    labelNames: ['source'] as const, registers: [registry],
  });

  const aiTurnsTotal = new Counter({
    name: 'trading_ai_turns_total', help: 'AI assistant turns recorded, by model and status',
    labelNames: ['model', 'status'] as const, registers: [registry],
  });
  const aiTokensTotal = new Counter({
    name: 'trading_ai_tokens_total', help: 'AI tokens used, by model and direction (input/output)',
    labelNames: ['model', 'direction'] as const, registers: [registry],
  });
  const aiTurnDuration = new Histogram({
    name: 'trading_ai_turn_duration_seconds', help: 'AI assistant turn latency, by model and status',
    labelNames: ['model', 'status'] as const, registers: [registry], buckets: [0.5, 1, 2, 5, 10, 20, 30, 60, 120],
  });
  const aiToolCalls = new Counter({ name: 'trading_ai_tool_calls_total', help: 'Tool calls made during AI turns, by model', labelNames: ['model'] as const, registers: [registry] });
  const aiErrors = new Counter({ name: 'trading_ai_errors_total', help: 'Failed AI turns, by model and error code', labelNames: ['model', 'code'] as const, registers: [registry] });

  const jobsGauge = new Gauge({ name: 'trading_background_jobs', help: 'Background jobs currently in the queue table, by type and status', labelNames: ['type', 'status'] as const, registers: [registry] });
  const aiTurns = new Gauge({ name: 'trading_ai_turns_24h', help: 'AI assistant turns in the last 24 hours, by model and status', labelNames: ['model', 'status'] as const, registers: [registry] });
  const aiTokens = new Gauge({ name: 'trading_ai_tokens_24h', help: 'AI tokens used in the last 24 hours, by model and direction', labelNames: ['model', 'direction'] as const, registers: [registry] });
  const usersGauge = new Gauge({ name: 'trading_users', help: 'User accounts, by status', labelNames: ['status'] as const, registers: [registry] });
  const openOrders = new Gauge({ name: 'trading_paper_open_orders', help: 'Paper orders waiting to fill', registers: [registry] });
  const statsUp = new Gauge({ name: 'trading_database_stats_up', help: '1 when the last database stats query succeeded', registers: [registry] });

  async function refreshDatabaseStats() {
    if (!deps.databaseStats) return;
    try {
      const stats = await deps.databaseStats();
      jobsGauge.reset(); aiTurns.reset(); aiTokens.reset(); usersGauge.reset();
      for (const j of stats.jobs) jobsGauge.set({ type: j.type, status: j.status }, j.count);
      for (const t of stats.aiTurns24h) {
        aiTurns.set({ model: t.model, status: t.status }, t.count);
        aiTokens.inc({ model: t.model, direction: 'input' }, t.inputTokens);
        aiTokens.inc({ model: t.model, direction: 'output' }, t.outputTokens);
      }
      for (const u of stats.users) usersGauge.set({ status: u.status }, u.count);
      openOrders.set(stats.openPaperOrders);
      statsUp.set(1);
    } catch {
      statsUp.set(0);
    }
  }

  const number = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const label = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 60) : 'unknown');

  return {
    registry,

    recordHttp(method: string, route: string, status: number, seconds: number) {
      const labels = { method, route, status: String(status) };
      httpRequests.inc(labels);
      httpDuration.observe(labels, seconds);
    },

    /** Turns known structured log events into metrics. Messages are code literals, so labels stay bounded. */
    observeLogEvent({ scope, level, message, fields }: LogEvent) {
      logEvents.inc({ scope, level, event: message.slice(0, 80) });
      if (message === 'Job finished' || message === 'Job finished after its lease was lost') {
        jobsFinished.inc({ type: label(fields.type), status: label(fields.status) });
        jobDuration.observe({ type: label(fields.type) }, number(fields.ms) / 1000);
      } else if (message === 'Job failed') {
        jobsFailed.inc({ type: label(fields.type), outcome: label(fields.outcome) });
      } else if (message === 'Paper order filled') {
        paperFills.inc();
      } else if (message === 'AI turn recorded') {
        const model = label(fields.model), status = label(fields.status);
        aiTurnsTotal.inc({ model, status });
        aiTokensTotal.inc({ model, direction: 'input' }, number(fields.inputTokens));
        aiTokensTotal.inc({ model, direction: 'output' }, number(fields.outputTokens));
        aiTurnDuration.observe({ model, status }, number(fields.latencyMs) / 1000);
        aiToolCalls.inc({ model }, number(fields.toolCalls));
        if (status === 'FAILED') aiErrors.inc({ model, code: label(fields.errorCode) });
      } else if (message === 'News source polled') {
        newsInserted.inc({ source: label(fields.source) }, number(fields.inserted));
        newsItems.inc({ source: label(fields.source) }, number(fields.items));
      }
    },

    /** Prometheus text exposition, with fresh database gauges. */
    async render(): Promise<{ body: string; contentType: string }> {
      await refreshDatabaseStats();
      return { body: await registry.metrics(), contentType: registry.contentType };
    },
  };
}
