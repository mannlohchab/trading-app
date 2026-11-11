import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { parseJson, validationError } from '../../../http/validation';
import type { AuthVariables } from '../../identity';
import { FEED_TABS, type CommunityService, type FeedTab } from '../application/community.service';
import { CommunityError } from '../application/errors';
import { COMMENT_PAGE, PAGE } from '../domain/rules';

const STATUS = { VALIDATION_ERROR: 400, FORBIDDEN: 403, NOT_FOUND: 404, RATE_LIMITED: 429 } as const;

const feedQuery = z.object({
  tab: z.enum(FEED_TABS as [FeedTab, ...FeedTab[]]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE.max).optional(),
  author: z.string().max(64).optional(),
  symbol: z.string().max(40).optional(),
  exchange: z.string().max(20).optional(),
});
const commentsQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(COMMENT_PAGE.max).optional(),
});
// Lengths are checked again (after clean-up) by the domain; these bounds only stop oversized input early.
const createPost = z.object({
  content: z.string().max(20_000),
  symbol: z.string().max(40).nullish(),
  exchange: z.string().max(20).nullish(),
  /** Base64 data URL of a JPEG, PNG, WebP or GIF. */
  image: z.string().max(2_100_000).nullish(),
  /** Older app builds send the data URL as `imageUrl`. */
  imageUrl: z.string().max(2_100_000).nullish(),
});
const editPost = z.object({ content: z.string().max(20_000) });
const createComment = z.object({ content: z.string().max(8_000), parentId: z.string().max(64).nullish() });
const report = z.object({ reason: z.string().trim().min(1).max(100), details: z.string().max(2_000).nullish() });

const SMALL_BODY = 32 * 1024;
const POST_BODY = 2_500_000;
const tooLarge = (c: Context) => c.json({ error: 'Request body is too large.', code: 'PAYLOAD_TOO_LARGE' }, 413);

export function communityRoutes(deps: { service: CommunityService; requireActiveUser: MiddlewareHandler<{ Variables: AuthVariables }> }) {
  const { service } = deps;
  const routes = new Hono<{ Variables: AuthVariables }>().basePath('/api/v1/community');
  routes.use('*', deps.requireActiveUser);
  // Posts may carry an image; everything else is small.
  routes.use('*', async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'DELETE') return next();
    const maxSize = c.req.method === 'POST' && c.req.path === '/api/v1/community/posts' ? POST_BODY : SMALL_BODY;
    return bodyLimit({ maxSize, onError: tooLarge })(c, next);
  });
  routes.onError((error, c) => {
    if (error instanceof CommunityError) {
      if (error.code === 'VALIDATION_ERROR') return validationError(c, error.fields ?? { '(body)': error.message });
      return c.json({ error: error.message, code: error.code }, STATUS[error.code]);
    }
    throw error;
  });

  const query = <S extends z.ZodType>(schema: S, c: Context): { data: z.infer<S> } | { response: Response } => {
    const parsed = schema.safeParse(c.req.query());
    if (parsed.success) return { data: parsed.data };
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join('.') || '(query)'] ??= issue.message;
    return { response: validationError(c, fields) };
  };

  // Feeds: ?tab=foryou|editors|following|saved, narrowed by &author=<userId> or &symbol=BTCUSDT[&exchange=BINANCE].
  routes.get('/feed', async c => {
    const q = query(feedQuery, c);
    if ('response' in q) return q.response;
    const { author, ...rest } = q.data;
    return c.json(await service.feed(c.var.user.id, { ...rest, authorId: author }));
  });

  routes.post('/posts', async c => {
    const body = await parseJson(c, createPost);
    if ('response' in body) return body.response;
    const { image, imageUrl, ...rest } = body.data;
    const post = await service.createPost(c.var.user.id, { ...rest, image: image ?? imageUrl });
    return c.json({ post }, 201);
  });

  routes.get('/posts/:id', async c => c.json(await service.getPost(c.var.user.id, c.req.param('id'))));

  routes.patch('/posts/:id', async c => {
    const body = await parseJson(c, editPost);
    if ('response' in body) return body.response;
    return c.json({ post: await service.editPost(c.var.user.id, c.req.param('id'), body.data.content) });
  });

  routes.delete('/posts/:id', async c => {
    await service.deletePost(c.var.user.id, c.req.param('id'));
    return c.body(null, 204);
  });

  // Likes, saves and follows are idempotent: PUT sets, DELETE clears.
  routes.put('/posts/:id/like', async c => c.json(await service.setLike(c.var.user.id, c.req.param('id'), true)));
  routes.delete('/posts/:id/like', async c => c.json(await service.setLike(c.var.user.id, c.req.param('id'), false)));
  routes.put('/posts/:id/bookmark', async c => c.json(await service.setBookmark(c.var.user.id, c.req.param('id'), true)));
  routes.delete('/posts/:id/bookmark', async c => c.json(await service.setBookmark(c.var.user.id, c.req.param('id'), false)));

  routes.get('/posts/:id/comments', async c => {
    const q = query(commentsQuery, c);
    if ('response' in q) return q.response;
    return c.json(await service.comments(c.var.user.id, c.req.param('id'), q.data));
  });

  routes.post('/posts/:id/comments', async c => {
    const body = await parseJson(c, createComment);
    if ('response' in body) return body.response;
    return c.json({ comment: await service.addComment(c.var.user.id, c.req.param('id'), body.data) }, 201);
  });

  routes.delete('/comments/:id', async c => {
    await service.deleteComment(c.var.user.id, c.req.param('id'));
    return c.body(null, 204);
  });

  routes.post('/posts/:id/report', async c => {
    const body = await parseJson(c, report);
    if ('response' in body) return body.response;
    return c.json(await service.report(c.var.user.id, c.req.param('id'), body.data), 201);
  });

  routes.get('/users/:id', async c => c.json(await service.user(c.var.user.id, c.req.param('id'))));
  routes.put('/users/:id/follow', async c => c.json(await service.setFollow(c.var.user.id, c.req.param('id'), true)));
  routes.delete('/users/:id/follow', async c => c.json(await service.setFollow(c.var.user.id, c.req.param('id'), false)));

  return routes;
}

/**
 * Post images, without a session: the app's image component can't attach auth headers. Ids are
 * random UUIDs, and only images of visible posts by active users are served.
 */
export function communityImageRoutes(service: CommunityService) {
  const routes = new Hono().basePath('/api/v1/community-images');
  routes.get('/:id', async c => {
    const image = await service.image(c.req.param('id'));
    if (!image) return c.json({ error: 'Image not found.', code: 'NOT_FOUND' }, 404);
    return c.body(image.data as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': image.contentType,
      // Images never change (a new post means a new id), but hiding a post must take effect: keep it short-ish.
      'Cache-Control': 'public, max-age=3600',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    });
  });
  return routes;
}
