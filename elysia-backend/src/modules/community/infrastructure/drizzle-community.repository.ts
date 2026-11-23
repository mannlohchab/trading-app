import { and, asc, count, desc, eq, gte, isNull, or, sql, type Column, type SQL } from 'drizzle-orm';
import {
  communityBookmarks, communityComments, communityFollows, communityPostImages, communityPostLikes, communityPosts, communityReports,
  userProfiles, users,
} from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { Author, CommentRecord, CommunityRepository, FeedQuery, PostRecord } from '../application/ports';

const P = communityPosts;
const C = communityComments;
const U = users;
const PR = userProfiles;

/** µs since epoch as text: exact keyset position (Postgres timestamps keep microseconds). */
const micros = (column: SQL | Column) => sql<string>`(extract(epoch from ${column}) * 1000000)::bigint::text`;
/** Rows strictly before (`<`) or after (`>`) a cursor position. Raw SQL: pass strings, not Dates. */
const beyond = (column: SQL | Column, idColumn: SQL | Column, op: '<' | '>', c: { atMicros: string; id: string }) =>
  sql`(${column}, ${idColumn}) ${sql.raw(op)} ('epoch'::timestamptz + ${c.atMicros}::bigint * interval '1 microsecond', ${c.id}::uuid)`;

const authorColumns = {
  authorId: U.id, username: U.username, name: U.name, firstName: PR.firstName, lastName: PR.lastName,
  avatar: sql<string | null>`coalesce(${PR.profileImageUrl}, ${U.image})`,
};

type AuthorRow = { authorId: string; username: string | null; name: string | null; firstName: string | null; lastName: string | null; avatar: string | null };
const toAuthor = (r: AuthorRow): Author => ({ id: r.authorId, username: r.username, name: r.name, firstName: r.firstName, lastName: r.lastName, avatar: r.avatar });

const isActive = eq(U.status, 'ACTIVE');

export class DrizzleCommunityRepository implements CommunityRepository {
  constructor(private readonly db: AppDatabase) {}

  /** Posts joined with author, image and the viewer's like/save/follow state. */
  private posts(viewerId: string, sortColumn: SQL | Column = P.createdAt) {
    return this.db.select({
      id: P.id, body: P.body, exchange: P.exchange, symbol: P.symbol, likeCount: P.likeCount, commentCount: P.commentCount,
      isEditorsPick: P.isEditorsPick, hidden: sql<boolean>`${P.hiddenAt} IS NOT NULL`, createdAt: P.createdAt, editedAt: P.editedAt,
      imageId: communityPostImages.id,
      ...authorColumns,
      liked: sql<boolean>`EXISTS (SELECT 1 FROM ${communityPostLikes} WHERE ${communityPostLikes.postId} = ${P.id} AND ${communityPostLikes.userId} = ${viewerId})`,
      bookmarked: sql<boolean>`EXISTS (SELECT 1 FROM ${communityBookmarks} WHERE ${communityBookmarks.postId} = ${P.id} AND ${communityBookmarks.userId} = ${viewerId})`,
      followingAuthor: sql<boolean>`EXISTS (SELECT 1 FROM ${communityFollows} WHERE ${communityFollows.followerId} = ${viewerId} AND ${communityFollows.followeeId} = ${P.authorId})`,
      sortMicros: micros(sortColumn),
    })
      .from(P)
      .innerJoin(U, and(eq(U.id, P.authorId), isActive))
      .leftJoin(PR, eq(PR.userId, U.id))
      .leftJoin(communityPostImages, eq(communityPostImages.postId, P.id))
      .$dynamic();
  }

  private toPost(row: Awaited<ReturnType<ReturnType<DrizzleCommunityRepository['posts']>['execute']>>[number]): PostRecord {
    return {
      id: row.id, body: row.body, exchange: row.exchange, symbol: row.symbol, likeCount: row.likeCount, commentCount: row.commentCount,
      isEditorsPick: row.isEditorsPick, hidden: row.hidden, createdAt: row.createdAt, editedAt: row.editedAt, imageId: row.imageId,
      author: toAuthor(row), liked: row.liked, bookmarked: row.bookmarked, followingAuthor: row.followingAuthor, sortMicros: row.sortMicros,
    };
  }

  /** Hidden posts are only visible to their author. */
  private visibleTo = (viewerId: string) => or(isNull(P.hiddenAt), eq(P.authorId, viewerId))!;

