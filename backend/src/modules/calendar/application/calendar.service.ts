import { CALENDAR_SOURCE, CALENDAR_SOURCE_URL, CalendarUnavailableError, normalizeWeek, type CalendarFeed } from '../domain/calendar';

export type CalendarRequest = (url: string, init?: RequestInit) => Promise<Response>;
export type CalendarOptions = { request?: CalendarRequest; now?: () => number };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

/** One shared weekly fetch per API process. User filters never multiply upstream requests. */
export class CalendarService {
  private readonly now: () => number;
  private readonly request: CalendarRequest;
  private saved?: { at: number; feed: CalendarFeed };
  private pending?: Promise<CalendarFeed>;
  private retryAt = 0;

  constructor(options: CalendarOptions = {}) {
    this.now = options.now ?? Date.now;
    this.request = options.request ?? fetch;
  }

  async getWeek(): Promise<CalendarFeed> {
    if (this.saved && this.now() - this.saved.at < HOUR) return this.saved.feed;
    if (this.pending) return this.pending;
    if (this.now() < this.retryAt) return this.staleOrThrow();
    this.pending = this.load().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private staleOrThrow(): CalendarFeed {
    if (this.saved && this.now() - this.saved.at <= DAY) return { ...this.saved.feed, stale: true };
    throw new CalendarUnavailableError();
  }

  private async load(): Promise<CalendarFeed> {
    try {
      const response = await this.request(FEED_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) {
        const retry = response.headers.get('Retry-After');
        const seconds = retry === null ? NaN : Number(retry);
        const delay = Number.isFinite(seconds) ? seconds * 1000 : retry ? Date.parse(retry) - this.now() : 0;
        const minimum = response.status === 429 ? 15 * 60_000 : 60_000;
        this.retryAt = this.now() + Math.min(DAY, Math.max(minimum, Number.isFinite(delay) ? delay : 0));
        throw new CalendarUnavailableError();
      }
      const items = normalizeWeek(await response.json());
      const at = this.now();
      const feed: CalendarFeed = {
        items, source: CALENDAR_SOURCE, sourceUrl: CALENDAR_SOURCE_URL,
        fetchedAt: new Date(at).toISOString(), stale: false, isDemo: false,
        notice: 'Published weekly schedule. Times may change. Forecast and previous values are supplied when available; actual results may be unavailable.',
      };
      this.saved = { at, feed };
      this.retryAt = 0;
      return feed;
    } catch {
      this.retryAt = Math.max(this.retryAt, this.now() + 60_000);
      return this.staleOrThrow();
    }
  }
}
