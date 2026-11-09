// Application-level backtesting types. Engine-neutral: nothing here mentions Resin.
import type { Timeframe } from '../market/domain/market-options';
import type { Decimal } from './utils/decimal';

export type PositionSizing =
  | { type: 'percent_of_equity'; value: Decimal }
  | { type: 'cash'; value: Decimal }
  | { type: 'fixed_quantity'; value: Decimal };

/** Everything that defines a run. Stored with the job so any backtest can be reproduced. */
export type BacktestSettings = {
  initialCapital: Decimal;
  commissionPercent: Decimal;
  slippageTicks: number;
  positionSizing: PositionSizing;
};

export type SymbolSpec = {
  exchange: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  tickSize: Decimal;
  lotSize: Decimal;
};

/** A closed candle; prices exact decimal strings, times Unix ms UTC. */
export type DatasetCandle = {
  openTime: number;
  closeTime: number;
  open: Decimal;
  high: Decimal;
  low: Decimal;
  close: Decimal;
  volume: Decimal;
};

export type DatasetInfo = {
  candles: number;
  expectedCandles: number;
  missingCandles: number;
  firstOpenTime: number;
  lastCloseTime: number;
  /** sha256 over the candles exactly as passed to the engine. */
  checksum: string;
  source: 'market_candles';
};

export type ScriptSource = { language: 'pine'; version: 6; source: string; generatedFrom: 'strategy_definition_v1' };

export type EngineInput = {
  script: ScriptSource;
  candles: DatasetCandle[];
  timeframe: Timeframe;
  symbol: SymbolSpec;
  settings: BacktestSettings;
};

export type TradeSide = 'LONG' | 'SHORT';

/** One closed trade, normalized. Money values are decimal strings. */
export type EngineTrade = {
  side: TradeSide;
  quantity: Decimal;
  entryTime: number;
  exitTime: number;
  entryPrice: Decimal;
  exitPrice: Decimal;
  /** Net of this trade's commission (entry + exit legs). */
  profit: Decimal;
  profitPercent: Decimal;
  commission: Decimal;
  maxRunup: Decimal;
  maxDrawdown: Decimal;
  entryId: string;
  exitId: string | null;
  exitReason: string;
};

export type EngineResult = {
  engine: EngineIdentity;
  trades: EngineTrade[];
  /** Equity at each bar's close, aligned with the input candles. */
  equity: Decimal[];
  /** Realized P/L as the engine accounts it (cross-checked against the trades). */
  realizedPnl: Decimal;
  /** Position still open at the last candle; its entry commission is already paid. */
  openPosition: { side: TradeSide; quantity: Decimal; averagePrice: Decimal; entryCommission: Decimal; entryTime: number } | null;
  durationMs: number;
};

export type EngineIdentity = { name: string; version: string; revision: string };

export type BacktestMetrics = {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  winRatePercent: Decimal | null;
  grossProfit: Decimal;
  grossLoss: Decimal;
  /** Realized: closed trades only, net of commission. */
  netProfit: Decimal;
  /** Mark-to-market value of a position still open at the last candle. */
  unrealizedProfit: Decimal;
  totalCommission: Decimal;
  finalEquity: Decimal;
  /** (final equity − initial capital) / initial capital, realized + unrealized. */
  totalReturnPercent: Decimal;
  maxDrawdown: Decimal;
  maxDrawdownPercent: Decimal;
  /** null when there are no losing trades (undefined, not infinite). */
  profitFactor: Decimal | null;
  averageTrade: Decimal | null;
  averageWinningTrade: Decimal | null;
  averageLosingTrade: Decimal | null;
  largestWinningTrade: Decimal | null;
  largestLosingTrade: Decimal | null;
  averageTradeDurationMs: number | null;
  buyAndHoldReturnPercent: Decimal;
  exposurePercent: Decimal;
};

export type BacktestWarning = { code: string; message: string };
