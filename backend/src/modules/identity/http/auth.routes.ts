import { Hono } from 'hono';
import { withResolvedClientIp, type ClientIpResolver } from '../../../http/client-ip';
import { AUTH_BASE_PATH, type Auth } from '../infrastructure/better-auth';

/** Mounts every Better Auth endpoint under /api/v1/auth/*. */
export function authRoutes(auth: Auth, clientIp: ClientIpResolver) {
  return new Hono().on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, c => auth.handler(withResolvedClientIp(c, clientIp)));
}
