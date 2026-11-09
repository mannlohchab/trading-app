export type PaperErrorCode =
  | 'VALIDATION_ERROR' | 'NOT_FOUND' | 'ACCOUNT_NOT_ACTIVE' | 'TOO_MANY_ACCOUNTS' | 'UNKNOWN_SYMBOL' | 'INVALID_ORDER'
  | 'INSUFFICIENT_BALANCE' | 'LIMIT_EXCEEDED' | 'RATE_LIMITED' | 'NOT_CANCELLABLE' | 'STALE_PRICE' | 'NO_POSITION'
  | 'STRATEGY_NOT_FOUND' | 'INVALID_STRATEGY' | 'STRATEGY_CONFLICT' | 'INVALID_TRANSITION' | 'ACCOUNT_NOT_EMPTY';

export class PaperError extends Error {
  constructor(readonly code: PaperErrorCode, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PaperError';
  }
}
