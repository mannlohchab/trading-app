import { Elysia } from 'elysia';
import { z } from 'zod';
import { limitedRequestBody } from '../../../http/limited-body';
import { parseJson, validationError } from '../../../http/validation';
import type { UserGuard } from '../../identity';
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

export function communityRoutes(deps: { service: CommunityService; requireActiveUser: UserGuard }) {
  const { service } = deps;
  const routes = new Elysia({ prefix: '/api/v1/community' })
    .resolve(async ({ request }) => {
      const auth = await deps.requireActiveUser(request);
      // Limit the raw stream before JSON parsing, including chunked requests without Content-Length.
      const maxSize = request.method === 'POST' && new URL(request.url).pathname === '/api/v1/community/posts' ? POST_BODY : SMALL_BODY;
      const bodyRequest = request.method === 'GET' || request.method === 'DELETE'
        ? request
        : await limitedRequestBody(request, maxSize);
      return { ...auth, bodyRequest };
    });
  routes.onError(({ error, set }) => {
    if (error instanceof CommunityError) {
      if (error.code === 'VALIDATION_ERROR') { set.status = 400; return validationError(error.fields ?? { '(body)': error.message }); }
      set.status = STATUS[error.code];
      return { error: error.message, code: error.code };
    }
    return undefined;
  });

  const query = <S extends z.ZodType>(schema: S, c: { query: Record<string, string | undefined> }): { data: z.infer<S> } | { response: Response } => {
    const parsed = schema.safeParse(c.query);
    if (parsed.success) return { data: parsed.data };
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join('.') || '(query)'] ??= issue.message;
    return { response: validationError(fields) };
  };

  // Feeds: ?tab=foryou|editors|following|saved, narrowed by &author=<userId> or &symbol=BTCUSDT[&exchange=BINANCE].
  routes.get('/feed', async c => {
    const q = query(feedQuery, c);
    if ('response' in q) return q.response;
    const { author, ...rest } = q.data;
    return await service.feed(c.user.id, { ...rest, authorId: author });
  });

  routes.post('/posts', async c => {
    const body = await parseJson(c.bodyRequest, createPost);
    if ('response' in body) return body.response;
    const { image, imageUrl, ...rest } = body.data;
    const post = await service.createPost(c.user.id, { ...rest, image: image ?? imageUrl });
    return Response.json({ post }, { status: 201 });
  }, { parse: 'none' });

  routes.get('/posts/:id', async c => (await service.getPost(c.user.id, c.params.id)));

  routes.patch('/posts/:id', async c => {
    const body = await parseJson(c.bodyRequest, editPost);
    if ('response' in body) return body.response;
    return ({ post: await service.editPost(c.user.id, c.params.id, body.data.content) });
  }, { parse: 'none' });

  routes.delete('/posts/:id', async c => {
    await service.deletePost(c.user.id, c.params.id);
    return new Response(null, { status: 204 });
  });

  // Likes, saves and follows are idempotent: PUT sets, DELETE clears.
  routes.put('/posts/:id/like', async c => (await service.setLike(c.user.id, c.params.id, true)), { parse: 'none' });
  routes.delete('/posts/:id/like', async c => (await service.setLike(c.user.id, c.params.id, false)));
  routes.put('/posts/:id/bookmark', async c => (await service.setBookmark(c.user.id, c.params.id, true)), { parse: 'none' });
  routes.delete('/posts/:id/bookmark', async c => (await service.setBookmark(c.user.id, c.params.id, false)));

  routes.get('/posts/:id/comments', async c => {
    const q = query(commentsQuery, c);
    if ('response' in q) return q.response;
    return await service.comments(c.user.id, c.params.id, q.data);
  });

  routes.post('/posts/:id/comments', async c => {
    const body = await parseJson(c.bodyRequest, createComment);
    if ('response' in body) return body.response;
    return Response.json({ comment: await service.addComment(c.user.id, c.params.id, body.data) }, { status: 201 });
  }, { parse: 'none' });

  routes.delete('/comments/:id', async c => {
    await service.deleteComment(c.user.id, c.params.id);
    return new Response(null, { status: 204 });
  });

  routes.post('/posts/:id/report', async c => {
    const body = await parseJson(c.bodyRequest, report);
    if ('response' in body) return body.response;
    return Response.json(await service.report(c.user.id, c.params.id, body.data), { status: 201 });
  }, { parse: 'none' });

  routes.get('/users/:id', async c => (await service.user(c.user.id, c.params.id)));
  routes.put('/users/:id/follow', async c => (await service.setFollow(c.user.id, c.params.id, true)), { parse: 'none' });
  routes.delete('/users/:id/follow', async c => (await service.setFollow(c.user.id, c.params.id, false)));

  return routes;
}

/**
 * Post images, without a session: the app's image component can't attach auth headers. Ids are
 * random UUIDs, and only images of visible posts by active users are served.
 */
export function communityImageRoutes(service: CommunityService) {
  const routes = new Elysia({ prefix: '/api/v1/community-images' });
  routes.get('/:id', async c => {
    const image = await service.image(c.params.id);
    if (!image) return Response.json({ error: 'Image not found.', code: 'NOT_FOUND' }, { status: 404 });
    return new Response(image.data as Uint8Array<ArrayBuffer>, { headers: {
      'Content-Type': image.contentType,
      // Images never change (a new post means a new id), but hiding a post must take effect: keep it short-ish.
      'Cache-Control': 'public, max-age=3600',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    } });
  });
  return routes;
}
