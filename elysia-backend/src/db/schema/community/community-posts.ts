import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamptz, updatedAt } from '../columns';
import { users } from '../identity/users';

/**
 * Users' market posts. `like_count` and `comment_count` are kept by triggers on the like and comment
 * tables (drizzle/0010_*.sql), so they stay right however rows are removed (including cascades).
 */
export const communityPosts = pgTable(
  'community_posts',
  {
    id: id(),
    authorId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    body: text().notNull(),
    /** Optional instrument the post is about, e.g. BINANCE / BTCUSDT. Both set or both null. */
    exchange: varchar({ length: 20 }),
    symbol: varchar({ length: 30 }),
    likeCount: integer().notNull().default(0),
    commentCount: integer().notNull().default(0),
    isEditorsPick: boolean().notNull().default(false),
    /** Set when the post is hidden by moderation (e.g. enough distinct reports). Hidden posts are only visible to their author. */
    hiddenAt: timestamptz(),
    editedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    check('community_posts_body_len_chk', sql`char_length(${t.body}) BETWEEN 1 AND 5000`),
    check('community_posts_instrument_chk', sql`(${t.exchange} IS NULL) = (${t.symbol} IS NULL)`),
    check('community_posts_counts_chk', sql`${t.likeCount} >= 0 AND ${t.commentCount} >= 0`),
    index('community_posts_feed_idx').on(t.createdAt.desc(), t.id.desc()),
    index('community_posts_author_idx').on(t.authorId, t.createdAt.desc(), t.id.desc()),
    index('community_posts_instrument_idx').on(t.exchange, t.symbol, t.createdAt.desc(), t.id.desc()).where(sql`${t.symbol} IS NOT NULL`),
    index('community_posts_editors_idx').on(t.createdAt.desc(), t.id.desc()).where(sql`${t.isEditorsPick}`),
  ],
);

export type CommunityPostRow = typeof communityPosts.$inferSelect;
