// Backtesting module: runs strategy versions over stored historical candles with a pluggable
// engine (Resin first), executed in an isolated sandbox via the PostgreSQL job queue.
import type { AppDatabase } from '../../db/types';
import { Elysia } from 'elysia';
import { createLogger, type Logger } from '../../logger';
import type { UserGuard } from '../identity';
import type { MarketDataService } from '../market/application/market-data.service';
import type { StrategyService } from '../strategies';
import { PostgresJobQueue } from '../system/jobs';
import { QUEUE } from './backtesting.constants';
import { MarketServiceCandleHistory, type CandleHistory } from './backtesting.market-history';
import { BacktestingRepository } from './backtesting.repository';
import { backtestingRoutes } from './backtesting.routes';
import { BacktestingService } from './backtesting.service';
import { BacktestExperiments, experimentRoutes } from './backtesting.experiments';
import { PortfolioSandbox } from './portfolio-sandbox';
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
  requireActiveUser: UserGuard;
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
  const engine = deps.engine ?? new ResinEngine(workers);
  const service = new BacktestingService({
    repo: new BacktestingRepository(deps.db),
    queue,
    engine,
    history: deps.history ?? new MarketServiceCandleHistory(deps.market),
    strategies: deps.strategies,
    clock,
    log,
  });
  const portfolio = new PortfolioSandbox(deps.sandbox.mode);
  const experiments = new BacktestExperiments({ db: deps.db, queue, engine, portfolio, now: () => clock.now() });
  return {
    service,
    experiments,
    portfolio,
    queue,
    workers,
    signalWorkers,
    /** Strategy signal evaluation for paper trading (same engine and scripts as backtests). */
    signals: new ResinEngine(signalWorkers) as import('./engines/backtest-engine.interface').StrategySignalEngine,
    jobHandler: service.jobHandler,
    experimentJobHandler: experiments.jobHandler,
    leaseMs: QUEUE.leaseMs,
    routes: new Elysia().use(experimentRoutes(experiments, deps.requireActiveUser)).use(backtestingRoutes(service, deps.requireActiveUser)),
  };
}

export type BacktestingModule = ReturnType<typeof createBacktestingModule>;
