import { Hono, type MiddlewareHandler } from 'hono';
import type { AuthVariables } from '../../identity';
import type { CalendarService } from '../application/calendar.service';
import { CalendarUnavailableError } from '../domain/calendar';

export function calendarRoutes(deps: { service: CalendarService; requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }> }) {
  const routes = new Hono<{ Variables: AuthVariables }>().basePath('/api/v1/calendar');
  routes.use('*', deps.requireActiveUser);
  routes.get('/', async c => {
    c.header('Cache-Control', 'private, no-store');
    try { return c.json(await deps.service.getWeek()); }
    catch (error) {
      if (error instanceof CalendarUnavailableError) return c.json({ error: error.message, code: error.code }, 503);
      throw error;
    }
  });
  return routes;
}
