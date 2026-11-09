// Strategies module: user trading strategies with immutable versions.
import type { MiddlewareHandler } from 'hono';
import type { AppDatabase } from '../../db/types';
import type { AuthVariables } from '../identity';
import type { InstrumentChecker } from './application/ports';
import { StrategyService } from './application/strategy.service';
import { strategyRoutes } from './http/strategy.routes';
import { DrizzleStrategyRepository } from './infrastructure/drizzle-strategy.repository';

export type { StrategyDetail } from './application/ports';
export type { StrategyService } from './application/strategy.service';
export { describeCondition, strategyDraftSchema, type StrategyDraft } from './domain/definition';

export function createStrategiesModule(deps: { db: AppDatabase; instruments: InstrumentChecker; requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }> }) {
  const service = new StrategyService({ strategies: new DrizzleStrategyRepository(deps.db), instruments: deps.instruments });
  return { service, routes: strategyRoutes(service, deps.requireActiveUser) };
}

export type StrategiesModule = ReturnType<typeof createStrategiesModule>;
