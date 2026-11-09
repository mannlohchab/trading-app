// Evaluates a strategy's own signals on completed candles, using the backtesting module's sandboxed
// Resin engine on the same generated script. Candles come from Postgres (backfilled over REST when
// missing); unfinished candles are never included.
import type { Logger } from '../../../logger';
import type { DatasetCandle, SignalSeries, StrategySignalEngine } from '../../backtesting';
import { BacktestingRepository } from '../../backtesting/backtesting.repository';
import { validateDataset } from '../../backtesting/utils/validation';
import type { MarketDataService } from '../../market/application/market-data.service';
import type { Timeframe } from '../../market/domain/market-options';
import type { SymbolRules } from '../paper-trading.types';
import { STRATEGY_LIMITS } from '../paper-trading.constants';

export type EvaluationRequest = {
  scriptSha: string;
  source: string;
  symbol: SymbolRules;
  timeframe: Timeframe;
  /** Open time of the newest closed candle to evaluate. */
  latestOpenTime: number;
  windowStart: number;
  windowEnd: number;
  requiredCandles: number;
  bars: number;
};

export class EvaluationDataError extends Error {
  constructor(readonly code: string, message: string, readonly retryable: boolean) { super(message); this.name = 'EvaluationDataError'; }
}

export class StrategyEvaluator {
  private readonly cache = new Map<string, { at: number; value: Promise<{ series: SignalSeries; candles: number }> }>();
  readonly metrics = { evaluations: 0, cacheHits: 0, recoveries: 0, latencyMs: [] as number[] };

  constructor(private readonly deps: { engine: StrategySignalEngine; candles: BacktestingRepository; market: MarketDataService; clock: { now(): Date }; log: Logger }) {}

  /** Signals for the latest `bars` closed candles. Instances sharing script, market and candle share one run. */
  evaluate(req: EvaluationRequest) {
    const key = `${req.scriptSha}:${req.symbol.id}:${req.timeframe}:${req.latestOpenTime}:${req.windowStart}:${req.bars}`;
    const hit = this.cache.get(key);
    if (hit && this.deps.clock.now().getTime() - hit.at < 120_000) { this.metrics.cacheHits++; return hit.value; }
    const value = this.run(req);
    this.cache.set(key, { at: this.deps.clock.now().getTime(), value });
    value.catch(() => this.cache.delete(key));
    if (this.cache.size > 500) for (const k of [...this.cache.keys()].slice(0, 100)) this.cache.delete(k);
    return value;
  }

  private async run(req: EvaluationRequest) {
    const started = performance.now();
    const candles = await this.load(req);
    const series = await this.deps.engine.signals({
      script: { language: 'pine', version: 6, generatedFrom: 'strategy_definition_v1', source: req.source },
      candles,
      timeframe: req.timeframe,
      symbol: { exchange: req.symbol.exchange, symbol: req.symbol.symbol, baseAsset: req.symbol.baseAsset, quoteAsset: req.symbol.quoteAsset, tickSize: req.symbol.tickSize, lotSize: req.symbol.lotSize },
      settings: { initialCapital: '10000', commissionPercent: '0', slippageTicks: 0, positionSizing: { type: 'percent_of_equity', value: '10' } },
      bars: req.bars,
    }, { timeoutMs: STRATEGY_LIMITS.evaluationTimeoutMs });
    this.metrics.evaluations++;
    this.metrics.latencyMs.push(performance.now() - started);
    if (this.metrics.latencyMs.length > 500) this.metrics.latencyMs.shift();
    return { series, candles: candles.length };
  }

  /** Closed candles for the window from Postgres; fetches over REST (which stores them) if the newest is missing. */
  private async load(req: EvaluationRequest): Promise<DatasetCandle[]> {
    const read = async () => {
      const rows = await this.deps.candles.loadCandles(req.symbol.id, req.timeframe, req.windowStart, req.windowEnd);
      return validateDataset(rows, req.timeframe, { start: req.windowStart, end: req.windowEnd, now: this.deps.clock.now().getTime() }, req.requiredCandles);
    };
    let report = await read().catch(() => null);
    if (!report || report.candles.at(-1)?.openTime !== req.latestOpenTime) {
      this.metrics.recoveries++;
      this.deps.log('info', 'Recovering missed candles over REST', { symbol: req.symbol.symbol, timeframe: req.timeframe, latestOpenTime: req.latestOpenTime });
      try {
        await this.deps.market.candles({ exchange: req.symbol.exchange, symbol: req.symbol.symbol, timeframe: req.timeframe, limit: 1000, endTime: req.windowEnd - 1 });
      } catch (error) {
        throw new EvaluationDataError('MARKET_DATA_UNAVAILABLE', `Candles could not be fetched: ${error instanceof Error ? error.message : String(error)}`, true);
      }
      try {
        report = await read();
      } catch (error) {
        throw new EvaluationDataError('INSUFFICIENT_DATA', error instanceof Error ? error.message : String(error), true);
      }
    }
    if (report.candles.at(-1)?.openTime !== req.latestOpenTime) {
      throw new EvaluationDataError('CANDLE_NOT_AVAILABLE', `The ${req.timeframe} candle opening ${new Date(req.latestOpenTime).toISOString()} is not available yet.`, true);
    }
    return report.candles.map(({ openTime, closeTime, open, high, low, close, volume }) => ({ openTime, closeTime, open, high, low, close, volume }));
  }
}
