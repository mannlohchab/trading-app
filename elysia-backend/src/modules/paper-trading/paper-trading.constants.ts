// Paper trading defaults, limits and fill rules. Simulated money only: nothing here talks to an
// exchange's trading API.

export const PAPER_CURRENCY = 'USDT';
export const PAPER_EXCHANGE = 'BINANCE';

export const ACCOUNT_LIMITS = {
  minInitialBalance: '100',
  maxInitialBalance: '10000000',
  defaultInitialBalance: '10000',
  maxAccountsPerUser: 10,
} as const;

export const ORDER_LIMITS = {
  maxOpenOrdersPerAccount: 50,
  maxOpenPositionsPerAccount: 20,
  /** Orders created per account per rolling minute (counted in Postgres, so it holds across instances). */
  maxOrdersPerMinute: 30,
} as const;

export const STRATEGY_LIMITS = {
  maxLivePerUser: 5,
  maxLiveTotal: 500,
  evaluationTimeoutMs: 10_000,
  /** Closed candles kept after the warm-up so crossovers have history. */
  extraBars: 50,
} as const;

/** Execution defaults (per strategy instance overridable; manual orders use these). */
export const EXECUTION = {
  commissionPercent: '0.1',
  /** Market and stop fills move this many basis points against the order. */
  slippageBps: 5,
  /** Quotes older than this are stale: no fills, no market orders. */
  maxQuoteAgeMs: 15_000,
  /** A market order that cannot get a fresh price within this is expired and its reservation released. */
  marketOrderTimeoutMs: 60_000,
  /** Extra headroom reserved for market/stop orders, whose fill price is not known in advance. */
  reservationBufferPercent: '2',
  /** Shorts are force-closed when their loss reaches their collateral (price 2× entry at 1×). */
  liquidationLossRatio: '1',
} as const;

export const ENGINE = {
  refreshIntervalMs: 2_000,
  sweepIntervalMs: 15_000,
  metricsIntervalMs: 60_000,
  /** Candle evaluation job type on the shared background_jobs queue. */
  evaluateJobType: 'paper.strategy.evaluate',
} as const;
