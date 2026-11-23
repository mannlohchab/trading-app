import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from '../columns';
import { users } from '../identity/users';
import { communityPosts } from './community-posts';

/** Comments on posts. A reply's parent must be a comment on the same post (composite foreign key). */
export const communityComments = pgTable(
  'community_comments',
  {
    id: id(),
    postId: uuid().notNull().references(() => communityPosts.id, { onDelete: 'cascade' }),
    authorId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid(),
    body: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    check('community_comments_body_len_chk', sql`char_length(${t.body}) BETWEEN 1 AND 2000`),
    unique('community_comments_post_id_id_uq').on(t.postId, t.id),
    foreignKey({ name: 'community_comments_parent_fk', columns: [t.postId, t.parentId], foreignColumns: [t.postId, t.id] }).onDelete('cascade'),
    index('community_comments_post_idx').on(t.postId, t.createdAt, t.id),
    index('community_comments_author_idx').on(t.authorId, t.createdAt.desc()),
  ],
);
