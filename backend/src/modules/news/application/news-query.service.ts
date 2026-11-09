// Read side of the news module: everything is served from Postgres, never from a source directly, so
// user traffic never spends the sources' rate limits.
import { sourceHealth, type NewsArticle } from '../domain/article';
import { InvalidNewsQueryError } from './errors';
import type { Clock, NewsRepository, NewsSource } from './ports';

export const PAGE = { default: 20, max: 50 } as const;
const BREAKING_WINDOW_MS = 24 * 3_600_000;

export type ArticleView = {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  imageUrl: string | null;
  author: string | null;
  publisher: { key: string; name: string };
  publishedAt: string;
  assets: string[];
  categories: string[];
  breaking: boolean;
  sources: string[];
};

export type ArticlePage = { articles: ArticleView[]; nextCursor: string | null };

const view = (a: NewsArticle): ArticleView => ({
  id: a.id, title: a.title, summary: a.summary, url: a.url, imageUrl: a.imageUrl, author: a.author,
  publisher: { key: a.publisherKey, name: a.publisher }, publishedAt: a.publishedAt.toISOString(),
  assets: a.assets, categories: a.categories, breaking: a.breakingAt !== null, sources: a.providers,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opaque keyset cursor: base64url("<publishedAt ms>.<id>"). Stable while new articles arrive. */
export const encodeCursor = (a: { publishedAt: Date; id: string }) => Buffer.from(`${a.publishedAt.getTime()}.${a.id}`).toString('base64url');

export function decodeCursor(cursor: string): { publishedAt: Date; id: string } {
  const [ms, id] = Buffer.from(cursor, 'base64url').toString().split('.');
  const time = Number(ms);
  if (!Number.isSafeInteger(time) || !id || !UUID.test(id)) throw new InvalidNewsQueryError('cursor', 'Invalid cursor.');
  return { publishedAt: new Date(time), id };
}

export class NewsQueryService {
  constructor(private readonly deps: { repository: NewsRepository; sources: NewsSource[]; clock: Clock }) {}

  /** Newest first. Filters combine: coin (e.g. "BTC"), publisher key (e.g. "coindesk") and search text. */
  async list(input: { limit?: number; cursor?: string; asset?: string; publisher?: string; q?: string }): Promise<ArticlePage> {
    const limit = Math.min(input.limit ?? PAGE.default, PAGE.max);
    const search = input.q?.trim();
    const rows = await this.deps.repository.list({
      limit: limit + 1,
      before: input.cursor ? decodeCursor(input.cursor) : undefined,
      asset: input.asset?.trim().toUpperCase() || undefined,
      publisherKey: input.publisher?.trim().toLowerCase() || undefined,
      search: search || undefined,
    });
    const page = rows.slice(0, limit);
    return { articles: page.map(view), nextCursor: rows.length > limit ? encodeCursor(page.at(-1)!) : null };
  }

  /** Stories the aggregator flagged as breaking in the last 24 hours, newest first. */
  async breaking(limit = 10): Promise<ArticleView[]> {
    const since = new Date(this.deps.clock.now().getTime() - BREAKING_WINDOW_MS);
    return (await this.deps.repository.list({ limit: Math.min(limit, PAGE.max), breakingSince: since })).map(view);
  }

  /** Configured sources and whether their last poll worked. Error text stays in the server log. */
  async sources() {
    const states = new Map((await this.deps.repository.listStates()).map(s => [s.id, s]));
    return this.deps.sources.map(source => {
      const state = states.get(source.id);
      return {
        id: source.id,
        name: source.name,
        kind: source.kind,
        pollIntervalSeconds: Math.round(source.intervalMs / 1000),
        status: state ? sourceHealth(state) : 'pending',
        lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
        nextPollAt: state?.nextRunAt.toISOString() ?? null,
      };
    });
  }
}
