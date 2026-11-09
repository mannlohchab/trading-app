// Backtesting module: runs strategy versions over stored historical candles with a pluggable
// engine (Resin first), executed in an isolated sandbox via the PostgreSQL job queue.
import type { MiddlewareHandler } from 'hono';
import type { AppDatabase } from '../../db/types';
import { createLogger, type Logger } from '../../logger';
import type { AuthVariables } from '../identity';
import type { MarketDataService } from '../market/application/market-data.service';
import type { StrategyService } from '../strategies';
import { PostgresJobQueue } from '../system/jobs';
import { QUEUE } from './backtesting.constants';
import { MarketServiceCandleHistory, type CandleHistory } from './backtesting.market-history';
import { BacktestingRepository } from './backtesting.repository';
import { backtestingRoutes } from './backtesting.routes';
import { BacktestingService } from './backtesting.service';
import type { BacktestEngine } from './engines/backtest-engine.interface';
import { ResinEngine } from './engines/resin/resin.engine';
import { BacktestWorkerManager, type SandboxMode } from './workers/backtest.worker-manager';

export type { BacktestEngine, SignalSeries, StrategySignalEngine } from './engines/backtest-engine.interface';
export { EngineError } from './engines/backtest-engine.interface';
export { definitionToPine } from './engines/resin/definition-to-pine';
export { requiredCandles } from './utils/validation';
export { dec, type Decimal } from './utils/decimal';
export type { DatasetCandle } from './backtesting.types';
export { BacktestWorkerManager, type SandboxMode } from './workers/backtest.worker-manager';

export function createBacktestingModule(deps: {
  db: AppDatabase;
  requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }>;
  market: MarketDataService;
  strategies: StrategyService;
  sandbox: { mode: SandboxMode };
  /** Overrides for tests. */
  engine?: BacktestEngine;
  history?: CandleHistory;
  clock?: { now(): Date };
  log?: Logger;
}) {
  const log = deps.log ?? createLogger('backtesting');
  const clock = deps.clock ?? { now: () => new Date() };
  const workers = new BacktestWorkerManager({ mode: deps.sandbox.mode, log });
  // Live strategy evaluations get their own sandbox pool, so long backtests never delay them.
  const signalWorkers = new BacktestWorkerManager({ mode: deps.sandbox.mode, log, maxConcurrent: 4, maxQueued: 64 });
  const queue = new PostgresJobQueue(deps.db, () => clock.now());
  const service = new BacktestingService({
    repo: new BacktestingRepository(deps.db),
    queue,
    engine: deps.engine ?? new ResinEngine(workers),
    history: deps.history ?? new MarketServiceCandleHistory(deps.market),
    strategies: deps.strategies,
    clock,
    log,
  });
  return {
    service,
    queue,
    workers,
    signalWorkers,
    /** Strategy signal evaluation for paper trading (same engine and scripts as backtests). */
    signals: new ResinEngine(signalWorkers) as import('./engines/backtest-engine.interface').StrategySignalEngine,
    jobHandler: service.jobHandler,
    leaseMs: QUEUE.leaseMs,
    routes: backtestingRoutes(service, deps.requireActiveUser),
  };
}

export type BacktestingModule = ReturnType<typeof createBacktestingModule>;
