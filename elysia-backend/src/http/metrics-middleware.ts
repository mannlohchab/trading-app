import { Elysia } from 'elysia';

type RecordHttp = (method: string, route: string, status: number, seconds: number) => void;

/** Weak keys keep timing isolated between concurrent requests, including streaming responses. */
export function httpMetrics(record: RecordHttp) {
  const started = new WeakMap<Request, number>();
  return new Elysia()
    .onRequest(({ request }) => { started.set(request, performance.now()); })
    .onAfterResponse({ as: 'global' }, ({ request, route, response, set }) => {
      const start = started.get(request);
      if (start === undefined) return;
      started.delete(request);
      const status = response instanceof Response ? response.status : typeof set.status === 'number' ? set.status : 200;
      record(request.method, route && route !== '/*' ? route : 'unmatched', status, (performance.now() - start) / 1000);
    });
}
