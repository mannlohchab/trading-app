import { Elysia } from 'elysia';
import { z } from 'zod';
import { validationError } from '../../../http/validation';
import type { UserGuard } from '../../identity';
import { MarketError } from '../application/errors';
import type { LiveMarketHub, ServerMessage } from '../application/live-market.hub';
import type { MarketDataService } from '../application/market-data.service';
import { TIMEFRAMES } from '../domain/market-options';

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const symbolsQuery = z.object({ quote: z.string().max(10).optional(), q: z.string().max(30).optional(), limit: int(1, 500).optional(), offset: int(0, 1_000_000).optional() });
const tickersQuery = z.object({
  symbols: z.string().max(1200).optional(),
  quote: z.string().max(10).optional(),
  sort: z.enum(['volume', 'gainers', 'losers']).optional(),
  limit: int(1, 500).optional(),
});
const candlesQuery = z.object({ symbol: z.string().max(30), timeframe: z.enum(TIMEFRAMES), limit: int(1, 1000).optional(), endTime: int(0, 8_640_000_000_000).optional() });

const statusFor = { INVALID_REQUEST: 400, UNKNOWN_EXCHANGE: 404, UNKNOWN_SYMBOL: 404, PROVIDER_UNAVAILABLE: 503 } as const;

function query<S extends z.ZodType>(c: { query: Record<string, string | undefined> }, schema: S): { data: z.infer<S> } | { response: Response } {
  const parsed = schema.safeParse(c.query);
  if (parsed.success) return { data: parsed.data };
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) fields[issue.path.join('.') || '(query)'] ??= issue.message;
  return { response: validationError(fields) };
}

export const WS_LIMITS = { maxMessageBytes: 16 * 1024, messagesPerWindow: 30, windowMs: 10_000, maxBufferedBytes: 1024 * 1024 };

export function marketRoutes(deps: {
  service: MarketDataService;
  hub: LiveMarketHub;
  requireActiveUser: UserGuard;
  defaultExchange: string;
}) {
  const { service, hub } = deps;
  const routes = new Elysia({ prefix: '/api/v1/market' })
    .resolve(({ request }) => deps.requireActiveUser(request));
  routes.onError(({ error, set }) => {
    if (error instanceof MarketError) { set.status = statusFor[error.code]; return { error: error.message, code: error.code, ...error.details }; }
    return undefined;
  });
  const exchangeOf = (c: { query: Record<string, string | undefined> }) => c.query.exchange ?? deps.defaultExchange;

  routes.get('/exchanges', async c => ({ exchanges: await service.listExchanges() }));

  routes.get('/symbols', async c => {
    const q = query(c, symbolsQuery);
    if ('response' in q) return q.response;
    const { items, total } = await service.searchSymbols({ exchange: exchangeOf(c), quoteAsset: q.data.quote, query: q.data.q, limit: q.data.limit, offset: q.data.offset });
    return ({ symbols: items.map(({ id: _id, ...instrument }) => instrument), total });
  });

  routes.get('/tickers', async c => {
    const q = query(c, tickersQuery);
    if ('response' in q) return q.response;
    const tickers = q.data.symbols
      ? await service.tickersFor(exchangeOf(c), q.data.symbols.split(',').filter(Boolean))
      : await service.tickerList({ exchange: exchangeOf(c), quoteAsset: q.data.quote, sort: q.data.sort, limit: q.data.limit });
    c.set.headers['Cache-Control'] = 'no-store';
    return ({ tickers });
  });

  routes.get('/candles', async c => {
    const q = query(c, candlesQuery);
    if ('response' in q) return q.response;
    return await service.candles({ exchange: exchangeOf(c), ...q.data });
  });

  // Live data. Client → server: {"op":"subscribe"|"unsubscribe","topics":[...]} or {"op":"ping"}.
  const connections = new WeakMap<object, { clientId: number; windowStart: number; messages: number }>();
  routes.ws('/stream', {
    open(ws) {
      const clientId = hub.connect((message: ServerMessage) => {
        if ((ws.raw as unknown as Pick<Bun.ServerWebSocket<unknown>, 'getBufferedAmount'>).getBufferedAmount() > WS_LIMITS.maxBufferedBytes) {
          ws.close(1013, 'Client too slow');
          return;
        }
        ws.send(message);
      });
      connections.set(ws.raw, { clientId, windowStart: Date.now(), messages: 0 });
    },
    message(ws, message) {
      const state = connections.get(ws.raw);
      if (!state) return;
      const now = Date.now();
      if (now - state.windowStart > WS_LIMITS.windowMs) { state.windowStart = now; state.messages = 0; }
      if (++state.messages > WS_LIMITS.messagesPerWindow) return ws.close(1008, 'Too many messages');
      // Bun enforces the raw byte limit before Elysia's JSON parser runs.
      if (ArrayBuffer.isView(message) || message instanceof ArrayBuffer) return ws.close(1009, 'Message too large or not text');
      let body: unknown = message;
      if (typeof message === 'string') {
        try { body = JSON.parse(message); } catch {
          ws.send({ type: 'error', code: 'INVALID_JSON', message: 'Messages must be JSON.' });
          return;
        }
      }
      const command = body as { op?: unknown; topics?: unknown } | null;
      if (command?.op === 'subscribe') void hub.subscribe(state.clientId, command.topics);
      else if (command?.op === 'unsubscribe') hub.unsubscribe(state.clientId, command.topics);
      else if (command?.op === 'ping') hub.ping(state.clientId);
      else ws.send({ type: 'error', code: 'UNKNOWN_OP', message: 'op must be subscribe, unsubscribe or ping.' });
    },
    close(ws) {
      const state = connections.get(ws.raw);
      if (state) hub.disconnect(state.clientId);
      connections.delete(ws.raw);
    },
  });

  return routes;
}
