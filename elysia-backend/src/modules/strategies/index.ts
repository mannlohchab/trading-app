// Strategies module: user trading strategies with immutable versions.
import type { AppDatabase } from '../../db/types';
import type { UserGuard } from '../identity';
import type { InstrumentChecker } from './application/ports';
import { StrategyService } from './application/strategy.service';
import { strategyRoutes } from './http/strategy.routes';
import { DrizzleStrategyRepository } from './infrastructure/drizzle-strategy.repository';

export type { StrategyDetail } from './application/ports';
export type { StrategyService } from './application/strategy.service';
export { describeCondition, strategyDraftSchema, type StrategyDraft } from './domain/definition';

export function createStrategiesModule(deps: { db: AppDatabase; instruments: InstrumentChecker; requireActiveUser: UserGuard }) {
  const service = new StrategyService({ strategies: new DrizzleStrategyRepository(deps.db), instruments: deps.instruments });
  return { service, routes: strategyRoutes(service, deps.requireActiveUser) };
}

export type StrategiesModule = ReturnType<typeof createStrategiesModule>;
