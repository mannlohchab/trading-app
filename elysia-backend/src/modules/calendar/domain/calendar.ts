export type CalendarEvent = {
  id: string; event: string; country: string; currency: string | null;
  day: string | null; date: string | null; estimated: boolean;
  actual: string | null; forecast: string | null; previous: string | null;
  unit: string | null; reference: string | null; importance: number | null;
  status: string | null; source: string; url: string; sourceUrl: string;
  updatedAt: string | null; dataStale: boolean;
};

export type CalendarFeed = {
  items: CalendarEvent[]; source: string; sourceUrl: string; fetchedAt: string;
  stale: boolean; isDemo: boolean; notice: string;
};

export const CALENDAR_SOURCE = 'Forex Factory';
export const CALENDAR_SOURCE_URL = 'https://www.forexfactory.com/calendar';

// Holiday rows carry an offset timestamp even though their UI meaning is a market-local day.
const MARKET_TIMEZONES: Record<string, string> = {
  USD: 'America/New_York', CAD: 'America/Toronto', GBP: 'Europe/London', EUR: 'Europe/Brussels',
  CHF: 'Europe/Zurich', JPY: 'Asia/Tokyo', CNY: 'Asia/Shanghai', AUD: 'Australia/Sydney', NZD: 'Pacific/Auckland',
};

export class CalendarUnavailableError extends Error {
  readonly code = 'CALENDAR_UNAVAILABLE';
  constructor() { super('The calendar is temporarily unavailable. Please try again shortly.'); }
}

function value(input: unknown): string | null {
  if (typeof input === 'number' && Number.isFinite(input)) return String(input);
  return typeof input === 'string' && input.trim() ? input.trim() : null;
}

function validDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
}

/** The feed's `country` field is a currency code, not an ISO country code. */
export function normalizeWeek(input: unknown): CalendarEvent[] {
  if (!Array.isArray(input) || input.length > 2000) throw new CalendarUnavailableError();
  const events = new Map<string, CalendarEvent>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CalendarUnavailableError();
    const row = raw as Record<string, unknown>;
    const title = value(row.title), currency = value(row.country), published = value(row.date);
    if (!title || title.length > 500 || !currency || !/^[A-Z]{3}$/.test(currency)) throw new CalendarUnavailableError();
    const impact = value(row.impact)?.toLowerCase();
    let day: string | null = null;
    let date: string | null = null;
    if (published) {
      day = published.slice(0, 10);
      if (!validDay(day)) throw new CalendarUnavailableError();
      if (published.length > 10) {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(published) || !Number.isFinite(Date.parse(published))) throw new CalendarUnavailableError();
        if (impact !== 'holiday') date = new Date(published).toISOString();
        else if (MARKET_TIMEZONES[currency]) {
          const parts = new Intl.DateTimeFormat('en', { timeZone: MARKET_TIMEZONES[currency], year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(published));
          day = ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
        }
      }
    }
    const id = JSON.stringify([currency, published, title]);
    events.set(id, {
      id, event: title, country: currency, currency, day, date, estimated: date === null,
      actual: value(row.actual), forecast: value(row.forecast), previous: value(row.previous),
      importance: impact === 'high' ? 3 : impact === 'medium' ? 2 : impact === 'low' ? 1 : null,
      status: impact === 'holiday' ? 'holiday' : null,
      unit: null, reference: null, source: CALENDAR_SOURCE, url: CALENDAR_SOURCE_URL,
      sourceUrl: CALENDAR_SOURCE_URL, updatedAt: null, dataStale: false,
    });
  }
  return [...events.values()].sort((a, b) => (a.date ?? a.day ?? 'z').localeCompare(b.date ?? b.day ?? 'z') || a.event.localeCompare(b.event));
}
