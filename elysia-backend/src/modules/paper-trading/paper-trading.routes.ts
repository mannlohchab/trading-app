// HTTP layer only: validation, session user, ownership-scoped service calls and status codes.
import { Elysia } from 'elysia';
import { z } from 'zod';
import { parseJson, validationError } from '../../http/validation';
import type { UserGuard } from '../identity';
import { PaperError, type PaperErrorCode } from './paper-trading.errors';
import {
  createAccountSchema, listOrdersQuery, listPositionsQuery, listStrategiesQuery, pageQuery, placeOrderSchema, startStrategySchema, stopStrategySchema, updateAccountSchema,
} from './paper-trading.schemas';
import type { PaperTradingServices } from './paper-trading.service';

const STATUS: Record<PaperErrorCode, 400 | 404 | 409 | 422 | 429 | 503> = {
  VALIDATION_ERROR: 400, INVALID_ORDER: 400,
  NOT_FOUND: 404, STRATEGY_NOT_FOUND: 404, UNKNOWN_SYMBOL: 404,
  ACCOUNT_NOT_ACTIVE: 409, NOT_CANCELLABLE: 409, NO_POSITION: 409, STRATEGY_CONFLICT: 409, INVALID_TRANSITION: 409, ACCOUNT_NOT_EMPTY: 409, TOO_MANY_ACCOUNTS: 409,
  INSUFFICIENT_BALANCE: 422, INVALID_STRATEGY: 422, LIMIT_EXCEEDED: 422,
  RATE_LIMITED: 429, STALE_PRICE: 503,
};
const uuid = z.uuid();

function query<S extends z.ZodType>(values: Record<string, string | undefined>, schema: S): { data: z.infer<S> } | { response: Response } {
  const parsed = schema.safeParse(values);
  if (parsed.success) return { data: parsed.data };
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) fields[issue.path.join('.') || '(query)'] ??= issue.message;
  return { response: validationError(fields) };
}

export function paperTradingRoutes(s: PaperTradingServices, requireActiveUser: UserGuard) {
  const r = new Elysia({ prefix: '/api/v1/paper' })
    .resolve(({ request }) => requireActiveUser(request));
  r.onError(({ error, set }) => {
    if (error instanceof PaperError) {
      const { fields, ...details } = error.details as { fields?: unknown };
      set.status = STATUS[error.code];
      return { error: error.message, code: error.code, ...(fields !== undefined && { fields }), ...(Object.keys(details).length && { details }) };
    }
  });
  const id = (params: Record<string, string | undefined>, name = 'id') => {
    const v = params[name];
    if (!v || !uuid.safeParse(v).success) throw new PaperError('NOT_FOUND', 'Not found.');
    return v;
  };

  // ---- Accounts
  r.post('/accounts', async c => {
    const b = await parseJson(c.request, createAccountSchema);
    return 'response' in b ? b.response : Response.json(await s.accounts.create(c.user.id, b.data), { status: 201 });
  }, { parse: 'none' });
  r.get('/accounts', async c => {
    const q = query(c.query, pageQuery);
    return 'response' in q ? q.response : await s.accounts.list(c.user.id, q.data.limit, q.data.offset);
  });
  r.get('/accounts/:id', async c => await s.accounts.get(c.user.id, id(c.params)));
  r.patch('/accounts/:id', async c => {
    const b = await parseJson(c.request, updateAccountSchema);
    return 'response' in b ? b.response : await s.accounts.update(c.user.id, id(c.params), b.data);
  }, { parse: 'none' });
  r.get('/accounts/:id/portfolio', async c => await s.portfolio.summary(c.user.id, id(c.params)));
  r.get('/accounts/:id/transactions', async c => {
    const q = query(c.query, pageQuery);
    return 'response' in q ? q.response : await s.accounts.transactions(c.user.id, id(c.params), q.data.limit, q.data.offset);
  });

  // ---- Orders
  r.post('/orders', async c => {
    const b = await parseJson(c.request, placeOrderSchema);
    if ('response' in b) return b.response;
    const header = c.request.headers.get('idempotency-key');
    if (header && !/^[A-Za-z0-9_.:-]{1,100}$/.test(header)) return validationError({ 'Idempotency-Key': 'Use 1–100 letters, digits or _.:-' });
    const { clientOrderId, type, ...rest } = b.data;
    const { order, duplicate } = await s.orders.place(c.user.id, { ...rest, type, idempotencyKey: clientOrderId ?? header ?? undefined });
    return Response.json(order, { status: duplicate ? 200 : 201 });
  }, { parse: 'none' });
  r.get('/orders', async c => {
    const q = query(c.query, listOrdersQuery);
    return 'response' in q ? q.response : await s.orders.list(c.user.id, q.data);
  });
  r.get('/orders/:id', async c => await s.orders.get(c.user.id, id(c.params)));
  r.post('/orders/:id/cancel', async c => await s.orders.cancel(c.user.id, id(c.params)), { parse: 'none' });

  // ---- Positions
  r.get('/positions', async c => {
    const q = query(c.query, listPositionsQuery);
    return 'response' in q ? q.response : await s.positions.list(c.user.id, q.data);
  });
  r.get('/positions/:id', async c => await s.positions.get(c.user.id, id(c.params)));
  r.post('/positions/:id/close', async c => await s.positions.close(c.user.id, id(c.params)), { parse: 'none' });

  // ---- Automated strategies. `/strategies/:id/start` takes a saved strategy id; the others an instance id.
  r.post('/strategies/:id/start', async c => {
    const b = await parseJson(c.request, startStrategySchema);
    if ('response' in b) return b.response;
    const { accountId, ...rest } = b.data;
    return Response.json(await s.strategies.start(c.user.id, id(c.params), { accountId, ...rest }), { status: 201 });
  }, { parse: 'none' });
  r.get('/strategies', async c => {
    const q = query(c.query, listStrategiesQuery);
    return 'response' in q ? q.response : await s.strategies.list(c.user.id, q.data);
  });
  r.get('/strategies/:id', async c => await s.strategies.get(c.user.id, id(c.params)));
  r.post('/strategies/:id/pause', async c => await s.strategies.transition(c.user.id, id(c.params), 'pause'), { parse: 'none' });
  r.post('/strategies/:id/resume', async c => await s.strategies.transition(c.user.id, id(c.params), 'resume'), { parse: 'none' });
  r.post('/strategies/:id/stop', async c => {
    const raw = await c.request.text();
    let body: unknown;
    try { body = raw ? JSON.parse(raw) : {}; }
    catch { return Response.json({ error: 'Request body must be JSON.', code: 'INVALID_JSON' }, { status: 400 }); }
    const parsed = stopStrategySchema.safeParse(body);
    if (!parsed.success) return validationError({ closePosition: 'Must be a boolean.' });
    return await s.strategies.transition(c.user.id, id(c.params), 'stop', parsed.data);
  }, { parse: 'none' });

  return r;
}
