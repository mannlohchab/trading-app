import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { validationError } from '../../../http/validation';
import type { AuthVariables } from '../../identity';
import { InvalidNewsQueryError } from '../application/errors';
import { PAGE, type NewsQueryService } from '../application/news-query.service';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE.max).optional(),
  cursor: z.string().max(200).optional(),
  /** Coin code, e.g. BTC. */
  asset: z.string().regex(/^[A-Za-z0-9]{2,10}$/, 'Use a coin code such as BTC.').optional(),
  publisher: z.string().regex(/^[A-Za-z0-9]{1,50}$/, 'Use a publisher key such as coindesk.').optional(),
  q: z.string().trim().min(2).max(100).optional(),
});
const breakingQuery = z.object({ limit: z.coerce.number().int().min(1).max(PAGE.max).optional() });

export function newsRoutes(deps: { service: NewsQueryService; requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }> }) {
  const { service } = deps;
  const routes = new Hono<{ Variables: AuthVariables }>().basePath('/api/v1/news');
  routes.use('*', deps.requireActiveUser);
  routes.onError((error, c) => {
    if (error instanceof InvalidNewsQueryError) return validationError(c, { [error.field]: error.message });
    throw error;
  });

  const parse = <S extends z.ZodType>(schema: S, input: unknown): { data: z.infer<S> } | { fields: Record<string, string> } => {
    const parsed = schema.safeParse(input);
    if (parsed.success) return { data: parsed.data };
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join('.') || '(query)'] ??= issue.message;
    return { fields };
  };

  // Newest first, filterable by coin, publisher and search text: ?asset=BTC&publisher=coindesk&q=etf&cursor=…
  routes.get('/', async c => {
    const q = parse(listQuery, c.req.query());
    if ('fields' in q) return validationError(c, q.fields);
    c.header('Cache-Control', 'private, max-age=30');
    return c.json(await service.list(q.data));
  });

  routes.get('/breaking', async c => {
    const q = parse(breakingQuery, c.req.query());
    if ('fields' in q) return validationError(c, q.fields);
    c.header('Cache-Control', 'private, max-age=30');
    return c.json({ articles: await service.breaking(q.data.limit) });
  });

  routes.get('/sources', async c => c.json({ sources: await service.sources() }));

  return routes;
}
