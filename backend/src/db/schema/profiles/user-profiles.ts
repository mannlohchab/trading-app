import { pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from '../columns';
import { users } from '../identity/users';

export const userProfiles = pgTable('user_profiles', {
  id: id(),
  userId: uuid()
    .notNull()
    .unique('user_profiles_user_id_key')
    .references(() => users.id, { onDelete: 'cascade' }),
  firstName: varchar({ length: 100 }),
  lastName: varchar({ length: 100 }),
  profileImageUrl: text(),
  bio: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
