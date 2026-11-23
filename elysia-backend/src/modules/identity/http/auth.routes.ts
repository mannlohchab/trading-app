import { Elysia, type Context } from 'elysia';
import { withResolvedClientIp, type ClientIpResolver } from '../../../http/client-ip';
import { AUTH_BASE_PATH, type Auth } from '../infrastructure/better-auth';

/** Mounts every Better Auth endpoint under /api/v1/auth/*. */
export function authRoutes(auth: Auth, clientIp: ClientIpResolver) {
  const handle = (c: Context) => auth.handler(withResolvedClientIp(c, clientIp));
  return new Elysia()
    .get(`${AUTH_BASE_PATH}/*`, handle, { parse: 'none' })
    .post(`${AUTH_BASE_PATH}/*`, handle, { parse: 'none' });
}
