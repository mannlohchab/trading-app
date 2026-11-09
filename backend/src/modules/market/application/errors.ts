export type MarketErrorCode = 'UNKNOWN_EXCHANGE' | 'UNKNOWN_SYMBOL' | 'INVALID_REQUEST' | 'PROVIDER_UNAVAILABLE';

/** Expected failures of market use cases. The HTTP layer maps `code` to a status. */
export class MarketError extends Error {
  constructor(readonly code: MarketErrorCode, message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'MarketError';
  }
}

/** Thrown by providers when the upstream exchange can't be reached or refuses the request. */
export class ProviderUnavailableError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}
