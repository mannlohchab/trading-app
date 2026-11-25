import { api } from './api';
import type { CalendarFeed } from './financialCalendar';

export function fetchFinancialCalendar(signal?: AbortSignal): Promise<CalendarFeed> {
  return api<CalendarFeed>('/api/v1/calendar', { signal });
}
