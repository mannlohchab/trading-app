import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { parseJson, validationError } from '../../../http/validation';
import type { AuthVariables } from '../../identity';
import type { PortfolioService } from '../application/portfolio.service';
import { HOLDING_LIMITS } from '../domain/holdings';

const cell = (max: number) => z.string().max(max);
const replaceBody = z.strictObject({
  holdings: z.array(z.strictObject({
    asset: cell(60),
    quantity: cell(40),
    boughtOn: cell(10),
    buyPrice: cell(40).nullish(),
  })).max(HOLDING_LIMITS.maxRows, `At most ${HOLDING_LIMITS.maxRows} rows.`),
});

export function portfolioRoutes(deps: { service: PortfolioService; requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }> }) {
  const { service } = deps;
  const routes = new Hono<{ Variables: AuthVariables }>().basePath('/api/v1/portfolio');
  routes.use('*', deps.requireActiveUser);

  /** The user's holdings table, in row order. */
  routes.get('/holdings', async c => c.json(await service.list(c.var.user.id)));

  /** Saves the whole table (an empty list clears it). */
  routes.put('/holdings', async c => {
    const body = await parseJson(c, replaceBody);
    if ('response' in body) return body.response;
    const result = await service.replace(c.var.user.id, body.data.holdings);
    return result.ok ? c.json({ holdings: result.holdings, updatedAt: result.updatedAt }) : validationError(c, result.errors);
  });

  /** Holdings merged per asset and valued at current prices. */
  routes.get('/valuation', async c => c.json(await service.valuation(c.var.user.id)));

  return routes;
}
