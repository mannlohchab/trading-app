/** A news source could not be read (network, HTTP error, rate limit, unparseable body). */
export class NewsSourceUnavailableError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'NewsSourceUnavailableError';
  }
}

export class InvalidNewsQueryError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'InvalidNewsQueryError';
  }
}
