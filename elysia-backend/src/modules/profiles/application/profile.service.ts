import { applyPreferencesPatch, DEFAULT_PREFERENCES, validateTradingSelection, type Preferences, type PreferencesPatch } from '../domain/preferences';
import { validateProfileChanges, type Profile, type ProfileChanges } from '../domain/profile';
import type { FieldErrors } from '../domain/validation';
import type { PreferencesStore, ProfileStore } from './ports';

export type UpdateResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: 'VALIDATION_ERROR'; fields: FieldErrors }
  | { ok: false; error: 'USERNAME_TAKEN' | 'NOT_FOUND' };

export class ProfileService {
  constructor(private readonly deps: { profiles: ProfileStore; preferences: PreferencesStore }) {}

  getProfile(userId: string): Promise<Profile | null> {
    return this.deps.profiles.find(userId);
  }

  async updateProfile(userId: string, changes: ProfileChanges): Promise<UpdateResult<Profile>> {
    const validated = validateProfileChanges(changes);
    if (!validated.ok) return { ok: false, error: 'VALIDATION_ERROR', fields: validated.errors };
    if ((await this.deps.profiles.update(userId, validated.value)) === 'USERNAME_TAKEN') return { ok: false, error: 'USERNAME_TAKEN' };
    const profile = await this.deps.profiles.find(userId);
    return profile ? { ok: true, value: profile } : { ok: false, error: 'NOT_FOUND' };
  }

  async getPreferences(userId: string): Promise<Preferences> {
    return (await this.deps.preferences.find(userId)) ?? structuredClone(DEFAULT_PREFERENCES);
  }

  updatePreferences(userId: string, patch: PreferencesPatch): Promise<UpdateResult<Preferences>> {
    return this.deps.preferences.update<UpdateResult<Preferences>>(userId, async (current, catalog) => {
      const applied = applyPreferencesPatch(current, patch);
      if (!applied.ok) return { reject: { ok: false, error: 'VALIDATION_ERROR', fields: applied.errors } };
      const next = applied.value;

      const exchange = next.trading.exchange ? await catalog.findExchange(next.trading.exchange) : null;
      const symbol = exchange && next.trading.tradingPair ? await catalog.findSymbol(exchange.id, next.trading.tradingPair) : null;
      const fields = validateTradingSelection(next.trading, exchange, symbol);
      if (Object.keys(fields).length) return { reject: { ok: false, error: 'VALIDATION_ERROR', fields } };

      return { save: next, refs: { exchangeId: exchange?.id ?? null, symbolId: symbol?.id ?? null }, result: { ok: true, value: next } };
    });
  }
}
