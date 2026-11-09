import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { UpgradeWebSocket } from 'hono/ws';
import { z } from 'zod';
import { validationError } from '../../../http/validation';
import type { AuthVariables } from '../../identity';
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

function query<S extends z.ZodType>(c: Context, schema: S): { data: z.infer<S> } | { response: Response } {
  const parsed = schema.safeParse(c.req.query());
  if (parsed.success) return { data: parsed.data };
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) fields[issue.path.join('.') || '(query)'] ??= issue.message;
  return { response: validationError(c, fields) };
}

export const WS_LIMITS = { maxMessageBytes: 16 * 1024, messagesPerWindow: 30, windowMs: 10_000, maxBufferedBytes: 1024 * 1024 };

export function marketRoutes(deps: {
  service: MarketDataService;
  hub: LiveMarketHub;
  requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }>;
  upgradeWebSocket: UpgradeWebSocket;
  defaultExchange: string;
}) {
  const { service, hub } = deps;
  const routes = new Hono<{ Variables: AuthVariables }>().basePath('/api/v1/market');
  routes.use('*', deps.requireActiveUser);
  routes.onError((error, c) => {
    if (error instanceof MarketError) return c.json({ error: error.message, code: error.code, ...error.details }, statusFor[error.code]);
    throw error;
  });
  const exchangeOf = (c: Context) => c.req.query('exchange') ?? deps.defaultExchange;

  routes.get('/exchanges', async c => c.json({ exchanges: await service.listExchanges() }));

  routes.get('/symbols', async c => {
    const q = query(c, symbolsQuery);
    if ('response' in q) return q.response;
    const { items, total } = await service.searchSymbols({ exchange: exchangeOf(c), quoteAsset: q.data.quote, query: q.data.q, limit: q.data.limit, offset: q.data.offset });
    return c.json({ symbols: items.map(({ id: _id, ...instrument }) => instrument), total });
  });

  routes.get('/tickers', async c => {
    const q = query(c, tickersQuery);
    if ('response' in q) return q.response;
    const tickers = q.data.symbols
      ? await service.tickersFor(exchangeOf(c), q.data.symbols.split(',').filter(Boolean))
      : await service.tickerList({ exchange: exchangeOf(c), quoteAsset: q.data.quote, sort: q.data.sort, limit: q.data.limit });
    c.header('Cache-Control', 'no-store');
    return c.json({ tickers });
  });

  routes.get('/candles', async c => {
    const q = query(c, candlesQuery);
    if ('response' in q) return q.response;
    return c.json(await service.candles({ exchange: exchangeOf(c), ...q.data }));
  });

  // Live data. Client → server: {"op":"subscribe"|"unsubscribe","topics":[...]} or {"op":"ping"}.
  routes.get('/stream', deps.upgradeWebSocket(() => {
    let clientId = 0;
    let windowStart = Date.now();
    let messages = 0;
    return {
      onOpen(_event, ws) {
        clientId = hub.connect((message: ServerMessage) => {
          const raw = ws.raw as { getBufferedAmount?: () => number } | undefined;
          if ((raw?.getBufferedAmount?.() ?? 0) > WS_LIMITS.maxBufferedBytes) return ws.close(1013, 'Client too slow');
          ws.send(JSON.stringify(message));
        });
      },
      onMessage(event, ws) {
        const now = Date.now();
        if (now - windowStart > WS_LIMITS.windowMs) { windowStart = now; messages = 0; }
        if (++messages > WS_LIMITS.messagesPerWindow) return ws.close(1008, 'Too many messages');
        const text = typeof event.data === 'string' ? event.data : '';
        if (!text || text.length > WS_LIMITS.maxMessageBytes) return ws.close(1009, 'Message too large or not text');
        let body: { op?: unknown; topics?: unknown };
        try { body = JSON.parse(text); } catch { return ws.send(JSON.stringify({ type: 'error', code: 'INVALID_JSON', message: 'Messages must be JSON.' })); }
        if (body?.op === 'subscribe') void hub.subscribe(clientId, body.topics);
        else if (body?.op === 'unsubscribe') hub.unsubscribe(clientId, body.topics);
        else if (body?.op === 'ping') hub.ping(clientId);
        else ws.send(JSON.stringify({ type: 'error', code: 'UNKNOWN_OP', message: 'op must be subscribe, unsubscribe or ping.' }));
      },
      onClose() {
        hub.disconnect(clientId);
      },
    };
  }));

  return routes;
}
