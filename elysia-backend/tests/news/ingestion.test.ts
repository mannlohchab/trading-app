import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { backgroundJobs, newsArticles, newsSources } from '../../src/db/schema';
import { NewsSourceUnavailableError } from '../../src/modules/news/application/errors';
import type { NewsSource, RawNewsItem } from '../../src/modules/news';
import { NEWS_POLL_JOB } from '../../src/modules/news';
import { JobRunner, PostgresJobQueue } from '../../src/modules/system/jobs';
import { client, createTestApp } from '../helpers/test-app';
import { activeUser } from '../helpers/users';

class FakeSource implements NewsSource {
  items: RawNewsItem[] = [];
  error: Error | null = null;
  calls = 0;
  constructor(readonly id: string, readonly name: string, readonly kind: 'rss' | 'aggregator', readonly intervalMs = 10 * 60_000) {}
  async fetchLatest() {
    this.calls++;
    if (this.error) throw this.error;
    return this.items;
  }
}

const rss = new FakeSource('coindesk', 'CoinDesk', 'rss');
const aggregator = new FakeSource('cryptocurrency-cv', 'Free Crypto News API', 'aggregator');

let t: Awaited<ReturnType<typeof createTestApp>>;
let runner: JobRunner;
let user: Awaited<ReturnType<typeof activeUser>>;

const hours = (h: number) => new Date(t.clock.now().getTime() - h * 3_600_000);

/** Runs every news job that is due now. */
async function runDueJobs() {
  while (await runner.tick()) { /* drain */ }
}
const state = async (id: string) => (await t.db.select().from(newsSources).where(eq(newsSources.id, id)))[0]!;
const pendingPolls = (sourceId: string) => t.db.select().from(backgroundJobs)
  .where(and(eq(backgroundJobs.jobType, NEWS_POLL_JOB), eq(backgroundJobs.status, 'PENDING')))
  .then(rows => rows.filter(r => (r.payload as { sourceId: string }).sourceId === sourceId));

beforeAll(async () => {
  t = await createTestApp({ newsSources: [rss, aggregator] });
  runner = new JobRunner({ queue: new PostgresJobQueue(t.appDb, t.clock.now), handlers: [t.news.jobHandler], workerId: 'test', leaseMs: 60_000 });
  user = await activeUser(t);
});
afterAll(() => t.close());

