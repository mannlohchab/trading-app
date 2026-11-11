import type { QueryClient } from '@tanstack/react-query';

export type CommunityPost = {
  id: string;
  content: string;
  imageUrl?: string | null;
  symbol?: string | null;
  exchange?: string | null;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  editedAt?: string | null;
  liked: boolean;
  bookmarked: boolean;
  following: boolean;
  isEditorsPick: boolean;
  /** Written by the signed-in user. */
  isOwn?: boolean;
  /** Hidden by moderation; only its author still sees it. */
  hidden?: boolean;
  author: CommunityAuthor;
};

/** `username` is null for traders who haven't picked one; `displayName` is always set. */
export type CommunityAuthor = { id: string; username: string | null; displayName: string; avatarUrl?: string | null };

/** Base path of the backend's community API. */
export const COMMUNITY_API = '/api/v1/community';

export type CommunityComment = {
  id: string;
  content: string;
  parentId: string | null;
  createdAt: string;
  isOwn?: boolean;
  author: CommunityAuthor;
};

export type CommunityPage = { posts: CommunityPost[]; nextCursor: string | null };
export type CommunityDetail = { post: CommunityPost; comments: CommunityComment[]; nextCommentCursor: string | null };

export async function refreshCommunity(client: QueryClient) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['feed'] }),
    client.invalidateQueries({ queryKey: ['post'] }),
    client.invalidateQueries({ queryKey: ['profile-overview'] }),
  ]);
}
