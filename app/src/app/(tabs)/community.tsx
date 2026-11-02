import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { Skeleton } from '@/components/ui/Skeleton';
import { Palette, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';

type Post = {
  id: string;
  content: string;
  symbol?: string | null;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  liked: boolean;
  bookmarked: boolean;
  isEditorsPick: boolean;
  author: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
};

const TABS = ['For You', "Editors' Picks", 'Following'] as const;
const TAB_MAP = { 'For You': 'foryou', "Editors' Picks": 'editors', Following: 'following' } as const;

export default function CommunityScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('For You');
  const qc = useQueryClient();
  const feedTab = TAB_MAP[tab];

  const feedQuery = useQuery({
    queryKey: ['feed', feedTab],
    queryFn: () => api<{ posts: Post[] }>(`/api/community/feed?tab=${feedTab}`),
  });

  const likeMutation = useMutation({
    mutationFn: (id: string) => api(`/api/community/posts/${id}/like`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['feed'] }),
  });
  const bookmarkMutation = useMutation({
    mutationFn: (id: string) => api(`/api/community/posts/${id}/bookmark`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['feed'] }),
  });
  const reportMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/api/community/posts/${id}/report`, { method: 'POST', body: { reason: 'Inappropriate content' } }),
  });
  const followMutation = useMutation({
    mutationFn: (userId: string) => api(`/api/community/users/${userId}/follow`, { method: 'POST' }),
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Community</Text>
        <Pressable style={styles.compose} onPress={() => router.push('/community/compose')}>
          <Text style={styles.composeText}>Post</Text>
        </Pressable>
      </View>
      <View style={styles.tabs}>
        <SegmentedTabs tabs={[...TABS]} value={tab} onChange={(t) => setTab(t as (typeof TABS)[number])} />
      </View>
      <FlatList
        data={feedQuery.data?.posts ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshing={feedQuery.isFetching}
        onRefresh={() => void feedQuery.refetch()}
        ListEmptyComponent={
          feedQuery.isLoading ? (
            <View style={{ padding: 16, gap: 12 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} style={{ height: 120, borderRadius: 12 }} />
              ))}
            </View>
          ) : (
            <EmptyState
              title={tab === 'Following' ? 'No posts from people you follow' : 'No posts yet'}
              subtitle={tab === 'Following' ? 'Follow traders to fill this feed.' : 'Be the first to share a market idea.'}
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/community/post/${item.id}`)}>
            <View style={styles.cardHeader}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(item.author.displayName ?? item.author.username)[0]?.toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.author}>{item.author.displayName ?? item.author.username}</Text>
                <Text style={styles.meta}>
                  @{item.author.username} · {timeAgo(item.createdAt)}
                  {item.isEditorsPick ? ' · Editors’ Pick' : ''}
                </Text>
              </View>
              <Pressable onPress={() => followMutation.mutate(item.author.id)}>
                <Text style={styles.follow}>Follow</Text>
              </Pressable>
            </View>
            <Text style={styles.content}>{item.content}</Text>
            {item.symbol ? (
              <View style={styles.chip}>
                <Text style={styles.chipText}>{item.symbol}</Text>
              </View>
            ) : null}
            <View style={styles.actions}>
              <Pressable onPress={() => likeMutation.mutate(item.id)}>
                <Text style={[styles.action, item.liked && { color: Palette.red }]}>
                  {item.liked ? '♥' : '♡'} {item.likeCount}
                </Text>
              </Pressable>
              <Text style={styles.action}>💬 {item.commentCount}</Text>
              <Pressable onPress={() => bookmarkMutation.mutate(item.id)}>
                <Text style={[styles.action, item.bookmarked && { color: Palette.yellow }]}>
                  {item.bookmarked ? '★' : '☆'}
                </Text>
              </Pressable>
              <Pressable onPress={() => Share.share({ message: item.content })}>
                <Text style={styles.action}>Share</Text>
              </Pressable>
              <Pressable onPress={() => reportMutation.mutate(item.id)}>
                <Text style={styles.action}>Report</Text>
              </Pressable>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Palette.bg, width: '100%', maxWidth: 480, alignSelf: 'center' },
  header: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { color: Palette.text, fontSize: 24, fontWeight: '800' },
  compose: {
    backgroundColor: Palette.accent,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  composeText: { color: '#fff', fontWeight: '700' },
  tabs: { paddingHorizontal: Spacing.three, marginBottom: Spacing.two },
  card: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
    padding: Spacing.three,
    backgroundColor: Palette.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Palette.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Palette.accent, fontWeight: '800' },
  author: { color: Palette.text, fontWeight: '700' },
  meta: { color: Palette.textMuted, fontSize: 12, marginTop: 2 },
  follow: { color: Palette.accent, fontWeight: '700', fontSize: 12 },
  content: { color: Palette.text, fontSize: 15, lineHeight: 22 },
  chip: {
    alignSelf: 'flex-start',
    marginTop: 10,
    backgroundColor: Palette.bgElevated,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  chipText: { color: Palette.accent, fontWeight: '700', fontSize: 12 },
  actions: { flexDirection: 'row', gap: 16, marginTop: 14 },
  action: { color: Palette.textSecondary, fontSize: 13, fontWeight: '600' },
});
