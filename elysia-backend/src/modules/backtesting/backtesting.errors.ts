/** Shared domain errors; repositories and HTTP handlers must not depend on the service module. */
export type BacktestErrorCode =
  | 'VALIDATION_ERROR' | 'NOT_FOUND' | 'STRATEGY_NOT_FOUND' | 'UNKNOWN_SYMBOL' | 'INVALID_STRATEGY' | 'RANGE_TOO_LARGE'
  | 'INSUFFICIENT_DATA' | 'DATA_GAPS' | 'TOO_MANY_ACTIVE' | 'NOT_CANCELLABLE' | 'BUSY' | 'ENGINE_ERROR' | 'MARKET_DATA_UNAVAILABLE';

export class BacktestError extends Error {
  constructor(readonly code: BacktestErrorCode, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'BacktestError';
  }
}
