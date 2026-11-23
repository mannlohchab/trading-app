/** Internal header carrying the resolved client IP. Any client-sent value is overwritten. */
export const CLIENT_IP_HEADER = 'x-client-ip';

type ClientIpContext = {
  request: Request;
  server?: { requestIP: (request: Request) => { address: string } | null } | null;
};
export type ClientIpResolver = (c: ClientIpContext) => string | undefined;

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
      const value = c.request.headers.get(header);
      if (!value) return undefined;
      return header === 'x-forwarded-for' ? value.split(',').at(-1)?.trim() || undefined : value.trim();
    }
    try {
      return c.server?.requestIP(c.request)?.address;
    } catch {
      return undefined; // not running under Bun.serve (e.g. app.handle in tests)
    }
  };
}

/** Copy of the request whose only client-IP signal is the resolved address. */
export function withResolvedClientIp(c: ClientIpContext, resolve: ClientIpResolver): Request {
  const request = new Request(c.request);
  request.headers.delete(CLIENT_IP_HEADER);
  const ip = resolve(c);
  if (ip) request.headers.set(CLIENT_IP_HEADER, ip);
  return request;
}
