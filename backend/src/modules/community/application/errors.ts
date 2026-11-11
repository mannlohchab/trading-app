export type CommunityErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'RATE_LIMITED';

/** An expected failure of a community action; the HTTP layer maps `code` to a status. */
export class CommunityError extends Error {
  constructor(
    readonly code: CommunityErrorCode,
    message: string,
    /** Per-field messages for VALIDATION_ERROR. */
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'CommunityError';
  }
}

export const invalid = (field: string, message: string) => new CommunityError('VALIDATION_ERROR', message, { [field]: message });
export const notFound = (what: 'Post' | 'Comment' | 'User') => new CommunityError('NOT_FOUND', `${what} not found.`);
