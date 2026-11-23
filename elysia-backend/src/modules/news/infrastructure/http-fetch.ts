// Fetching from news sources: timeout covering the body, size cap, rate-limit handling, and error
// messages that never contain the request URL (CryptoPanic's key travels in the query string).
import { NewsSourceUnavailableError } from '../application/errors';

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type FetchOptions = { fetch?: Fetcher; timeoutMs?: number; maxBytes?: number; now?: () => number };

const USER_AGENT = 'TradingGurukulNewsBot/1.0 (+news aggregation; polite polling)';
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/** Remembers a source's Retry-After so we stop calling it until then. One per source. */
export class SourceGate {
  private blockedUntil = 0;
  constructor(private readonly name: string, private readonly options: FetchOptions = {}) {}

  private now() { return (this.options.now ?? Date.now)(); }

  async text(url: string, accept: string): Promise<string> {
    const now = this.now();
    if (now < this.blockedUntil) throw new NewsSourceUnavailableError(`${this.name} rate limit cooldown`, this.blockedUntil - now);
    let response: Response;
    const signal = AbortSignal.timeout(this.options.timeoutMs ?? 15_000);
    try {
      response = await (this.options.fetch ?? fetch)(url, { signal, redirect: 'follow', headers: { 'User-Agent': USER_AGENT, Accept: accept } });
    } catch (error) {
      throw new NewsSourceUnavailableError(`${this.name} request failed: ${reason(error)}`);
    }
    if (response.status === 429 || response.status === 503) {
      const retryAfterMs = retryAfter(response.headers.get('retry-after'), this.now()) ?? 15 * 60_000;
      this.blockedUntil = this.now() + retryAfterMs;
      await response.body?.cancel().catch(() => {});
      throw new NewsSourceUnavailableError(`${this.name} rate limited (${response.status})`, retryAfterMs);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new NewsSourceUnavailableError(`${this.name} answered ${response.status}`);
    }
    const max = this.options.maxBytes ?? DEFAULT_MAX_BYTES;
    if (Number(response.headers.get('content-length') ?? 0) > max) {
      await response.body?.cancel().catch(() => {});
      throw new NewsSourceUnavailableError(`${this.name} response is larger than ${max} bytes`);
    }
    try {
      return await readCapped(response, max);
    } catch (error) {
      if (error instanceof NewsSourceUnavailableError) throw error;
      throw new NewsSourceUnavailableError(`${this.name} response could not be read: ${reason(error)}`);
    }
  }

  async json<T>(url: string): Promise<T> {
    const body = await this.text(url, 'application/json');
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new NewsSourceUnavailableError(`${this.name} returned invalid JSON`);
    }
  }
}

async function readCapped(response: Response, max: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new NewsSourceUnavailableError(`response is larger than ${max} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Retry-After as seconds or an HTTP date, capped at 6 hours. */
function retryAfter(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 6 * 3_600_000) : undefined;
}

// Fetch errors can embed the URL; keep only the first line and strip anything URL-shaped.
const reason = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0]!.replace(/https?:\/\/\S+/g, '<url>').slice(0, 200);