describe('scheduling and ingestion', () => {
  test('scheduling twice (two processes) queues one poll per source', async () => {
    await t.news.ingestion.scheduleAll();
    await t.news.ingestion.scheduleAll();
    expect(await pendingPolls('coindesk')).toHaveLength(1);
    expect(await pendingPolls('cryptocurrency-cv')).toHaveLength(1);
  });

  test('a poll stores articles and queues the next poll one interval later', async () => {
    rss.items = [
      { url: 'https://www.coindesk.com/markets/btc-etf?utm_source=rss', title: 'Bitcoin ETF inflows jump', summary: '<p>Record day for spot funds.</p>', publisher: 'CoinDesk', publishedAt: hours(2), categories: ['Markets'] },
      { url: 'https://www.coindesk.com/tech/solana-upgrade', title: 'Solana ships an upgrade', publisher: 'CoinDesk', publishedAt: hours(1), author: 'Jane' },
    ];
    await runDueJobs();
    expect(rss.calls).toBe(1);
    const rows = await t.db.select().from(newsArticles);
    expect(rows.map(r => r.title).sort()).toEqual(['Bitcoin ETF inflows jump', 'Solana ships an upgrade']);
    const s = await state('coindesk');
    expect(s).toMatchObject({ consecutiveFailures: 0, lastItemCount: 2, lastError: null });
    expect(s.nextRunAt.getTime()).toBe(t.clock.now().getTime() + rss.intervalMs);
    const [next] = await pendingPolls('coindesk');
    expect(next!.availableAt.getTime()).toBe(s.nextRunAt.getTime());
  });

  test('nothing runs before the next poll is due', async () => {
    t.clock.advance(60);
    await runDueJobs();
    expect(rss.calls).toBe(1);
  });

  test('the same story from an aggregator merges into the publisher’s row', async () => {
    aggregator.items = [{
      url: 'https://coindesk.com/markets/btc-etf/', title: 'Different headline from the aggregator', publisher: 'CoinDesk',
      imageUrl: 'https://img.example.com/etf.jpg', breaking: true, publishedAt: hours(3), metadata: { credibility: 0.9 },
    }];
    await t.news.ingestion.poll('cryptocurrency-cv', (await state('cryptocurrency-cv')).nextRunAt);
    const rows = await t.db.select().from(newsArticles).where(eq(newsArticles.canonicalUrl, 'https://coindesk.com/markets/btc-etf'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Bitcoin ETF inflows jump', // the first source keeps its title
      imageUrl: 'https://img.example.com/etf.jpg', // missing fields are filled in
      providers: ['coindesk', 'cryptocurrency-cv'],
      assets: ['BTC'],
      metadata: { 'cryptocurrency-cv': { credibility: 0.9 } },
    });
    expect(rows[0]!.breakingAt).not.toBeNull();
    expect(rows[0]!.publishedAt).toEqual(hours(3)); // the earliest date wins
  });

  test('repeats that add nothing do not rewrite rows', async () => {
    const before = (await t.db.select().from(newsArticles)).map(r => [r.id, r.updatedAt.getTime()]);
    t.clock.advance(rss.intervalMs / 1000);
    await runDueJobs();
    expect(rss.calls).toBe(2);
    expect((await t.db.select().from(newsArticles)).map(r => [r.id, r.updatedAt.getTime()])).toEqual(before);
  });

  test('a leftover duplicate job does not poll again', async () => {
    const s = await state('coindesk');
    expect(await t.news.ingestion.poll('coindesk', new Date(s.nextRunAt.getTime() - rss.intervalMs))).toBe('stale');
    expect(rss.calls).toBe(2);
  });

  test('failures back off, are recorded, and the source recovers', async () => {
    rss.error = new NewsSourceUnavailableError('CoinDesk answered 503');
    t.clock.advance(rss.intervalMs / 1000);
    await runDueJobs();
    let s = await state('coindesk');
    expect(s).toMatchObject({ consecutiveFailures: 1, lastError: 'CoinDesk answered 503' });
    expect(s.nextRunAt.getTime()).toBe(t.clock.now().getTime() + rss.intervalMs);

    t.clock.advance(rss.intervalMs / 1000);
    await runDueJobs();
    s = await state('coindesk');
    expect(s.consecutiveFailures).toBe(2);
    expect(s.nextRunAt.getTime()).toBe(t.clock.now().getTime() + 2 * rss.intervalMs);

    rss.error = new NewsSourceUnavailableError('rate limited', 5 * rss.intervalMs);
    t.clock.advance((2 * rss.intervalMs) / 1000);
    await runDueJobs();
    s = await state('coindesk');
    expect(s.nextRunAt.getTime()).toBe(t.clock.now().getTime() + 5 * rss.intervalMs);

    rss.error = null;
    t.clock.advance((5 * rss.intervalMs) / 1000);
    await runDueJobs();
    expect(await state('coindesk')).toMatchObject({ consecutiveFailures: 0, lastError: null });
    expect(await pendingPolls('coindesk')).toHaveLength(1);
  });

  test('articles past the retention window are pruned', async () => {
    rss.items = [...rss.items, { url: 'https://coindesk.com/old', title: 'Ancient Bitcoin story', publisher: 'CoinDesk', publishedAt: new Date(t.clock.now().getTime() - 31 * 86_400_000) }];
    t.clock.advance(rss.intervalMs / 1000);
    await runDueJobs();
    expect(await t.db.select().from(newsArticles).where(eq(newsArticles.canonicalUrl, 'https://coindesk.com/old'))).toHaveLength(0);
  });
});

