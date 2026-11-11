// Community module: traders post market findings (optionally tagged with an instrument and an image),
// and like, save, comment on, report and follow. Everything lives in Postgres; like and comment
// counts are kept by database triggers.
import { Hono, type MiddlewareHandler } from 'hono';
import type { AppDatabase } from '../../db/types';
import type { AuthVariables } from '../identity';
import { CommunityService } from './application/community.service';
import type { Clock, InstrumentResolver } from './application/ports';
import { communityImageRoutes, communityRoutes } from './http/community.routes';
import { DrizzleCommunityRepository } from './infrastructure/drizzle-community.repository';

export type { InstrumentResolver } from './application/ports';
export type { CommentView, PostView } from './application/community.service';

/** Resolves a user's symbol against the market module's active instruments. */
export function marketInstrumentResolver(market: {
  isActiveInstrument(exchange: string, symbol: string): Promise<boolean>;
  listExchanges(): Promise<{ code: string }[]>;
}): InstrumentResolver {
  return {
    async resolve(symbol, exchange) {
      const codes = exchange ? [exchange.trim().toUpperCase()] : (await market.listExchanges()).map(e => e.code);
      for (const code of codes) if (await market.isActiveInstrument(code, symbol)) return { exchange: code, symbol };
      return null;
    },
  };
}

const systemClock: Clock = { now: () => new Date() };

export function createCommunityModule(deps: {
  db: AppDatabase;
  requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }>;
  instruments: InstrumentResolver;
  /** Public origin of the API, for image links. */
  publicBaseUrl: string;
  clock?: Clock;
}) {
  const service = new CommunityService({
    repository: new DrizzleCommunityRepository(deps.db),
    instruments: deps.instruments,
    clock: deps.clock ?? systemClock,
    publicBaseUrl: deps.publicBaseUrl,
  });
  const routes = new Hono();
  routes.route('/', communityImageRoutes(service));
  routes.route('/', communityRoutes({ service, requireActiveUser: deps.requireActiveUser }));
  return { service, routes };
}

export type CommunityModule = ReturnType<typeof createCommunityModule>;
