// Builds the module's services from their dependencies (no business logic here).
import type { AppDatabase } from '../../db/types';
import type { Logger } from '../../logger';
import type { StrategySignalEngine } from '../backtesting';
import { BacktestingRepository } from '../backtesting/backtesting.repository';
import type { MarketDataService } from '../market/application/market-data.service';
import type { PostgresJobQueue } from '../system/jobs';
import { AccountRepository } from './accounts/account.repository';
import { AccountService } from './accounts/account.service';
import { PaperExecutionEngine } from './execution/paper-execution.engine';
import { QuoteBook } from './execution/quote-book';
import { OrderRepository } from './orders/order.repository';
import { OrderService } from './orders/order.service';
import { PaperTradingRepository } from './paper-trading.repository';
import { PortfolioService } from './portfolio/portfolio.service';
import { PositionRepository } from './positions/position.repository';
import { PositionService } from './positions/position.service';
import { SignalProcessor } from './strategies/signal-processor';
import { StrategyEvaluator } from './strategies/strategy-evaluator';
import { StrategyRunnerService } from './strategies/strategy-runner.service';

export function createPaperTradingServices(deps: { db: AppDatabase; market: MarketDataService; signals: StrategySignalEngine; queue: PostgresJobQueue; clock: { now(): Date }; log: Logger }) {
  const { db, clock, log } = deps;
  const repo = new PaperTradingRepository(db);
  const quotes = new QuoteBook(deps.market, () => clock.now().getTime());
  const execution = new PaperExecutionEngine({ db, repo, clock, log });
  const orderRepo = new OrderRepository(db);
  const orders = new OrderService({ db, repo, orders: orderRepo, execution, prices: quotes, clock, log });
  const positionRepo = new PositionRepository(db);
  const positions = new PositionService({ positions: positionRepo, orders, repo, prices: quotes, clock });
  const accountRepo = new AccountRepository(db);
  const accounts = new AccountService({ db, accounts: accountRepo, clock, log });
  const portfolio = new PortfolioService({ accounts: accountRepo, positions: positionRepo, positionService: positions });
  const evaluator = new StrategyEvaluator({ engine: deps.signals, candles: new BacktestingRepository(db), market: deps.market, clock, log });
  const signalProcessor = new SignalProcessor({ db, orders, repo, prices: quotes, clock, log });
  const strategies = new StrategyRunnerService({ db, repo, queue: deps.queue, evaluator, signals: signalProcessor, positions, engineIdentity: deps.signals.identity, clock, log });
  return { repo, quotes, execution, orderRepo, orders, positionRepo, positions, accounts, portfolio, evaluator, signalProcessor, strategies };
}

export type PaperTradingServices = ReturnType<typeof createPaperTradingServices>;
