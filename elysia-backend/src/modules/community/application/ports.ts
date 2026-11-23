// Ports for the community module: storage behind `CommunityRepository`, instrument lookup behind
// `InstrumentResolver` (implemented with the market module).
import type { ImageType, ReportReason } from '../domain/rules';

export type Author = {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  avatar: string | null;
};

/** A post as stored, plus what the viewing user did with it. */
export type PostRecord = {
  id: string;
  body: string;
  exchange: string | null;
  symbol: string | null;
  likeCount: number;
  commentCount: number;
  isEditorsPick: boolean;
  hidden: boolean;
  createdAt: Date;
  editedAt: Date | null;
  imageId: string | null;
  author: Author;
  liked: boolean;
  bookmarked: boolean;
  followingAuthor: boolean;
  /** Sort key of this row in its feed, for the next cursor (µs since epoch). */
  sortMicros: string;
};

export type CommentRecord = {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  createdAt: Date;
  author: Author;
  sortMicros: string;
};

export type FeedQuery = {
  viewerId: string;
  tab: 'foryou' | 'editors' | 'following' | 'saved';
  authorId?: string;
  instrument?: { exchange: string; symbol: string };
  before?: { atMicros: string; id: string };
  limit: number;
};

export type UserSummary = {
  author: Author;
  postCount: number;
  followerCount: number;
  followingCount: number;
  following: boolean;
};

export interface CommunityRepository {
  /** Inserts a post (and its image) in one transaction. Returns the new post's id. */
  createPost(input: { authorId: string; body: string; exchange: string | null; symbol: string | null; image: { contentType: ImageType; bytes: Uint8Array } | null }): Promise<string>;
  /** Visible posts only (active author; not hidden unless the viewer wrote it). */
  findPost(viewerId: string, postId: string): Promise<PostRecord | null>;
  feed(query: FeedQuery): Promise<PostRecord[]>;
  /** Updates the body of the author's own post. False when it is not theirs or does not exist. */
  editPost(authorId: string, postId: string, body: string, at: Date): Promise<boolean>;
  deletePost(authorId: string, postId: string): Promise<boolean>;

  /** Idempotent. Returns the post's like count afterwards. */
  setLike(userId: string, postId: string, liked: boolean): Promise<number>;
  setBookmark(userId: string, postId: string, saved: boolean): Promise<void>;
  setFollow(followerId: string, followeeId: string, following: boolean): Promise<void>;

  addComment(input: { postId: string; authorId: string; parentId: string | null; body: string }): Promise<CommentRecord>;
  /** Comments oldest first, from active authors. */
  comments(postId: string, after: { atMicros: string; id: string } | undefined, limit: number): Promise<CommentRecord[]>;
  findComment(commentId: string): Promise<{ id: string; postId: string; authorId: string; postAuthorId: string } | null>;
  /** Deletes the comment and its replies. */
  deleteComment(commentId: string): Promise<void>;

  /** Stores the report (repeat reports update the reason) and hides the post at `hideAt` reporters. */
  report(input: { postId: string; reporterId: string; reason: ReportReason; details: string | null; hideAt: number; now: Date }): Promise<{ hidden: boolean }>;

  /** Whether `userId` is an ACTIVE account. */
  isActiveUser(userId: string): Promise<boolean>;
  userSummary(viewerId: string, userId: string): Promise<UserSummary | null>;
  countPostsSince(authorId: string, since: Date): Promise<number>;
  countCommentsSince(authorId: string, since: Date): Promise<number>;

  /** The image of a visible post, for the public image endpoint. */
  image(imageId: string): Promise<{ contentType: string; data: Uint8Array } | null>;
}

export interface InstrumentResolver {
  /** The active instrument a user's symbol refers to, searching every exchange when none is given. */
  resolve(symbol: string, exchange?: string): Promise<{ exchange: string; symbol: string } | null>;
}

export interface Clock {
  now(): Date;
}