  async createPost(input: Parameters<CommunityRepository['createPost']>[0]) {
    return this.db.transaction(async tx => {
      const [post] = await tx.insert(P).values({ authorId: input.authorId, body: input.body, exchange: input.exchange, symbol: input.symbol }).returning({ id: P.id });
      if (input.image) {
        await tx.insert(communityPostImages).values({ postId: post!.id, contentType: input.image.contentType, byteSize: input.image.bytes.length, data: input.image.bytes });
      }
      return post!.id;
    });
  }

  async findPost(viewerId: string, postId: string) {
    const [row] = await this.posts(viewerId).where(and(eq(P.id, postId), this.visibleTo(viewerId)));
    return row ? this.toPost(row) : null;
  }

  async feed(q: FeedQuery) {
    const conditions: SQL[] = [this.visibleTo(q.viewerId)];
    if (q.authorId) conditions.push(eq(P.authorId, q.authorId));
    if (q.instrument) conditions.push(eq(P.exchange, q.instrument.exchange), eq(P.symbol, q.instrument.symbol));

    if (q.tab === 'saved') {
      // Ordered by when the post was saved.
      const savedAt = sql`${communityBookmarks.createdAt}`;
      if (q.before) conditions.push(beyond(savedAt, sql`${P.id}`, '<', q.before));
      const rows = await this.posts(q.viewerId, savedAt)
        .innerJoin(communityBookmarks, and(eq(communityBookmarks.postId, P.id), eq(communityBookmarks.userId, q.viewerId)))
        .where(and(...conditions))
        .orderBy(desc(communityBookmarks.createdAt), desc(P.id))
        .limit(q.limit);
      return rows.map(r => this.toPost(r));
    }

    if (q.tab === 'editors') conditions.push(eq(P.isEditorsPick, true));
    if (q.tab === 'following') {
      conditions.push(sql`${P.authorId} IN (SELECT ${communityFollows.followeeId} FROM ${communityFollows} WHERE ${communityFollows.followerId} = ${q.viewerId})`);
    }
    if (q.before) conditions.push(beyond(P.createdAt, P.id, '<', q.before));
    const rows = await this.posts(q.viewerId).where(and(...conditions)).orderBy(desc(P.createdAt), desc(P.id)).limit(q.limit);
    return rows.map(r => this.toPost(r));
  }

  async editPost(authorId: string, postId: string, body: string, at: Date) {
    const rows = await this.db.update(P).set({ body, editedAt: at }).where(and(eq(P.id, postId), eq(P.authorId, authorId))).returning({ id: P.id });
    return rows.length > 0;
  }

  async deletePost(authorId: string, postId: string) {
    const rows = await this.db.delete(P).where(and(eq(P.id, postId), eq(P.authorId, authorId))).returning({ id: P.id });
    return rows.length > 0;
  }

  async setLike(userId: string, postId: string, liked: boolean) {
    if (liked) await this.db.insert(communityPostLikes).values({ postId, userId }).onConflictDoNothing();
    else await this.db.delete(communityPostLikes).where(and(eq(communityPostLikes.postId, postId), eq(communityPostLikes.userId, userId)));
    const [row] = await this.db.select({ likeCount: P.likeCount }).from(P).where(eq(P.id, postId));
    return row?.likeCount ?? 0;
  }

  async setBookmark(userId: string, postId: string, saved: boolean) {
    if (saved) await this.db.insert(communityBookmarks).values({ postId, userId }).onConflictDoNothing();
    else await this.db.delete(communityBookmarks).where(and(eq(communityBookmarks.postId, postId), eq(communityBookmarks.userId, userId)));
  }

  async setFollow(followerId: string, followeeId: string, following: boolean) {
    if (following) await this.db.insert(communityFollows).values({ followerId, followeeId }).onConflictDoNothing();
    else await this.db.delete(communityFollows).where(and(eq(communityFollows.followerId, followerId), eq(communityFollows.followeeId, followeeId)));
  }

  private commentQuery() {
    return this.db.select({ id: C.id, postId: C.postId, parentId: C.parentId, body: C.body, createdAt: C.createdAt, sortMicros: micros(C.createdAt), ...authorColumns })
      .from(C)
      .innerJoin(U, and(eq(U.id, C.authorId), isActive))
      .leftJoin(PR, eq(PR.userId, U.id))
      .$dynamic();
  }

  private toComment = (r: Awaited<ReturnType<ReturnType<DrizzleCommunityRepository['commentQuery']>['execute']>>[number]): CommentRecord => ({
    id: r.id, postId: r.postId, parentId: r.parentId, body: r.body, createdAt: r.createdAt, sortMicros: r.sortMicros, author: toAuthor(r),
  });

