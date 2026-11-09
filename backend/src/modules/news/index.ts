// News module: crypto news from aggregator APIs and publishers' RSS feeds, stored in Postgres and
// served from there. Sources are polled by background jobs (`news.poll`), one schedule shared by
// every process; user requests never reach a source.
import type { MiddlewareHandler } from 'hono';
import type { AppDatabase } from '../../db/types';
import type { AuthVariables } from '../identity';
import { PostgresJobQueue } from '../system/jobs';
import { NewsIngestionService } from './application/news-ingestion.service';
import { newsPollJobHandler } from './application/news-poll.job';
import { NewsQueryService } from './application/news-query.service';
import type { Clock, Log, NewsSource } from './application/ports';
import { newsRoutes } from './http/news.routes';
import { CryptocurrencyCvSource } from './infrastructure/cryptocurrency-cv.source';
import { CryptoPanicSource } from './infrastructure/cryptopanic.source';
import { DrizzleNewsRepository } from './infrastructure/drizzle-news.repository';
import type { FetchOptions } from './infrastructure/http-fetch';
import { RssNewsSource, type RssFeedConfig } from './infrastructure/rss.source';

export type { NewsSource } from './application/ports';
export type { RawNewsItem } from './domain/article';
export { NEWS_POLL_JOB } from './application/news-ingestion.service';

const MINUTE = 60_000;

/** Publishers' own feeds. All free and key-less. */
export const DEFAULT_RSS_FEEDS: Omit<RssFeedConfig, 'intervalMs'>[] = [
  { id: 'coindesk', name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { id: 'cointelegraph', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { id: 'theblock', name: 'The Block', url: 'https://www.theblock.co/rss.xml' },
  { id: 'decrypt', name: 'Decrypt', url: 'https://decrypt.co/feed' },
  { id: 'cryptoslate', name: 'CryptoSlate', url: 'https://cryptoslate.com/feed/' },
];

export type NewsSourcesConfig = {
  rss: { enabled: boolean; intervalMinutes: number };
  cryptocurrencyCv: { enabled: boolean; intervalMinutes: number; topics: string[] };
  cryptoPanic?: { apiKey: string; intervalMinutes: number; baseUrl?: string };
};

/** The real sources from configuration. CryptoPanic is only added when an API key is set. */
export function newsSourcesFromConfig(config: NewsSourcesConfig, options: FetchOptions = {}): NewsSource[] {
  const sources: NewsSource[] = [];
  if (config.cryptocurrencyCv.enabled) {
    sources.push(new CryptocurrencyCvSource({ intervalMs: config.cryptocurrencyCv.intervalMinutes * MINUTE, topics: config.cryptocurrencyCv.topics }, options));
  }
  if (config.cryptoPanic) {
    sources.push(new CryptoPanicSource({ apiKey: config.cryptoPanic.apiKey, baseUrl: config.cryptoPanic.baseUrl, intervalMs: config.cryptoPanic.intervalMinutes * MINUTE }, options));
  }
  if (config.rss.enabled) {
    for (const feed of DEFAULT_RSS_FEEDS) sources.push(new RssNewsSource({ ...feed, intervalMs: config.rss.intervalMinutes * MINUTE }, options));
  }
  return sources;
}

const systemClock: Clock = { now: () => new Date() };

export function createNewsModule(deps: {
  db: AppDatabase;
  requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }>;
  sources: NewsSource[];
  retentionDays?: number;
  clock?: Clock;
  log?: Log;
}) {
  const clock = deps.clock ?? systemClock;
  const log = deps.log ?? (() => {});
  const repository = new DrizzleNewsRepository(deps.db, new PostgresJobQueue(deps.db, () => clock.now()));
  const ingestion = new NewsIngestionService({ sources: deps.sources, repository, clock, log, retentionMs: (deps.retentionDays ?? 30) * 86_400_000 });
  const service = new NewsQueryService({ repository, sources: deps.sources, clock });

  let repairTimer: ReturnType<typeof setInterval> | undefined;
  return {
    service,
    ingestion,
    routes: newsRoutes({ service, requireActiveUser: deps.requireActiveUser }),
    jobHandler: newsPollJobHandler(ingestion),
    /**
     * Queues every source's next poll now, and re-checks every few minutes so a poll chain broken by
     * repeated database failures heals itself. Call in processes that run background jobs.
     */
    async startScheduling(everyMs = 5 * MINUTE) {
      const run = () => ingestion.scheduleAll().catch(e => log('error', 'Scheduling news polls failed', { error: e instanceof Error ? e.message : String(e) }));
      await run();
      repairTimer = setInterval(run, everyMs);
    },
    stop() {
      clearInterval(repairTimer);
    },
  };
}

export type NewsModule = ReturnType<typeof createNewsModule>;
