// Community use cases: posting market findings, feeds, likes, saves, follows, comments and reports.
// Every rule comes from ../domain/rules; storage sits behind the repository port.
import {
  AUTO_HIDE_REPORTS, checkBody, type ImageType, COMMENT_PAGE, decodeCursor, decodeImageDataUrl, displayName, encodeCursor, isUuid, LIMITS,
  normalizeTicker, PAGE, parseReportReason, RATE_LIMITS, safeImageUrl,
} from '../domain/rules';
import { CommunityError, invalid, notFound } from './errors';
import type { Author, Clock, CommentRecord, CommunityRepository, FeedQuery, InstrumentResolver, PostRecord } from './ports';

export type AuthorView = { id: string; username: string | null; displayName: string; avatarUrl: string | null };

export type PostView = {
  id: string;
  content: string;
  imageUrl: string | null;
  symbol: string | null;
  exchange: string | null;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  editedAt: string | null;
  liked: boolean;
  bookmarked: boolean;
  following: boolean;
  isEditorsPick: boolean;
  isOwn: boolean;
  /** Hidden by moderation; only the author still sees it. */
  hidden: boolean;
  author: AuthorView;
};

export type CommentView = { id: string; postId: string; content: string; parentId: string | null; createdAt: string; isOwn: boolean; author: AuthorView };

export type FeedTab = FeedQuery['tab'];
export const FEED_TABS: readonly FeedTab[] = ['foryou', 'editors', 'following', 'saved'];

const HOUR_MS = 3_600_000;

export class CommunityService {
  constructor(private readonly deps: {
    repository: CommunityRepository;
    instruments: InstrumentResolver;
    clock: Clock;
    /** Public origin of this API, used to build image links (e.g. https://api.example.com). */
    publicBaseUrl: string;
  }) {}

  private get repo() { return this.deps.repository; }

  // --- Views ---------------------------------------------------------------------------------

  private author(a: Author): AuthorView {
    return { id: a.id, username: a.username, displayName: displayName(a), avatarUrl: safeImageUrl(a.avatar) };
  }

  imageUrl(imageId: string) {
    return `${this.deps.publicBaseUrl.replace(/\/+$/, '')}/api/v1/community-images/${imageId}`;
  }

  private post(viewerId: string, p: PostRecord): PostView {
    return {
      id: p.id, content: p.body, imageUrl: p.imageId ? this.imageUrl(p.imageId) : null, symbol: p.symbol, exchange: p.exchange,
      likeCount: p.likeCount, commentCount: p.commentCount, createdAt: p.createdAt.toISOString(), editedAt: p.editedAt?.toISOString() ?? null,
      liked: p.liked, bookmarked: p.bookmarked, following: p.followingAuthor, isEditorsPick: p.isEditorsPick,
      isOwn: p.author.id === viewerId, hidden: p.hidden, author: this.author(p.author),
    };
  }

  private comment(viewerId: string, c: CommentRecord): CommentView {
    return { id: c.id, postId: c.postId, content: c.body, parentId: c.parentId, createdAt: c.createdAt.toISOString(), isOwn: c.author.id === viewerId, author: this.author(c.author) };
  }

  private cursor(raw: string | undefined) {
    if (!raw) return undefined;
    const decoded = decodeCursor(raw);
    if (!decoded) throw invalid('cursor', 'Invalid cursor.');
    return decoded;
  }

  private async visiblePost(viewerId: string, postId: string) {
    const post = isUuid(postId) ? await this.repo.findPost(viewerId, postId) : null;
    if (!post) throw notFound('Post');
    return post;
  }

  // --- Feeds ---------------------------------------------------------------------------------

