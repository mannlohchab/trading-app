// HTTP layer: validation, auth and status codes only; all logic is in BacktestingService.
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { parseJson, validationError } from '../../http/validation';
import type { AuthVariables } from '../identity';
import { BacktestError, type BacktestErrorCode, type BacktestingService } from './backtesting.service';
import { createBacktestSchema, equityQuery, listBacktestsQuery, previewBacktestSchema, tradesQuery } from './backtesting.schemas';

type C = Context<{ Variables: AuthVariables }>;

const STATUS: Record<BacktestErrorCode, 400 | 404 | 409 | 422 | 429 | 503> = {
  VALIDATION_ERROR: 400, RANGE_TOO_LARGE: 400, INSUFFICIENT_DATA: 422, DATA_GAPS: 422, INVALID_STRATEGY: 422, ENGINE_ERROR: 422,
  NOT_FOUND: 404, STRATEGY_NOT_FOUND: 404, UNKNOWN_SYMBOL: 404,
  NOT_CANCELLABLE: 409, TOO_MANY_ACTIVE: 429, BUSY: 503, MARKET_DATA_UNAVAILABLE: 503,
};
const uuid = z.uuid();

function query<S extends z.ZodType>(c: C, schema: S): { data: z.infer<S> } | { response: Response } {
  const parsed = schema.safeParse(c.req.query());
  if (parsed.success) return { data: parsed.data };
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) fields[issue.path.join('.') || '(query)'] ??= issue.message;
  return { response: validationError(c, fields) };
}

export function backtestingRoutes(service: BacktestingService, requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }>) {
  const routes = new Hono<{ Variables: AuthVariables }>().basePath('/api/v1/backtests');
  routes.use('*', requireActiveUser);
  routes.onError((error, c) => {
    if (error instanceof BacktestError) {
      const { fields, ...details } = error.details as { fields?: unknown };
      return c.json({ error: error.message, code: error.code, ...(fields !== undefined && { fields }), ...(Object.keys(details).length && { details }) }, STATUS[error.code]);
    }
    throw error;
  });
  const id = (c: C) => {
    const value = c.req.param('id');
    if (!value || !uuid.safeParse(value).success) throw new BacktestError('NOT_FOUND', 'Backtest not found.');
    return value;
  };

  // The user is always the session's; nothing in a request body can choose it.
  routes.post('/', async c => {
    const body = await parseJson(c, createBacktestSchema);
    if ('response' in body) return body.response;
    return c.json(await service.create(c.var.user.id, body.data), 202);
  });

  routes.post('/preview', async c => {
    const body = await parseJson(c, previewBacktestSchema);
    if ('response' in body) return body.response;
    return c.json(await service.preview(c.var.user.id, body.data));
  });

  routes.get('/', async c => {
    const q = query(c, listBacktestsQuery);
    if ('response' in q) return q.response;
    return c.json(await service.list(c.var.user.id, { ...q.data, before: q.data.before ? new Date(q.data.before) : undefined }));
  });

  routes.get('/:id', async c => c.json(await service.get(c.var.user.id, id(c))));

  routes.get('/:id/trades', async c => {
    const q = query(c, tradesQuery);
    if ('response' in q) return q.response;
    return c.json(await service.trades(c.var.user.id, id(c), q.data.limit, q.data.offset));
  });

  routes.get('/:id/equity-curve', async c => {
    const q = query(c, equityQuery);
    if ('response' in q) return q.response;
    return c.json(await service.equityCurve(c.var.user.id, id(c), q.data.maxPoints));
  });

  routes.post('/:id/cancel', async c => c.json(await service.cancel(c.var.user.id, id(c))));

  return routes;
}
