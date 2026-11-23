import { Elysia } from 'elysia';
import { z } from 'zod';
import { parseJson, validationError } from '../../../http/validation';
import type { UserGuard } from '../../identity';
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

export function portfolioRoutes(deps: { service: PortfolioService; requireActiveUser: UserGuard }) {
  const { service } = deps;
  const routes = new Elysia({ prefix: '/api/v1/portfolio' }).resolve(({ request }) => deps.requireActiveUser(request));

  /** The user's holdings table, in row order. */
  routes.get('/holdings', async c => (await service.list(c.user.id)));

  /** Saves the whole table (an empty list clears it). */
  routes.put('/holdings', async c => {
    const body = await parseJson(c.request, replaceBody);
    if ('response' in body) return body.response;
    const result = await service.replace(c.user.id, body.data.holdings);
    return result.ok ? ({ holdings: result.holdings, updatedAt: result.updatedAt }) : validationError(result.errors);
  }, { parse: 'none' });

  /** Holdings merged per asset and valued at current prices. */
  routes.get('/valuation', async c => (await service.valuation(c.user.id)));

  return routes;
}
