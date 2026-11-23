import { Elysia } from 'elysia';
import { z } from 'zod';
import { parseJson, validationError } from '../../../http/validation';
import type { UserGuard } from '../../identity';
import type { StrategyService } from '../application/strategy.service';

const uuid = z.uuid();

export function strategyRoutes(service: StrategyService, requireActiveUser: UserGuard) {
  const routes = new Elysia({ prefix: '/api/v1/strategies' }).resolve(({ request }) => requireActiveUser(request));

  routes.get('/', async c => {
    const limit = Number(c.query.limit ?? 50), offset = Number(c.query.offset ?? 0);
    const { items, total } = await service.list(c.user.id, Number.isFinite(limit) ? limit : 50, Number.isFinite(offset) ? offset : 0);
    return ({ strategies: items, total });
  }, { parse: 'none' });

  routes.get('/:id', async c => {
    const id = c.params.id;
    const strategy = uuid.safeParse(id).success ? await service.get(c.user.id, id) : null;
    return strategy ? (strategy) : Response.json({ error: 'Strategy not found.', code: 'NOT_FOUND' }, { status: 404 });
  }, { parse: 'none' });

  // Manual creation (source USER_CREATED). AI drafts are saved via the AI module.
  routes.post('/', async c => {
    const body = await parseJson(c.request, z.unknown());
    if ('response' in body) return body.response;
    const result = await service.create(c.user.id, body.data, 'USER_CREATED');
    return result.ok ? Response.json(result.strategy, { status: 201 }) : validationError(result.errors);
  }, { parse: 'none' });

  return routes;
}
