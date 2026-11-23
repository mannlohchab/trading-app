import { sql } from 'drizzle-orm';
import { check, customType, index, integer, pgTable, primaryKey, text, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz } from '../columns';
import { users } from '../identity/users';
import { communityPosts } from './community-posts';

const bytea = customType<{ data: Uint8Array }>({ dataType: () => 'bytea' });

/** One like per user and post. */
export const communityPostLikes = pgTable(
  'community_post_likes',
  {
    postId: uuid().notNull().references(() => communityPosts.id, { onDelete: 'cascade' }),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  t => [primaryKey({ columns: [t.postId, t.userId] }), index('community_post_likes_user_idx').on(t.userId)],
);

/** Posts a user saved for later ("Saved" feed). */
export const communityBookmarks = pgTable(
  'community_bookmarks',
  {
    postId: uuid().notNull().references(() => communityPosts.id, { onDelete: 'cascade' }),
    userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  t => [primaryKey({ columns: [t.userId, t.postId] }), index('community_bookmarks_saved_idx').on(t.userId, t.createdAt.desc(), t.postId.desc())],
);

export const communityFollows = pgTable(
  'community_follows',
  {
    followerId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    followeeId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  t => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    check('community_follows_not_self_chk', sql`${t.followerId} <> ${t.followeeId}`),
    index('community_follows_followee_idx').on(t.followeeId),
  ],
);

/** User reports for moderation. One per reporter and post; `resolved_at` is for moderators. */
export const communityReports = pgTable(
  'community_reports',
  {
    id: id(),
    postId: uuid().notNull().references(() => communityPosts.id, { onDelete: 'cascade' }),
    reporterId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    reason: varchar({ length: 30 }).notNull(),
    details: varchar({ length: 500 }),
    resolvedAt: timestamptz(),
    createdAt: createdAt(),
  },
  t => [
    unique('community_reports_post_reporter_uq').on(t.postId, t.reporterId),
    index('community_reports_open_idx').on(t.createdAt).where(sql`${t.resolvedAt} IS NULL`),
  ],
);

/** The image attached to a post, stored in Postgres (no object store yet). Deleted with the post. */
export const communityPostImages = pgTable(
  'community_post_images',
  {
    id: id(),
    postId: uuid().notNull().unique('community_post_images_post_uq').references(() => communityPosts.id, { onDelete: 'cascade' }),
    contentType: text().notNull(),
    byteSize: integer().notNull(),
    data: bytea().notNull(),
    createdAt: createdAt(),
  },
  t => [
    check('community_post_images_type_chk', sql`${t.contentType} IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')`),
    check('community_post_images_size_chk', sql`${t.byteSize} BETWEEN 1 AND 2000000 AND octet_length(${t.data}) = ${t.byteSize}`),
  ],
);
