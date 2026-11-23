import { Elysia } from 'elysia';
import type { UserGuard } from '../../identity';
import type { CalendarService } from '../application/calendar.service';
import { CalendarUnavailableError } from '../domain/calendar';

export function calendarRoutes(deps: { service: CalendarService; requireActiveUser: UserGuard }) {
  const routes = new Elysia({ prefix: '/api/v1/calendar' }).resolve(({ request }) => deps.requireActiveUser(request));

  routes.get('/', async c => {
    c.set.headers['Cache-Control'] = 'private, no-store';
    try { return await deps.service.getWeek(); }
    catch (error) {
      if (error instanceof CalendarUnavailableError) return Response.json({ error: error.message, code: error.code }, { status: 503 });
      throw error;
    }
  }, { parse: 'none' });
  return routes;
}
