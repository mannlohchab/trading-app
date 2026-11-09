import { eq } from 'drizzle-orm';
import { isUniqueViolation } from '../../../db/errors';
import { userPreferences, users } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { ProfileStore } from '../application/ports';
import { DEFAULT_PREFERENCES } from '../domain/preferences';

/**
 * Profile fields live on `users` (name, username, image: shared with Better Auth) and
 * `user_preferences` (timezone). This module owns those display fields; identity owns the rest.
 */
export class DrizzleProfileStore implements ProfileStore {
  constructor(private readonly db: AppDatabase) {}

  async find(userId: string) {
    const [row] = await this.db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        image: users.image,
        email: users.email,
        phoneNumber: users.phoneNumber,
        timezone: userPreferences.timezone,
      })
      .from(users)
      .leftJoin(userPreferences, eq(userPreferences.userId, users.id))
      .where(eq(users.id, userId));
    return row ? { ...row, timezone: row.timezone ?? DEFAULT_PREFERENCES.general.timezone } : null;
  }

  async update(userId: string, { timezone, ...userFields }: Parameters<ProfileStore['update']>[1]) {
    try {
      await this.db.transaction(async tx => {
        if (Object.keys(userFields).length) await tx.update(users).set(userFields).where(eq(users.id, userId));
        if (timezone !== undefined) {
          await tx
            .insert(userPreferences)
            .values({ userId, timezone })
            .onConflictDoUpdate({ target: userPreferences.userId, set: { timezone } });
        }
      });
      return 'OK' as const;
    } catch (error) {
      if (isUniqueViolation(error, 'users_username_lower_uq')) return 'USERNAME_TAKEN' as const;
      throw error;
    }
  }
}