describe('news API', () => {
  beforeAll(async () => {
    // Twenty-five more stories, one per hour, for pagination.
    const items: RawNewsItem[] = Array.from({ length: 25 }, (_, i) => ({
      url: `https://decrypt.co/${i}/story`, title: i % 2 ? `Ethereum story ${i}` : `XRP story ${i} on stablecoin rules`, publisher: 'Decrypt', publishedAt: hours(5 + i),
    }));
    aggregator.items = items;
    expect(await t.news.ingestion.poll('cryptocurrency-cv', (await state('cryptocurrency-cv')).nextRunAt)).toBe('polled');
  });

  test('requires an active user', async () => {
    expect((await client(t.app).get('/api/v1/news')).status).toBe(401);
  });

  test('lists newest first with a stable cursor', async () => {
    const first = await user.c.get('/api/v1/news?limit=10');
    expect(first.status).toBe(200);
    expect(first.body.articles).toHaveLength(10);
    expect(first.body.articles[0]).toMatchObject({ title: 'Solana ships an upgrade', publisher: { key: 'coindesk', name: 'CoinDesk' }, assets: ['SOL'], breaking: false, sources: ['coindesk'] });
    const seen = new Set<string>(first.body.articles.map((a: { id: string }) => a.id));
    let cursor = first.body.nextCursor as string | null;
    let pages = 1;
    while (cursor) {
      const page = await user.c.get(`/api/v1/news?limit=10&cursor=${cursor}`);
      for (const a of page.body.articles) { expect(seen.has(a.id)).toBe(false); seen.add(a.id); }
      cursor = page.body.nextCursor;
      pages++;
    }
    expect(seen.size).toBe(27);
    expect(pages).toBe(3);
  });

  test('filters by coin, publisher and search text', async () => {
    const eth = await user.c.get('/api/v1/news?asset=eth&limit=50');
    expect(eth.body.articles.length).toBe(12);
    expect(eth.body.articles.every((a: { assets: string[] }) => a.assets.includes('ETH'))).toBe(true);
    const coindesk = await user.c.get('/api/v1/news?publisher=coindesk');
    expect(coindesk.body.articles.map((a: { title: string }) => a.title)).toEqual(['Solana ships an upgrade', 'Bitcoin ETF inflows jump']);
    const search = await user.c.get(`/api/v1/news?q=${encodeURIComponent('stablecoin rules')}&limit=50`);
    expect(search.body.articles).toHaveLength(13);
    const both = await user.c.get('/api/v1/news?q=inflows&asset=BTC');
    expect(both.body.articles.map((a: { title: string }) => a.title)).toEqual(['Bitcoin ETF inflows jump']);
  });

  test('breaking news from the last day', async () => {
    const res = await user.c.get('/api/v1/news/breaking');
    expect(res.body.articles.map((a: { title: string; breaking: boolean }) => [a.title, a.breaking])).toEqual([['Bitcoin ETF inflows jump', true]]);
  });

  test('source status', async () => {
    const res = await user.c.get('/api/v1/news/sources');
    expect(res.body.sources).toEqual([
      expect.objectContaining({ id: 'coindesk', kind: 'rss', status: 'ok', pollIntervalSeconds: 600 }),
      expect.objectContaining({ id: 'cryptocurrency-cv', kind: 'aggregator', status: 'ok' }),
    ]);
    expect(JSON.stringify(res.body)).not.toContain('lastError');
  });

  test('rejects bad parameters', async () => {
    expect((await user.c.get('/api/v1/news?cursor=garbage')).body).toMatchObject({ code: 'VALIDATION_ERROR', fields: { cursor: 'Invalid cursor.' } });
    expect((await user.c.get('/api/v1/news?limit=500')).status).toBe(400);
    expect((await user.c.get('/api/v1/news?asset=%27%3B--')).status).toBe(400);
    expect((await user.c.get('/api/v1/news?q=a')).status).toBe(400);
  });
});
