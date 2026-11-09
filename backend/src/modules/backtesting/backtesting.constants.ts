// Defaults and limits for backtesting. Every assumption the engine makes is stated here.

export const BACKTEST_JOB_TYPE = 'backtesting.run';

export const DEFAULTS = {
  /** In the symbol's quote asset (USDT for BTCUSDT). */
  initialCapital: '10000',
  /** Binance spot taker fee, charged on entry and exit. */
  commissionPercent: '0.1',
  /** One tick against every market and stop fill. */
  slippageTicks: 1,
  /** Used when neither the request nor the strategy sets a size. */
  positionSizePercent: '10',
  /** History length when the request gives no start. */
  lookbackCandles: 1000,
  /** Quick backtests of unsaved AI drafts. */
  previewCandles: 1000,
} as const;

export const LIMITS = {
  maxCandles: 50_000,
  maxPreviewCandles: 3_000,
  /** Below this a backtest says too little to be useful. */
  minCandles: 100,
  /** Extra history required beyond the strategy's longest indicator period. */
  warmupMargin: 50,
  /** Reject datasets with more missing candles than this share. */
  maxMissingRatio: 0.02,
  maxActiveBacktestsPerUser: 3,
  maxTrades: 200_000,
  equityCurvePoints: 2_000,
  initialCapitalMax: '1000000000',
  commissionPercentMax: '5',
  slippageTicksMax: 1_000,
} as const;

/** Sandbox resource limits for one engine run. */
export const SANDBOX_LIMITS = {
  wallTimeoutMs: 60_000,
  previewWallTimeoutMs: 15_000,
  cpuSeconds: 60,
  memoryBytes: 1024 * 1024 * 1024,
  maxOutputBytes: 64 * 1024 * 1024,
  maxStderrBytes: 64 * 1024,
  maxConcurrentRuns: 2,
  maxQueuedRuns: 16,
} as const;

export const QUEUE = {
  /** A claimed job not finished within this is presumed dead and re-queued. */
  leaseMs: 5 * 60_000,
  maxAttempts: 3,
  pollIntervalMs: 1_000,
  /** How often a running backtest checks whether it was cancelled. */
  cancelPollMs: 1_000,
} as const;
