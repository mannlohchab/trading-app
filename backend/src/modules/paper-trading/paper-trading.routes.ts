// HTTP layer only: validation, session user, ownership-scoped service calls and status codes.
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { parseJson, validationError } from '../../http/validation';
import type { AuthVariables } from '../identity';
import { PaperError, type PaperErrorCode } from './paper-trading.errors';
import {
  createAccountSchema, listOrdersQuery, listPositionsQuery, listStrategiesQuery, pageQuery, placeOrderSchema, startStrategySchema, stopStrategySchema, updateAccountSchema,
} from './paper-trading.schemas';
import type { PaperTradingServices } from './paper-trading.service';

type C = Context<{ Variables: AuthVariables }>;
const STATUS: Record<PaperErrorCode, 400 | 404 | 409 | 422 | 429 | 503> = {
  VALIDATION_ERROR: 400, INVALID_ORDER: 400,
  NOT_FOUND: 404, STRATEGY_NOT_FOUND: 404, UNKNOWN_SYMBOL: 404,
  ACCOUNT_NOT_ACTIVE: 409, NOT_CANCELLABLE: 409, NO_POSITION: 409, STRATEGY_CONFLICT: 409, INVALID_TRANSITION: 409, ACCOUNT_NOT_EMPTY: 409, TOO_MANY_ACCOUNTS: 409,
  INSUFFICIENT_BALANCE: 422, INVALID_STRATEGY: 422, LIMIT_EXCEEDED: 422,
  RATE_LIMITED: 429, STALE_PRICE: 503,
};
const uuid = z.uuid();

function query<S extends z.ZodType>(c: C, schema: S): { data: z.infer<S> } | { response: Response } {
  const parsed = schema.safeParse(c.req.query());
  if (parsed.success) return { data: parsed.data };
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) fields[issue.path.join('.') || '(query)'] ??= issue.message;
  return { response: validationError(c, fields) };
}

export function paperTradingRoutes(s: PaperTradingServices, requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }>) {
  const r = new Hono<{ Variables: AuthVariables }>().basePath('/api/v1/paper');
  r.use('*', requireActiveUser);
  r.onError((error, c) => {
    if (error instanceof PaperError) {
      const { fields, ...details } = error.details as { fields?: unknown };
      return c.json({ error: error.message, code: error.code, ...(fields !== undefined && { fields }), ...(Object.keys(details).length && { details }) }, STATUS[error.code]);
    }
    throw error;
  });
  const id = (c: C, name = 'id') => {
    const v = c.req.param(name);
    if (!v || !uuid.safeParse(v).success) throw new PaperError('NOT_FOUND', 'Not found.');
    return v;
  };
  const user = (c: C) => c.var.user.id; // always the session's user

  // ---- Accounts
  r.post('/accounts', async c => {
    const b = await parseJson(c, createAccountSchema);
    return 'response' in b ? b.response : c.json(await s.accounts.create(user(c), b.data), 201);
  });
  r.get('/accounts', async c => {
    const q = query(c, pageQuery);
    return 'response' in q ? q.response : c.json(await s.accounts.list(user(c), q.data.limit, q.data.offset));
  });
  r.get('/accounts/:id', async c => c.json(await s.accounts.get(user(c), id(c))));
  r.patch('/accounts/:id', async c => {
    const b = await parseJson(c, updateAccountSchema);
    return 'response' in b ? b.response : c.json(await s.accounts.update(user(c), id(c), b.data));
  });
  r.get('/accounts/:id/portfolio', async c => c.json(await s.portfolio.summary(user(c), id(c))));
  r.get('/accounts/:id/transactions', async c => {
    const q = query(c, pageQuery);
    return 'response' in q ? q.response : c.json(await s.accounts.transactions(user(c), id(c), q.data.limit, q.data.offset));
  });

  // ---- Orders
  r.post('/orders', async c => {
    const b = await parseJson(c, placeOrderSchema);
    if ('response' in b) return b.response;
    const header = c.req.header('idempotency-key');
    if (header && !/^[A-Za-z0-9_.:-]{1,100}$/.test(header)) return validationError(c, { 'Idempotency-Key': 'Use 1–100 letters, digits or _.:-' });
    const { clientOrderId, type, ...rest } = b.data;
    const { order, duplicate } = await s.orders.place(user(c), { ...rest, type, idempotencyKey: clientOrderId ?? header ?? undefined });
    return c.json(order, duplicate ? 200 : 201);
  });
  r.get('/orders', async c => {
    const q = query(c, listOrdersQuery);
    return 'response' in q ? q.response : c.json(await s.orders.list(user(c), q.data));
  });
  r.get('/orders/:id', async c => c.json(await s.orders.get(user(c), id(c))));
  r.post('/orders/:id/cancel', async c => c.json(await s.orders.cancel(user(c), id(c))));

  // ---- Positions
  r.get('/positions', async c => {
    const q = query(c, listPositionsQuery);
    return 'response' in q ? q.response : c.json(await s.positions.list(user(c), q.data));
  });
  r.get('/positions/:id', async c => c.json(await s.positions.get(user(c), id(c))));
  r.post('/positions/:id/close', async c => c.json(await s.positions.close(user(c), id(c))));

  // ---- Automated strategies. `/strategies/:id/start` takes a saved strategy id; the others an instance id.
  r.post('/strategies/:id/start', async c => {
    const b = await parseJson(c, startStrategySchema);
    if ('response' in b) return b.response;
    const { accountId, ...rest } = b.data;
    return c.json(await s.strategies.start(user(c), id(c), { accountId, ...rest }), 201);
  });
  r.get('/strategies', async c => {
    const q = query(c, listStrategiesQuery);
    return 'response' in q ? q.response : c.json(await s.strategies.list(user(c), q.data));
  });
  r.get('/strategies/:id', async c => c.json(await s.strategies.get(user(c), id(c))));
  r.post('/strategies/:id/pause', async c => c.json(await s.strategies.transition(user(c), id(c), 'pause')));
  r.post('/strategies/:id/resume', async c => c.json(await s.strategies.transition(user(c), id(c), 'resume')));
  r.post('/strategies/:id/stop', async c => {
    const raw = await c.req.text();
    const parsed = stopStrategySchema.safeParse(raw ? JSON.parse(raw) : {});
    if (!parsed.success) return validationError(c, { closePosition: 'Must be a boolean.' });
    return c.json(await s.strategies.transition(user(c), id(c), 'stop', parsed.data));
  });

  return r;
}
