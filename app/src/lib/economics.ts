export type EconomicsMode = 'Calendar' | 'Indicators' | 'News';
export type EconomicCalendarEvent = {
  id: string; event: string; country: string; currency: string | null; day: string | null; date: string | null;
  estimated: boolean; actual: string | null; forecast: string | null; previous: string | null; unit: string | null;
  reference: string | null; importance: number | null; status: string | null; source: string | null;
  url: string | null; sourceUrl: string | null; updatedAt: string | null; dataStale: boolean;
};
export type EconomicIndicator = {
  id: string; country: string; name: string; latest: string; period: string; previous: string | null;
  previousPeriod: string | null; unit: string; url: string;
};
export type EconomicNews = { id: string; title: string; url: string; publisher: string; date: string | null; country: string | null };
export type EconomicData<T> = { items: T[]; source: string; sourceUrl: string; fetchedAt: string; stale: boolean; isDemo: boolean; notice: string; truncated?: boolean };
export function economicValue(value: string | number | null | undefined) { return value === null || value === undefined || value === '' ? '—' : String(value); }
export function calendarDate(offset: number, now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
  return date.toISOString().slice(0, 10);
}
export function economicTime(date: string | null, day?: string | null) {
  if (!date) return day ? `${day} · Time not confirmed` : 'Time not confirmed';
  const value = new Date(date);
  return Number.isFinite(value.getTime()) ? value.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'Time not confirmed';
}
