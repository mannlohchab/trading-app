/** Expected HTTP failures carry a safe, public response; unexpected errors stay private. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly payload: { error: string; [key: string]: unknown }) {
    super(payload.error);
    this.name = 'HttpError';
  }
}
