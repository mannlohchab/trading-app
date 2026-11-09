// Paper trading: simulated accounts, orders, positions and automated strategies on live Binance
// market data. Simulated money only — nothing in this module can place a real exchange order.
import type { MiddlewareHandler } from 'hono';
import type { AppDatabase } from '../../db/types';
import { createLogger, type Logger } from '../../logger';
import type { StrategySignalEngine } from '../backtesting';
import type { AuthVariables } from '../identity';
import type { LiveMarketHub } from '../market/application/live-market.hub';
import type { MarketDataService } from '../market/application/market-data.service';
import type { PostgresJobQueue } from '../system/jobs';
import { paperTradingRoutes } from './paper-trading.routes';
import { createPaperTradingServices } from './paper-trading.service';
import { PaperTradingEngine } from './workers/paper-trading.worker';

export function createPaperTradingModule(deps: {
  db: AppDatabase;
  requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }>;
  market: { service: MarketDataService; hub: LiveMarketHub };
  signals: StrategySignalEngine;
  queue: PostgresJobQueue;
  clock?: { now(): Date };
  log?: Logger;
}) {
  const log = deps.log ?? createLogger('paper-trading');
  const clock = deps.clock ?? { now: () => new Date() };
  const services = createPaperTradingServices({ db: deps.db, market: deps.market.service, signals: deps.signals, queue: deps.queue, clock, log });
  const engine = new PaperTradingEngine({
    db: deps.db, hub: deps.market.hub, quotes: services.quotes, execution: services.execution, orders: services.orderRepo, orderService: services.orders,
    positions: services.positionRepo, positionService: services.positions, strategies: services.strategies, evaluator: services.evaluator, signals: services.signalProcessor,
    repo: services.repo, clock, log,
  });
  return { services, engine, jobHandler: services.strategies.jobHandler, routes: paperTradingRoutes(services, deps.requireActiveUser) };
}

export type PaperTradingModule = ReturnType<typeof createPaperTradingModule>;
