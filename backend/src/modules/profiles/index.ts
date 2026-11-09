// Profiles module: the user's public profile and app/trading/AI preferences.
import type { MiddlewareHandler } from 'hono';
import type { AppDatabase } from '../../db/types';
import type { AuthVariables } from '../identity';
import { ProfileService } from './application/profile.service';
import { profileRoutes } from './http/profile.routes';
import { DrizzlePreferencesStore } from './infrastructure/drizzle-preferences.store';
import { DrizzleProfileStore } from './infrastructure/drizzle-profile.store';

export type { Preferences } from './domain/preferences';

export function createProfilesModule(deps: { db: AppDatabase; requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }> }) {
  const service = new ProfileService({
    profiles: new DrizzleProfileStore(deps.db),
    preferences: new DrizzlePreferencesStore(deps.db),
  });
  return { service, routes: profileRoutes(service, deps.requireActiveUser) };
}

export type ProfilesModule = ReturnType<typeof createProfilesModule>;