  /**
   * Newest first. `tab` picks the feed; `authorId` narrows it to one trader, `symbol` (+ optional
   * `exchange`) to posts about one instrument.
   */
  async feed(viewerId: string, input: { tab?: FeedTab; cursor?: string; limit?: number; authorId?: string; symbol?: string; exchange?: string }) {
    const limit = Math.min(Math.max(1, input.limit ?? PAGE.default), PAGE.max);
    if (input.authorId !== undefined && !isUuid(input.authorId)) throw invalid('author', 'Invalid user id.');
    let instrument: FeedQuery['instrument'];
    if (input.symbol) {
      const symbol = normalizeTicker(input.symbol);
      if (!symbol) throw invalid('symbol', 'Invalid symbol.');
      // Unknown instruments simply have no posts; only resolve to learn the exchange.
      instrument = (await this.deps.instruments.resolve(symbol, input.exchange)) ?? { exchange: input.exchange?.trim().toUpperCase() || '-', symbol };
    }
    const rows = await this.repo.feed({
      viewerId, tab: input.tab ?? 'foryou', authorId: input.authorId, instrument, before: this.cursor(input.cursor), limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      posts: page.map(p => this.post(viewerId, p)),
      nextCursor: rows.length > limit && last ? encodeCursor({ atMicros: last.sortMicros, id: last.id }) : null,
    };
  }

  // --- Posts ---------------------------------------------------------------------------------

  async createPost(viewerId: string, input: { content: string; symbol?: string | null; exchange?: string | null; image?: string | null }) {
    const body = checkBody(input.content, LIMITS.postBody, 'Post');
    if (!body.ok) throw invalid('content', body.message);

    let instrument: { exchange: string; symbol: string } | null = null;
    if (input.symbol?.trim()) {
      const symbol = normalizeTicker(input.symbol);
      instrument = symbol ? await this.deps.instruments.resolve(symbol, input.exchange?.trim() || undefined) : null;
      if (!instrument) throw invalid('symbol', `Unknown or inactive symbol "${input.symbol.trim()}".`);
    }

    let image: { contentType: ImageType; bytes: Uint8Array } | null = null;
    if (input.image) {
      const decoded = decodeImageDataUrl(input.image);
      if (!decoded.ok) throw invalid('image', decoded.message);
      image = { contentType: decoded.contentType, bytes: decoded.bytes };
    }

    const since = new Date(this.deps.clock.now().getTime() - HOUR_MS);
    if ((await this.repo.countPostsSince(viewerId, since)) >= RATE_LIMITS.postsPerHour) {
      throw new CommunityError('RATE_LIMITED', `You can publish up to ${RATE_LIMITS.postsPerHour} posts an hour. Try again later.`);
    }

    const id = await this.repo.createPost({ authorId: viewerId, body: body.text, exchange: instrument?.exchange ?? null, symbol: instrument?.symbol ?? null, image });
    return this.post(viewerId, (await this.repo.findPost(viewerId, id))!);
  }

  /** The post with its first page of comments (oldest first). */
  async getPost(viewerId: string, postId: string) {
    const post = await this.visiblePost(viewerId, postId);
    const comments = await this.listComments(viewerId, post.id, {});
    return { post: this.post(viewerId, post), ...comments };
  }

  async comments(viewerId: string, postId: string, input: { cursor?: string; limit?: number }) {
    const post = await this.visiblePost(viewerId, postId);
    return this.listComments(viewerId, post.id, input);
  }

  private async listComments(viewerId: string, postId: string, input: { cursor?: string; limit?: number }) {
    const limit = Math.min(Math.max(1, input.limit ?? COMMENT_PAGE.default), COMMENT_PAGE.max);
    const rows = await this.repo.comments(postId, this.cursor(input.cursor), limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      comments: page.map(c => this.comment(viewerId, c)),
      nextCommentCursor: rows.length > limit && last ? encodeCursor({ atMicros: last.sortMicros, id: last.id }) : null,
    };
  }

  async editPost(viewerId: string, postId: string, content: string) {
    const body = checkBody(content, LIMITS.postBody, 'Post');
    if (!body.ok) throw invalid('content', body.message);
    const post = await this.visiblePost(viewerId, postId);
    if (post.author.id !== viewerId) throw new CommunityError('FORBIDDEN', 'You can only edit your own posts.');
    await this.repo.editPost(viewerId, post.id, body.text, this.deps.clock.now());
    return this.post(viewerId, (await this.repo.findPost(viewerId, post.id))!);
  }

  async deletePost(viewerId: string, postId: string) {
    const post = await this.visiblePost(viewerId, postId);
    if (post.author.id !== viewerId) throw new CommunityError('FORBIDDEN', 'You can only delete your own posts.');
    await this.repo.deletePost(viewerId, post.id);
  }

  // --- Interactions --------------------------------------------------------------------------

  async setLike(viewerId: string, postId: string, liked: boolean) {
    const post = await this.visiblePost(viewerId, postId);
    const likeCount = await this.repo.setLike(viewerId, post.id, liked);
    return { liked, likeCount };
  }

  async setBookmark(viewerId: string, postId: string, bookmarked: boolean) {
    const post = await this.visiblePost(viewerId, postId);
    await this.repo.setBookmark(viewerId, post.id, bookmarked);
    return { bookmarked };
  }

  async setFollow(viewerId: string, userId: string, following: boolean) {
    if (!isUuid(userId)) throw notFound('User');
    if (userId === viewerId) throw invalid('userId', "You can't follow yourself.");
    // Unfollowing always works, so a follow of a since-deleted account can be removed.
    if (following && !(await this.repo.isActiveUser(userId))) throw notFound('User');
    await this.repo.setFollow(viewerId, userId, following);
    return { following };
  }

  async addComment(viewerId: string, postId: string, input: { content: string; parentId?: string | null }) {
    const body = checkBody(input.content, LIMITS.commentBody, 'Comment');
    if (!body.ok) throw invalid('content', body.message);
    const post = await this.visiblePost(viewerId, postId);
    let parentId: string | null = null;
    if (input.parentId) {
      const parent = isUuid(input.parentId) ? await this.repo.findComment(input.parentId) : null;
      if (!parent || parent.postId !== post.id) throw invalid('parentId', 'You can only reply to a comment on this post.');
      parentId = parent.id;
    }
    const since = new Date(this.deps.clock.now().getTime() - HOUR_MS);
    if ((await this.repo.countCommentsSince(viewerId, since)) >= RATE_LIMITS.commentsPerHour) {
      throw new CommunityError('RATE_LIMITED', `You can post up to ${RATE_LIMITS.commentsPerHour} comments an hour. Try again later.`);
    }
    return this.comment(viewerId, await this.repo.addComment({ postId: post.id, authorId: viewerId, parentId, body: body.text }));
  }

  /** The comment's author or the post's author may delete it; replies go with it. */
  async deleteComment(viewerId: string, commentId: string) {
    const comment = isUuid(commentId) ? await this.repo.findComment(commentId) : null;
    if (!comment) throw notFound('Comment');
    if (comment.authorId !== viewerId && comment.postAuthorId !== viewerId) throw new CommunityError('FORBIDDEN', 'You can only delete your own comments or comments on your posts.');
    await this.repo.deleteComment(comment.id);
  }

  async report(viewerId: string, postId: string, input: { reason: string; details?: string | null }) {
    const post = await this.visiblePost(viewerId, postId);
    if (post.author.id === viewerId) throw invalid('postId', "You can't report your own post.");
    const parsed = parseReportReason(input.reason);
    const details = input.details?.trim().slice(0, LIMITS.reportDetails) || parsed.details;
    await this.repo.report({ postId: post.id, reporterId: viewerId, reason: parsed.reason, details, hideAt: AUTO_HIDE_REPORTS, now: this.deps.clock.now() });
    return { ok: true as const, message: 'Report submitted for moderation review.' };
  }

  // --- People --------------------------------------------------------------------------------

  async user(viewerId: string, userId: string) {
    const summary = isUuid(userId) ? await this.repo.userSummary(viewerId, userId) : null;
    if (!summary) throw notFound('User');
    return {
      user: { ...this.author(summary.author), isOwn: summary.author.id === viewerId },
      postCount: summary.postCount, followerCount: summary.followerCount, followingCount: summary.followingCount, following: summary.following,
    };
  }

  async image(imageId: string) {
    return isUuid(imageId) ? this.repo.image(imageId) : null;
  }
}
