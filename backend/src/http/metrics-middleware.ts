import type { MiddlewareHandler } from 'hono';
import { matchedRoutes } from 'hono/route';

type RecordHttp = (method: string, route: string, status: number, seconds: number) => void;

/** Records count and latency per route pattern (e.g. /api/v1/news/:id), never per raw path. */
export function httpMetrics(record: RecordHttp): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    try {
      await next();
    } finally {
      const responder = matchedRoutes(c)[c.req.routeIndex];
      // No route answered (404) when the responder is a catch-all middleware.
      const route = responder && responder.path !== '*' && responder.path !== '/*' ? responder.path : 'unmatched';
      record(c.req.method, route, c.res.status, (performance.now() - started) / 1000);
    }
  };
}
