// Ports for the news module. Each news provider (aggregator API, RSS feed, …) is one `NewsSource`;
// storage and scheduling sit behind the repository.
import type { NewsArticle, NewsArticleDraft, RawNewsItem } from '../domain/article';

export type NewsSourceKind = 'rss' | 'aggregator';

export interface NewsSource {
  /** Stable id stored with articles and source state, e.g. "coindesk". */
  readonly id: string;
  readonly name: string;
  readonly kind: NewsSourceKind;
  /** How often the source is polled. */
  readonly intervalMs: number;
  /** Latest items. Throws `NewsSourceUnavailableError` when the source can't be read. */
  fetchLatest(): Promise<RawNewsItem[]>;
}

export type SourceState = {
  id: string;
  nextRunAt: Date;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
  lastItemCount: number | null;
};

export type PollOutcome =
  | { ok: true; at: Date; itemCount: number }
  | { ok: false; at: Date; error: string };

export type ArticleQuery = {
  limit: number;
  /** Keyset cursor: articles strictly older than this (published_at, id). */
  before?: { publishedAt: Date; id: string };
  asset?: string;
  publisherKey?: string;
  /** Full-text search over title and summary. */
  search?: string;
  breakingSince?: Date;
};

export interface NewsRepository {
  /** Inserts new articles and merges repeats (providers, coins, breaking flag, missing fields). Returns how many were new. */
  upsert(articles: NewsArticleDraft[]): Promise<{ inserted: number; updated: number }>;
  list(query: ArticleQuery): Promise<NewsArticle[]>;
  /** Deletes articles published before `cutoff`. */
  pruneBefore(cutoff: Date): Promise<number>;
  /** Registers `source` (if new) and makes sure its next poll is queued. Idempotent across processes. */
  ensureScheduled(source: { id: string; name: string; kind: NewsSourceKind }, firstRunAt: Date): Promise<SourceState>;
  getState(id: string): Promise<SourceState | null>;
  listStates(): Promise<(SourceState & { name: string; kind: string })[]>;
  /**
   * Records a poll and queues the next one, but only if the source is still due at `expectedRunAt`
   * (another worker may have handled it). Returns false when it was not.
   */
  completePoll(id: string, expectedRunAt: Date, outcome: PollOutcome, nextRunAt: Date): Promise<boolean>;
}

export interface Clock {
  now(): Date;
}

export type Log = (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void;
