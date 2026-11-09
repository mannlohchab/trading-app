// Polls news sources and stores what they return. Polls are scheduled in Postgres (one queued job per
// source), so any number of API/worker processes share one schedule and one upstream request budget.
import { nextPollDelayMs, normalizeBatch } from '../domain/article';
import { NewsSourceUnavailableError } from './errors';
import type { Clock, Log, NewsRepository, NewsSource } from './ports';

export const NEWS_POLL_JOB = 'news.poll';

export class NewsIngestionService {
  constructor(private readonly deps: {
    sources: NewsSource[];
    repository: NewsRepository;
    clock: Clock;
    log: Log;
    /** Articles older than this are deleted after each successful poll. */
    retentionMs: number;
  }) {}

  get sources() { return this.deps.sources; }

  /** Registers every configured source and queues its next poll (new sources poll right away). */
  async scheduleAll() {
    const now = this.deps.clock.now();
    for (const source of this.deps.sources) await this.deps.repository.ensureScheduled(source, now);
  }

  /**
   * Runs the poll queued for `sourceId` at `runAt`. Never throws for source failures: they are recorded
   * and the next poll is queued with back-off. Returns what happened, for logs and tests.
   */
  async poll(sourceId: string, runAt: Date): Promise<'polled' | 'failed' | 'stale' | 'unknown-source'> {
    const { repository, clock, log } = this.deps;
    const source = this.deps.sources.find(s => s.id === sourceId);
    // A source that was removed from configuration simply stops being polled.
    if (!source) return 'unknown-source';
    const state = await repository.getState(sourceId);
    // Another worker already ran (or rescheduled) this poll: this job is a leftover duplicate.
    if (!state || state.nextRunAt.getTime() !== runAt.getTime()) return 'stale';

    let items;
    try {
      items = await source.fetchLatest();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failures = state.consecutiveFailures + 1;
      const retryAfter = error instanceof NewsSourceUnavailableError ? error.retryAfterMs : undefined;
      const at = clock.now();
      const next = new Date(at.getTime() + nextPollDelayMs(source.intervalMs, failures, retryAfter));
      await repository.completePoll(sourceId, runAt, { ok: false, at, error: message }, next);
      log(failures === 1 || Number.isInteger(Math.log2(failures)) ? 'warn' : 'info', 'News source failed', { source: sourceId, consecutiveFailures: failures, error: message, nextRunAt: next.toISOString() });
      return 'failed';
    }

    const at = clock.now();
    const articles = normalizeBatch(items, source.id, at);
    const { inserted, updated } = articles.length ? await repository.upsert(articles) : { inserted: 0, updated: 0 };
    const pruned = await repository.pruneBefore(new Date(at.getTime() - this.deps.retentionMs));
    const next = new Date(at.getTime() + nextPollDelayMs(source.intervalMs, 0));
    await repository.completePoll(sourceId, runAt, { ok: true, at, itemCount: items.length }, next);
    if (state.consecutiveFailures > 0) log('info', 'News source recovered', { source: sourceId });
    log('info', 'News source polled', { source: sourceId, items: items.length, kept: articles.length, inserted, updated, pruned });
    return 'polled';
  }
}
