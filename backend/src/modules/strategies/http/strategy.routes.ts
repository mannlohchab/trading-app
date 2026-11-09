import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { parseJson, validationError } from '../../../http/validation';
import type { AuthVariables } from '../../identity';
import type { StrategyService } from '../application/strategy.service';

const uuid = z.uuid();

export function strategyRoutes(service: StrategyService, requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }>) {
  const routes = new Hono<{ Variables: AuthVariables }>().basePath('/api/v1/strategies');
  routes.use('*', requireActiveUser);

  routes.get('/', async c => {
    const limit = Number(c.req.query('limit') ?? 50), offset = Number(c.req.query('offset') ?? 0);
    const { items, total } = await service.list(c.var.user.id, Number.isFinite(limit) ? limit : 50, Number.isFinite(offset) ? offset : 0);
    return c.json({ strategies: items, total });
  });

  routes.get('/:id', async c => {
    const id = c.req.param('id');
    const strategy = uuid.safeParse(id).success ? await service.get(c.var.user.id, id) : null;
    return strategy ? c.json(strategy) : c.json({ error: 'Strategy not found.', code: 'NOT_FOUND' }, 404);
  });

  // Manual creation (source USER_CREATED). AI drafts are saved via the AI module.
  routes.post('/', async c => {
    const body = await parseJson(c, z.unknown());
    if ('response' in body) return body.response;
    const result = await service.create(c.var.user.id, body.data, 'USER_CREATED');
    return result.ok ? c.json(result.strategy, 201) : validationError(c, result.errors);
  });

  return routes;
}
