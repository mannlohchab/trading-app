import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/AppText';
import { PostCard } from '@/components/community/PostCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { Skeleton } from '@/components/ui/Skeleton';
import { InsightPalette as P } from '@/constants/theme';
import { api } from '@/lib/api';
import type { CommunityPage } from '@/lib/community';
import { useAuth } from '@/store/auth';

const TABS = ['For You', "Editors' Picks", 'Following', 'Saved'] as const;
const TAB_MAP = { 'For You': 'foryou', "Editors' Picks": 'editors', Following: 'following', Saved: 'saved' } as const;

export default function CommunityScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('For You');
  const userId = useAuth(s => s.user?.id);
  const feed = useInfiniteQuery({
    queryKey: ['feed', userId, TAB_MAP[tab]],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api<CommunityPage>(`/api/community/feed?tab=${TAB_MAP[tab]}&offset=${pageParam}&limit=20`, { signal }),
    getNextPageParam: last => last.hasMore ? last.nextOffset : undefined,
  });
  const posts = [...new Map(feed.data?.pages.flatMap(page => page.posts).map(post => [post.id, post])).values()];
  return <SafeAreaView style={styles.safe} edges={['top']}>
    <View style={styles.header}>
      <Text style={styles.title}>Community</Text>
      <Pressable accessibilityRole="button" style={styles.compose} onPress={() => router.push('/community/compose')}><Text style={styles.composeText}>Post</Text></Pressable>
    </View>
    <View style={styles.tabs}><SegmentedTabs variant="insight" tabs={[...TABS]} value={tab} onChange={value => setTab(value as typeof tab)} /></View>
    {feed.error && !feed.isFetchNextPageError && <ErrorBanner message={feed.error.message || 'Unable to load the feed.'} onRetry={() => void feed.refetch()} />}
    <FlatList
      data={posts}
      keyExtractor={post => post.id}
      contentContainerStyle={styles.list}
      refreshing={feed.isRefetching && !feed.isFetchingNextPage}
      onRefresh={() => void feed.refetch()}
      onEndReached={() => { if (feed.hasNextPage && !feed.isFetching && !feed.isFetchNextPageError) void feed.fetchNextPage(); }}
      onEndReachedThreshold={0.3}
      ListEmptyComponent={feed.isPending
        ? <View style={styles.loading}>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} style={{ height: 160, borderRadius: 16, backgroundColor: P.soft }} />)}</View>
        : feed.isError ? undefined : <EmptyState variant="insight"
          title={tab === 'Saved' ? 'No saved posts' : tab === 'Following' ? 'No posts from people you follow' : 'No posts yet'}
          subtitle={tab === 'Saved' ? 'Tap Save on a post to find it here.' : tab === 'Following' ? 'Follow traders from For You to fill this feed.' : 'Be the first to share a market idea.'} />}
      ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator color={P.text} style={styles.footer} />
        : feed.isFetchNextPageError ? <ErrorBanner message="Could not load more posts." onRetry={() => void feed.fetchNextPage()} /> : undefined}
      renderItem={({ item }) => <PostCard post={item} onOpen={() => router.push(`/community/post/${item.id}`)} />}
    />
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: P.bg, width: '100%', maxWidth: 480, alignSelf: 'center' },
  header: { paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: P.text, fontSize: 26, lineHeight: 34, fontWeight: '400', letterSpacing: -0.3 },
  compose: { backgroundColor: P.text, paddingHorizontal: 16, minHeight: 40, justifyContent: 'center', borderRadius: 8 },
  composeText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  tabs: { paddingHorizontal: 16, marginBottom: 12 }, list: { paddingBottom: 32 },
  loading: { padding: 16, gap: 12 }, footer: { padding: 16 },
});
