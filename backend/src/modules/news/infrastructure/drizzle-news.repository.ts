import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { newsArticles, newsSources } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { PostgresJobQueue } from '../../system/jobs';
import type { NewsArticle, NewsArticleDraft } from '../domain/article';
import { NEWS_POLL_JOB } from '../application/news-ingestion.service';
import type { ArticleQuery, NewsRepository, NewsSourceKind, PollOutcome, SourceState } from '../application/ports';

const A = newsArticles;
const S = newsSources;

// Union of two text arrays, sorted and without duplicates.
const union = (current: SQL, incoming: SQL) => sql`ARRAY(SELECT DISTINCT v FROM unnest(${current} || ${incoming}) AS v ORDER BY v)`;

const articleColumns = {
  id: A.id, url: A.url, title: A.title, summary: A.summary, imageUrl: A.imageUrl, author: A.author, publisher: A.publisher,
  publisherKey: A.publisherKey, publishedAt: A.publishedAt, breakingAt: A.breakingAt, categories: A.categories, assets: A.assets,
  providers: A.providers, firstSeenAt: A.createdAt,
};

const toState = (row: typeof S.$inferSelect): SourceState => ({
  id: row.id, nextRunAt: row.nextRunAt, lastAttemptAt: row.lastAttemptAt, lastSuccessAt: row.lastSuccessAt,
  consecutiveFailures: row.consecutiveFailures, lastItemCount: row.lastItemCount,
});

/** One queued poll per (source, scheduled time): the dedupe key makes repeated enqueues collapse. */
const pollJob = (sourceId: string, runAt: Date) => ({
  type: NEWS_POLL_JOB,
  payload: { sourceId, runAt: runAt.toISOString() },
  availableAt: runAt,
  maxAttempts: 3,
  dedupeKey: `${sourceId}@${runAt.getTime()}`,
});

export class DrizzleNewsRepository implements NewsRepository {
  constructor(private readonly db: AppDatabase, private readonly queue: PostgresJobQueue) {}

  async upsert(articles: NewsArticleDraft[]) {
    const excluded = (column: string) => sql.raw(`excluded.${column}`);
    const rows = await this.db.insert(A).values(articles.map(a => ({
      canonicalUrl: a.canonicalUrl, url: a.url, title: a.title, summary: a.summary, imageUrl: a.imageUrl, author: a.author,
      publisher: a.publisher, publisherKey: a.publisherKey, publishedAt: a.publishedAt, breakingAt: a.breakingAt,
      categories: a.categories, assets: a.assets, providers: a.providers, metadata: a.metadata,
    }))).onConflictDoUpdate({
      target: A.canonicalUrl,
      // The first source to deliver a story keeps its title and link; later ones add what was missing.
      set: {
        providers: union(sql`${A.providers}`, excluded('providers')),
        assets: union(sql`${A.assets}`, excluded('assets')),
        categories: sql`(${union(sql`${A.categories}`, excluded('categories'))})[1:10]`,
        breakingAt: sql`coalesce(${A.breakingAt}, ${excluded('breaking_at')})`,
        summary: sql`coalesce(${A.summary}, ${excluded('summary')})`,
        imageUrl: sql`coalesce(${A.imageUrl}, ${excluded('image_url')})`,
        author: sql`coalesce(${A.author}, ${excluded('author')})`,
        publishedAt: sql`least(${A.publishedAt}, ${excluded('published_at')})`,
        metadata: sql`${A.metadata} || ${excluded('metadata')}`,
      },
      // Feeds list the same stories on every poll: only touch a row when the repeat adds something.
      setWhere: sql`NOT (
        ${A.providers} @> ${excluded('providers')} AND ${A.assets} @> ${excluded('assets')}
        AND (${excluded('breaking_at')} IS NULL OR ${A.breakingAt} IS NOT NULL)
        AND (${excluded('summary')} IS NULL OR ${A.summary} IS NOT NULL)
        AND (${excluded('image_url')} IS NULL OR ${A.imageUrl} IS NOT NULL)
        AND (${excluded('author')} IS NULL OR ${A.author} IS NOT NULL)
        AND ${A.publishedAt} <= ${excluded('published_at')}
        AND ${A.metadata} @> ${excluded('metadata')}
      )`,
    }).returning({ inserted: sql<boolean>`(xmax = 0)` });
    const inserted = rows.filter(r => r.inserted).length;
    return { inserted, updated: rows.length - inserted };
  }

  async list(query: ArticleQuery): Promise<NewsArticle[]> {
    const conditions: SQL[] = [];
    // Raw SQL bypasses column mapping, and postgres.js rejects Date parameters: pass ISO strings.
    if (query.before) conditions.push(sql`(${A.publishedAt}, ${A.id}) < (${query.before.publishedAt.toISOString()}::timestamptz, ${query.before.id}::uuid)`);
    if (query.asset) conditions.push(sql`${A.assets} @> ARRAY[${query.asset}]::text[]`);
    if (query.publisherKey) conditions.push(eq(A.publisherKey, query.publisherKey));
    if (query.search) conditions.push(sql`${A.search} @@ websearch_to_tsquery('english', ${query.search})`);
    if (query.breakingSince) conditions.push(gte(A.breakingAt, query.breakingSince));
    return this.db.select(articleColumns).from(A)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(A.publishedAt), desc(A.id))
      .limit(query.limit);
  }

  async pruneBefore(cutoff: Date) {
    const rows = await this.db.delete(A).where(lt(A.publishedAt, cutoff)).returning({ id: A.id });
    return rows.length;
  }

  async ensureScheduled(source: { id: string; name: string; kind: NewsSourceKind }, firstRunAt: Date) {
    return this.db.transaction(async tx => {
      // Concurrent processes insert the same row; whoever loses reads the winner's schedule.
      const [row] = await tx.insert(S).values({ id: source.id, name: source.name, kind: source.kind, nextRunAt: firstRunAt })
        .onConflictDoUpdate({ target: S.id, set: { name: source.name, kind: source.kind } })
        .returning();
      await this.queue.enqueue(pollJob(row!.id, row!.nextRunAt), tx);
      return toState(row!);
    });
  }

  async getState(id: string) {
    const [row] = await this.db.select().from(S).where(eq(S.id, id));
    return row ? toState(row) : null;
  }

  async listStates() {
    const rows = await this.db.select().from(S);
    return rows.map(row => ({ ...toState(row), name: row.name, kind: row.kind }));
  }

  async completePoll(id: string, expectedRunAt: Date, outcome: PollOutcome, nextRunAt: Date) {
    return this.db.transaction(async tx => {
      const [row] = await tx.update(S).set({
        nextRunAt,
        lastAttemptAt: outcome.at,
        ...(outcome.ok
          ? { lastSuccessAt: outcome.at, lastError: null, consecutiveFailures: 0, lastItemCount: outcome.itemCount }
          : { lastError: outcome.error.slice(0, 1000), consecutiveFailures: sql`${S.consecutiveFailures} + 1` }),
      }).where(and(eq(S.id, id), eq(S.nextRunAt, expectedRunAt))).returning({ id: S.id });
      if (!row) return false;
      await this.queue.enqueue(pollJob(id, nextRunAt), tx);
      return true;
    });
  }
}
