// Profiles module: the user's public profile and app/trading/AI preferences.
import type { AppDatabase } from '../../db/types';
import type { UserGuard } from '../identity';
import { ProfileService } from './application/profile.service';
import { profileRoutes } from './http/profile.routes';
import { DrizzlePreferencesStore } from './infrastructure/drizzle-preferences.store';
import { DrizzleProfileStore } from './infrastructure/drizzle-profile.store';

export type { Preferences } from './domain/preferences';

export function createProfilesModule(deps: { db: AppDatabase; requireActiveUser: UserGuard }) {
  const service = new ProfileService({
    profiles: new DrizzleProfileStore(deps.db),
    preferences: new DrizzlePreferencesStore(deps.db),
  });
  return { service, routes: profileRoutes(service, deps.requireActiveUser) };
}

export type ProfilesModule = ReturnType<typeof createProfilesModule>;
