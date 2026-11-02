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
  liked: boolean;
  bookmarked: boolean;
  following: boolean;
  isEditorsPick: boolean;
  author: { id: string; username: string; displayName: string | null; avatarUrl?: string | null };
};

export type CommunityComment = {
  id: string;
  content: string;
  parentId: string | null;
  createdAt: string;
  author: CommunityPost['author'];
};

export type CommunityPage = { posts: CommunityPost[]; nextOffset: number; hasMore: boolean };
export type CommunityDetail = { post: CommunityPost; comments: CommunityComment[] };

export async function refreshCommunity(client: QueryClient) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['feed'] }),
    client.invalidateQueries({ queryKey: ['post'] }),
    client.invalidateQueries({ queryKey: ['profile-overview'] }),
  ]);
}
