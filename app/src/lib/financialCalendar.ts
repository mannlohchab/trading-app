import type { EconomicCalendarEvent, EconomicData } from './economics';

export type CalendarEvent = EconomicCalendarEvent;
export type CalendarFeed = EconomicData<CalendarEvent>;
export type CalendarImpact = 'all' | 'high' | 'medium' | 'low';
export type CalendarFilters = { search: string; impact: CalendarImpact; day: string };
export type CalendarView = 'month' | 'week';

/** Calendar arithmetic uses UTC so device timezone and DST cannot shift a date cell. */
export function calendarGrid(day: string, view: CalendarView): (string | null)[] {
  const date = new Date(`${day}T12:00:00Z`);
  if (view === 'week') {
    date.setUTCDate(date.getUTCDate() - date.getUTCDay());
    return Array.from({ length: 7 }, (_, offset) => {
      const cell = new Date(date);
      cell.setUTCDate(cell.getUTCDate() + offset);
      return cell.toISOString().slice(0, 10);
    });
  }
  const year = date.getUTCFullYear(), month = date.getUTCMonth();
  const leading = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Array.from({ length: Math.ceil((leading + count) / 7) * 7 }, (_, index) => {
    const number = index - leading + 1;
    return number < 1 || number > count ? null : new Date(Date.UTC(year, month, number, 12)).toISOString().slice(0, 10);
  });
}

export function moveCalendarDate(day: string, direction: number, view: CalendarView): string {
  const date = new Date(`${day}T12:00:00Z`);
  if (view === 'week') date.setUTCDate(date.getUTCDate() + direction * 7);
  else {
    const number = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + direction);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(number, last));
  }
  return date.toISOString().slice(0, 10);
}

export function calendarTimezone(preferred?: string | null): string {
  try {
    if (preferred) {
      new Intl.DateTimeFormat('en', { timeZone: preferred }).format();
      return preferred;
    }
  } catch { /* Use the device timezone for an invalid legacy preference. */ }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function toDateKey(date: Date, timeZone = calendarTimezone()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

/** Date-only announcements retain the publisher's day; an unknown time is never midnight. */
export function eventDay(event: CalendarEvent, timeZone = calendarTimezone()): string {
  return event.date ? toDateKey(new Date(event.date), timeZone) : event.day ?? 'undated';
}

export function eventTime(event: CalendarEvent, timeZone = calendarTimezone()): string {
  if (event.status === 'holiday') return 'All day';
  if (!event.date) return 'Time TBC';
  return new Date(event.date).toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(day: string): string {
  if (day === 'undated') return 'Date to be confirmed';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
}

export function filterCalendarEvents(events: CalendarEvent[], filters: CalendarFilters, timeZone = calendarTimezone()): CalendarEvent[] {
  const needle = filters.search.trim().toLowerCase();
  const importance = { all: null, high: 3, medium: 2, low: 1 }[filters.impact];
  return events.filter(event =>
    (filters.day === 'all' || eventDay(event, timeZone) === filters.day) &&
    (importance === null || event.importance === importance) &&
    (!needle || `${event.event} ${event.country} ${event.currency ?? ''}`.toLowerCase().includes(needle)));
}

export function calendarSections(events: CalendarEvent[], timeZone = calendarTimezone()) {
  const groups = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = eventDay(event, timeZone);
    const items = groups.get(key) ?? [];
    items.push(event);
    groups.set(key, items);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, data]) => ({
    key, title: dayLabel(key),
    data: data.sort((a, b) => (a.date ?? 'z').localeCompare(b.date ?? 'z') || a.event.localeCompare(b.event)),
  }));
}
