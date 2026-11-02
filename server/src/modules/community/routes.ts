import { Router } from 'express';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db';
import {
  bookmarks,
  comments,
  follows,
  posts,
  reactions,
  reports,
  users,
} from '../../db/schema';
import { AppError, assertFound } from '../../lib/errors';
import { id } from '../../lib/ids';
import { requireInstrument } from '../../providers/instruments';
import { optionalAuth, requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { param } from '../../lib/params';

export const communityRouter = Router();

async function enrichPosts(postRows: (typeof posts.$inferSelect)[], viewerId?: string) {
  if (!postRows.length) return [];
  const userIds = [...new Set(postRows.map((p) => p.userId))];
  const authors = await db.query.users.findMany({ where: inArray(users.id, userIds) });
  const authorMap = new Map(authors.map((u) => [u.id, u]));

  let liked = new Set<string>();
  let bookmarked = new Set<string>();
  if (viewerId) {
    const postIds = postRows.map((p) => p.id);
    const likes = await db.query.reactions.findMany({
      where: and(eq(reactions.userId, viewerId), inArray(reactions.postId, postIds)),
    });
    const marks = await db.query.bookmarks.findMany({
      where: and(eq(bookmarks.userId, viewerId), inArray(bookmarks.postId, postIds)),
    });
    liked = new Set(likes.map((l) => l.postId));
    bookmarked = new Set(marks.map((b) => b.postId));
  }

  return postRows.map((p) => {
    const author = authorMap.get(p.userId)!;
    return {
      ...p,
      liked: liked.has(p.id),
      bookmarked: bookmarked.has(p.id),
      author: {
        id: author.id,
        username: author.username,
        displayName: author.displayName,
        avatarUrl: author.avatarUrl,
      },
    };
  });
}

communityRouter.get('/feed', optionalAuth, async (req, res, next) => {
  try {
    const tab = String(req.query.tab ?? 'foryou');
    const cursor = Number(req.query.offset ?? 0);
    const limit = Math.min(Number(req.query.limit ?? 20), 50);

    let rows: (typeof posts.$inferSelect)[] = [];
    if (tab === 'editors') {
      rows = await db.query.posts.findMany({
        where: eq(posts.isEditorsPick, true),
        orderBy: [desc(posts.createdAt)],
        limit,
        offset: cursor,
      });
    } else if (tab === 'following') {
      if (!req.user) throw new AppError(401, 'Authentication required');
      const following = await db.query.follows.findMany({
        where: eq(follows.followerId, req.user.userId),
      });
      const ids = following.map((f) => f.followingId);
      if (ids.length) {
        rows = await db.query.posts.findMany({
          where: inArray(posts.userId, ids),
          orderBy: [desc(posts.createdAt)],
          limit,
          offset: cursor,
        });
      }
    } else {
      rows = await db.query.posts.findMany({
        orderBy: [desc(posts.likeCount), desc(posts.createdAt)],
        limit,
        offset: cursor,
      });
    }

    res.json({ posts: await enrichPosts(rows, req.user?.userId), nextOffset: cursor + rows.length });
  } catch (err) {
    next(err);
  }
});

communityRouter.get('/posts/:id', optionalAuth, async (req, res, next) => {
  try {
    const post = assertFound(await db.query.posts.findFirst({ where: eq(posts.id, param(req, 'id')) }));
    const [enriched] = await enrichPosts([post], req.user?.userId);
    const commentRows = await db.query.comments.findMany({
      where: eq(comments.postId, post.id),
      orderBy: [desc(comments.createdAt)],
    });
    const authorIds = [...new Set(commentRows.map((c) => c.userId))];
    const authors = authorIds.length
      ? await db.query.users.findMany({ where: inArray(users.id, authorIds) })
      : [];
    const amap = new Map(authors.map((a) => [a.id, a]));
    res.json({
      post: enriched,
      comments: commentRows.map((c) => ({
        ...c,
        author: {
          id: amap.get(c.userId)?.id,
          username: amap.get(c.userId)?.username,
          displayName: amap.get(c.userId)?.displayName,
          avatarUrl: amap.get(c.userId)?.avatarUrl,
        },
      })),
    });
  } catch (err) {
    next(err);
  }
});

communityRouter.post(
  '/posts',
  requireAuth,
  validateBody(
    z.object({
      content: z.string().min(1).max(5000),
      imageUrl: z.string().optional(),
      symbol: z.string().optional(),
      exchange: z.string().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const body = req.body as { content: string; imageUrl?: string; symbol?: string; exchange?: string };
      const instrument = body.symbol?.trim() ? requireInstrument(body.symbol, body.exchange || undefined) : undefined;
      const row = {
        id: id(),
        userId: req.user!.userId,
        content: body.content,
        imageUrl: body.imageUrl,
        symbol: instrument?.symbol,
        exchange: instrument?.exchange,
      };
      await db.insert(posts).values(row);
      const [enriched] = await enrichPosts(
        [(await db.query.posts.findFirst({ where: eq(posts.id, row.id) }))!],
        req.user!.userId,
      );
      res.status(201).json({ post: enriched });
    } catch (err) {
      next(err);
    }
  },
);

communityRouter.post('/posts/:id/like', requireAuth, async (req, res, next) => {
  try {
    const post = assertFound(await db.query.posts.findFirst({ where: eq(posts.id, param(req, 'id')) }));
    const existing = await db.query.reactions.findFirst({
      where: and(eq(reactions.userId, req.user!.userId), eq(reactions.postId, post.id)),
    });
    if (existing) {
      await db.delete(reactions).where(eq(reactions.id, existing.id));
      await db.update(posts).set({ likeCount: sql`max(${posts.likeCount} - 1, 0)` }).where(eq(posts.id, post.id));
      res.json({ liked: false });
    } else {
      await db.insert(reactions).values({ id: id(), userId: req.user!.userId, postId: post.id, type: 'like' });
      await db.update(posts).set({ likeCount: sql`${posts.likeCount} + 1` }).where(eq(posts.id, post.id));
      res.json({ liked: true });
    }
  } catch (err) {
    next(err);
  }
});

communityRouter.post(
  '/posts/:id/comments',
  requireAuth,
  validateBody(z.object({ content: z.string().min(1).max(2000), parentId: z.string().optional() })),
  async (req, res, next) => {
    try {
      const post = assertFound(await db.query.posts.findFirst({ where: eq(posts.id, param(req, 'id')) }));
      const body = req.body as { content: string; parentId?: string };
      const row = {
        id: id(),
        postId: post.id,
        userId: req.user!.userId,
        parentId: body.parentId,
        content: body.content,
      };
      await db.insert(comments).values(row);
      await db.update(posts).set({ commentCount: sql`${posts.commentCount} + 1` }).where(eq(posts.id, post.id));
      res.status(201).json({ comment: row });
    } catch (err) {
      next(err);
    }
  },
);

communityRouter.post('/posts/:id/bookmark', requireAuth, async (req, res, next) => {
  try {
    const post = assertFound(await db.query.posts.findFirst({ where: eq(posts.id, param(req, 'id')) }));
    const existing = await db.query.bookmarks.findFirst({
      where: and(eq(bookmarks.userId, req.user!.userId), eq(bookmarks.postId, post.id)),
    });
    if (existing) {
      await db.delete(bookmarks).where(eq(bookmarks.id, existing.id));
      res.json({ bookmarked: false });
    } else {
      await db.insert(bookmarks).values({ id: id(), userId: req.user!.userId, postId: post.id });
      res.json({ bookmarked: true });
    }
  } catch (err) {
    next(err);
  }
});

communityRouter.post(
  '/posts/:id/report',
  requireAuth,
  validateBody(z.object({ reason: z.string().min(3).max(500) })),
  async (req, res, next) => {
    try {
      const post = assertFound(await db.query.posts.findFirst({ where: eq(posts.id, param(req, 'id')) }));
      const body = req.body as { reason: string };
      await db.insert(reports).values({
        id: id(),
        reporterId: req.user!.userId,
        postId: post.id,
        reason: body.reason,
      });
      res.status(201).json({ ok: true, message: 'Report submitted for moderation review' });
    } catch (err) {
      next(err);
    }
  },
);

communityRouter.post('/users/:id/follow', requireAuth, async (req, res, next) => {
  try {
    const targetId = param(req, 'id');
    if (targetId === req.user!.userId) throw new AppError(400, 'Cannot follow yourself');
    assertFound(await db.query.users.findFirst({ where: eq(users.id, targetId) }));
    const existing = await db.query.follows.findFirst({
      where: and(eq(follows.followerId, req.user!.userId), eq(follows.followingId, targetId)),
    });
    if (existing) {
      await db.delete(follows).where(eq(follows.id, existing.id));
      res.json({ following: false });
    } else {
      await db.insert(follows).values({ id: id(), followerId: req.user!.userId, followingId: targetId });
      res.json({ following: true });
    }
  } catch (err) {
    next(err);
  }
});
