import type { MiddlewareHandler } from 'hono';
import type { AuthVariables } from '../identity';
import { CalendarService, type CalendarOptions } from './application/calendar.service';
import { calendarRoutes } from './http/calendar.routes';

export type { CalendarRequest } from './application/calendar.service';
export function createCalendarModule(deps: CalendarOptions & { requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }> }) {
  const service = new CalendarService(deps);
  return { service, routes: calendarRoutes({ service, requireActiveUser: deps.requireActiveUser }) };
}
export type CalendarModule = ReturnType<typeof createCalendarModule>;
