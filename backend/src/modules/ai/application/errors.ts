export type AiErrorCode =
  | 'AI_NOT_CONFIGURED'
  | 'AI_RATE_LIMITED'
  | 'AI_PROVIDER_QUOTA'
  | 'AI_AUTH_ERROR'
  | 'AI_MODEL_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'AI_PROVIDER_ERROR';

/** Expected provider failures. `retryable` = another model or a later retry may succeed. */
export class AiProviderError extends Error {
  constructor(readonly code: AiErrorCode, message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'AiProviderError';
  }
}
