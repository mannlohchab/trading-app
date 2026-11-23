// Portfolio module: the holdings a user really owns (asset, quantity, buy date, optional buy price),
// entered as a table and valued at current market prices, mainly so the AI assistant can analyse
// them. Separate from paper trading. Holdings live in Postgres; prices come from the market module.
import type { AppDatabase } from '../../db/types';
import type { UserGuard } from '../identity';
import { PortfolioService } from './application/portfolio.service';
import type { Clock, PriceSource } from './application/ports';
import { portfolioRoutes } from './http/portfolio.routes';
import { DrizzleHoldingsRepository } from './infrastructure/drizzle-holdings.repository';

export { marketPriceSource } from './infrastructure/market-price-source';
export type { PortfolioValuation, PositionValuation } from './domain/holdings';
export type { PortfolioService } from './application/portfolio.service';

export function createPortfolioModule(deps: {
  db: AppDatabase;
  requireActiveUser: UserGuard;
  prices: PriceSource;
  clock?: Clock;
}) {
  const service = new PortfolioService({
    repository: new DrizzleHoldingsRepository(deps.db),
    prices: deps.prices,
    clock: deps.clock ?? { now: () => new Date() },
    log: (message, error) => console.warn(`[portfolio] ${message}`, error ?? ''),
  });
  return { service, routes: portfolioRoutes({ service, requireActiveUser: deps.requireActiveUser }) };
}

export type PortfolioModule = ReturnType<typeof createPortfolioModule>;
