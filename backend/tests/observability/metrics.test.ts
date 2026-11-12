import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { httpMetrics } from '../../src/http/metrics-middleware';
import { createLogger, observeLogs } from '../../src/logger';
import { createMetrics } from '../../src/observability/metrics';

const line = (text: string, prefix: string) => text.split('\n').find(l => l.startsWith(prefix));

describe('HTTP metrics', () => {
  test('labels requests by route pattern, not raw path, and marks unmatched paths', async () => {
    const metrics = createMetrics({ defaultMetrics: false });
    const app = new Hono();
    app.use(httpMetrics(metrics.recordHttp));
    app.get('/api/v1/news/:id', c => c.json({ id: c.req.param('id') }));
    app.notFound(c => c.json({ error: 'Not found' }, 404));

    await app.request('/api/v1/news/a1');
    await app.request('/api/v1/news/b2');
    await app.request('/nope/123');

    const { body } = await metrics.render();
    expect(line(body, 'http_requests_total{method="GET",route="/api/v1/news/:id",status="200"}')).toEndWith(' 2');
    expect(line(body, 'http_requests_total{method="GET",route="unmatched",status="404"}')).toEndWith(' 1');
    expect(body).not.toContain('/api/v1/news/a1');
    expect(line(body, 'http_request_duration_seconds_count{method="GET",route="/api/v1/news/:id",status="200"}')).toEndWith(' 2');
  });
});

describe('log-derived metrics', () => {
  test('turns job, paper and news events into counters', async () => {
    const metrics = createMetrics({ defaultMetrics: false });
    const stop = observeLogs(metrics.observeLogEvent);
    const sink = () => {};
    try {
      const jobs = createLogger('jobs', sink);
      jobs('info', 'Job finished', { jobId: 'j1', type: 'news.poll', status: 'COMPLETED', ms: 42 });
      jobs('error', 'Job failed', { jobId: 'j2', type: 'backtest.run', outcome: 'FAILED', error: 'x' });
      createLogger('paper-trading', sink)('info', 'Paper order filled', { orderId: 'o1' });
      createLogger('news', sink)('info', 'News source polled', { source: 'cryptoslate', items: 10, inserted: 7 });
    } finally {
      stop();
    }
    const { body } = await metrics.render();
    expect(line(body, 'trading_jobs_finished_total{type="news.poll",status="COMPLETED"}')).toEndWith(' 1');
    expect(line(body, 'trading_job_duration_seconds_sum{type="news.poll"}')).toEndWith(' 0.042');
    expect(line(body, 'trading_jobs_failed_total{type="backtest.run",outcome="FAILED"}')).toEndWith(' 1');
    expect(line(body, 'trading_paper_order_fills_total')).toEndWith(' 1');
    expect(line(body, 'trading_news_articles_inserted_total{source="cryptoslate"}')).toEndWith(' 7');
    expect(line(body, 'trading_log_events_total{scope="jobs",level="error",event="Job failed"}')).toEndWith(' 1');
  });

  test('a throwing observer never breaks logging', () => {
    const lines: string[] = [];
    const stop = observeLogs(() => { throw new Error('boom'); });
    try {
      createLogger('x', l => lines.push(l))('info', 'still logged');
    } finally {
      stop();
    }
    expect(lines).toHaveLength(1);
  });
});

describe('database gauges', () => {
  test('refresh on every scrape and report failures without throwing', async () => {
    let fail = false;
    const metrics = createMetrics({
      defaultMetrics: false,
      databaseStats: async () => {
        if (fail) throw new Error('db down');
        return {
          jobs: [{ type: 'news.poll', status: 'PENDING', count: 3 }],
          aiTurns24h: [{ model: 'llama', status: 'SUCCEEDED', count: 2, inputTokens: 100, outputTokens: 40 }],
          users: [{ status: 'ACTIVE', count: 5 }],
          openPaperOrders: 4,
        };
      },
    });
    let { body } = await metrics.render();
    expect(line(body, 'trading_background_jobs{type="news.poll",status="PENDING"}')).toEndWith(' 3');
    expect(line(body, 'trading_ai_tokens_24h{model="llama",direction="output"}')).toEndWith(' 40');
    expect(line(body, 'trading_users{status="ACTIVE"}')).toEndWith(' 5');
    expect(line(body, 'trading_paper_open_orders')).toEndWith(' 4');
    expect(line(body, 'trading_database_stats_up')).toEndWith(' 1');

    fail = true;
    ({ body } = await metrics.render());
    expect(line(body, 'trading_database_stats_up')).toEndWith(' 0');
  });
});
