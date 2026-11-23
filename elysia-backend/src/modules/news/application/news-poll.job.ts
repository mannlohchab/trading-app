// Background job `news.poll` {sourceId, runAt}: one queued poll per source. Each poll queues the next,
// so the schedule lives in Postgres and survives restarts.
import { RetryableJobError, type JobHandler } from '../../system/jobs';
import { NEWS_POLL_JOB, type NewsIngestionService } from './news-ingestion.service';

export function newsPollJobHandler(ingestion: NewsIngestionService): JobHandler {
  return {
    type: NEWS_POLL_JOB,
    async handle(job) {
      const { sourceId, runAt } = job.payload as { sourceId?: unknown; runAt?: unknown };
      if (typeof sourceId !== 'string' || typeof runAt !== 'string' || Number.isNaN(Date.parse(runAt))) return 'CANCELLED';
      try {
        await ingestion.poll(sourceId, new Date(runAt));
      } catch (error) {
        // Source failures are handled inside poll(); what reaches here is our own storage failing
        // (e.g. the database is briefly unreachable), which is worth retrying.
        throw new RetryableJobError(error instanceof Error ? error.message : String(error));
      }
      return 'COMPLETED';
    },
  };
}