  async addComment(input: Parameters<CommunityRepository['addComment']>[0]) {
    const [row] = await this.db.insert(C).values(input).returning({ id: C.id });
    const [comment] = await this.commentQuery().where(eq(C.id, row!.id));
    return this.toComment(comment!);
  }

  async comments(postId: string, after: { atMicros: string; id: string } | undefined, limit: number) {
    const conditions: SQL[] = [eq(C.postId, postId)];
    if (after) conditions.push(beyond(C.createdAt, C.id, '>', after));
    const rows = await this.commentQuery().where(and(...conditions)).orderBy(asc(C.createdAt), asc(C.id)).limit(limit);
    return rows.map(this.toComment);
  }

  async findComment(commentId: string) {
    const [row] = await this.db.select({ id: C.id, postId: C.postId, authorId: C.authorId, postAuthorId: P.authorId })
      .from(C).innerJoin(P, eq(P.id, C.postId)).where(eq(C.id, commentId));
    return row ?? null;
  }

  async deleteComment(commentId: string) {
    await this.db.delete(C).where(eq(C.id, commentId));
  }

  async report(input: Parameters<CommunityRepository['report']>[0]) {
    return this.db.transaction(async tx => {
      await tx.insert(communityReports).values({ postId: input.postId, reporterId: input.reporterId, reason: input.reason, details: input.details })
        .onConflictDoUpdate({
          target: [communityReports.postId, communityReports.reporterId],
          set: { reason: input.reason, details: input.details },
        });
      const [{ reporters }] = await tx.select({ reporters: count() }).from(communityReports)
        .where(and(eq(communityReports.postId, input.postId), isNull(communityReports.resolvedAt))) as [{ reporters: number }];
      if (reporters < input.hideAt) return { hidden: false };
      await tx.update(P).set({ hiddenAt: input.now }).where(and(eq(P.id, input.postId), isNull(P.hiddenAt)));
      return { hidden: true };
    });
  }

  async isActiveUser(userId: string) {
    const [row] = await this.db.select({ id: U.id }).from(U).where(and(eq(U.id, userId), isActive));
    return !!row;
  }

  async userSummary(viewerId: string, userId: string) {
    const [row] = await this.db.select({
      ...authorColumns,
      postCount: sql<number>`(SELECT count(*)::int FROM ${P} WHERE ${P.authorId} = ${U.id} AND (${P.hiddenAt} IS NULL OR ${P.authorId} = ${viewerId}))`,
      followerCount: sql<number>`(SELECT count(*)::int FROM ${communityFollows} f JOIN ${U} fu ON fu.id = f.follower_id AND fu.status = 'ACTIVE' WHERE f.followee_id = ${U.id})`,
      followingCount: sql<number>`(SELECT count(*)::int FROM ${communityFollows} f JOIN ${U} fu ON fu.id = f.followee_id AND fu.status = 'ACTIVE' WHERE f.follower_id = ${U.id})`,
      following: sql<boolean>`EXISTS (SELECT 1 FROM ${communityFollows} WHERE ${communityFollows.followerId} = ${viewerId} AND ${communityFollows.followeeId} = ${U.id})`,
    }).from(U).leftJoin(PR, eq(PR.userId, U.id)).where(and(eq(U.id, userId), isActive));
    if (!row) return null;
    return { author: toAuthor(row), postCount: row.postCount, followerCount: row.followerCount, followingCount: row.followingCount, following: row.following };
  }

  async countPostsSince(authorId: string, since: Date) {
    const [row] = await this.db.select({ n: count() }).from(P).where(and(eq(P.authorId, authorId), gte(P.createdAt, since)));
    return row?.n ?? 0;
  }

  async countCommentsSince(authorId: string, since: Date) {
    const [row] = await this.db.select({ n: count() }).from(C).where(and(eq(C.authorId, authorId), gte(C.createdAt, since)));
    return row?.n ?? 0;
  }

  async image(imageId: string) {
    const [row] = await this.db.select({ contentType: communityPostImages.contentType, data: communityPostImages.data })
      .from(communityPostImages)
      .innerJoin(P, eq(P.id, communityPostImages.postId))
      .innerJoin(U, and(eq(U.id, P.authorId), isActive))
      .where(and(eq(communityPostImages.id, imageId), isNull(P.hiddenAt)));
    return row ?? null;
  }
}
