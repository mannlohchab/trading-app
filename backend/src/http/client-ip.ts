import type { Context } from 'hono';
import { getConnInfo } from 'hono/bun';

/** Internal header carrying the resolved client IP. Any client-sent value is overwritten. */
export const CLIENT_IP_HEADER = 'x-client-ip';

export type ClientIpResolver = (c: Context) => string | undefined;

/**
 * Resolves the caller's IP for rate limiting and session records.
 * - No trusted header: the TCP peer address (direct exposure; client headers are ignored).
 * - Trusted header (only when behind a proxy that sets it): `cf-connecting-ip`, or the last
 *   entry of `x-forwarded-for` (the address the closest proxy saw).
 */
export function clientIpResolver(trustedProxyHeader?: string): ClientIpResolver {
  const header = trustedProxyHeader?.toLowerCase();
  return c => {
    if (header) {
      const value = c.req.header(header);
      if (!value) return undefined;
      return header === 'x-forwarded-for' ? value.split(',').at(-1)?.trim() || undefined : value.trim();
    }
    try {
      return getConnInfo(c).remote.address;
    } catch {
      return undefined; // not running under Bun.serve (e.g. app.request in tests)
    }
  };
}

/** Copy of the request whose only client-IP signal is the resolved address. */
export function withResolvedClientIp(c: Context, resolve: ClientIpResolver): Request {
  const headers = new Headers(c.req.raw.headers);
  headers.delete(CLIENT_IP_HEADER);
  const ip = resolve(c);
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  return new Request(c.req.raw, { headers });
}
