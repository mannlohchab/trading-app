import { useInfiniteQuery } from '@tanstack/react-query';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { NewsRow, NewsRowSkeleton } from '@/components/markets/NewsList';
import { Palette } from '@/constants/theme';
import { fetchNews, type NewsArticle } from '@/lib/newsApi';

/** All crypto news, newest first, loading older stories as you scroll. */
export default function NewsScreen() {
  const feed = useInfiniteQuery({
    queryKey: ['news', 'all'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchNews({ limit: 20, cursor: pageParam, signal }),
    getNextPageParam: last => last.nextCursor,
  });
  // A story can only appear once even if pages shift while new ones arrive.
  const articles = [...new Map((feed.data?.pages ?? []).flatMap(p => p.articles).map(a => [a.id, a] as [string, NewsArticle])).values()];

  return (
    <View style={styles.safe}>
      {feed.error && !feed.isFetchNextPageError ? <ErrorBanner message="Could not load the news." onRetry={() => void feed.refetch()} /> : null}
      <FlatList
        data={articles}
        keyExtractor={a => a.id}
        contentContainerStyle={styles.list}
        refreshing={feed.isRefetching && !feed.isFetchingNextPage}
        onRefresh={() => void feed.refetch()}
        onEndReached={() => { if (feed.hasNextPage && !feed.isFetching && !feed.isFetchNextPageError) void feed.fetchNextPage(); }}
        onEndReachedThreshold={0.4}
        renderItem={({ item, index }) => <NewsRow article={item} last={index === articles.length - 1} />}
        ListEmptyComponent={feed.isPending
          ? <View>{Array.from({ length: 6 }, (_, i) => <NewsRowSkeleton key={i} />)}</View>
          : feed.isError ? undefined : <EmptyState title="No news yet" subtitle="Stories appear a few minutes after the server starts." />}
        ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator color={Palette.text} style={styles.footer} />
          : feed.isFetchNextPageError ? <ErrorBanner message="Could not load more stories." onRetry={() => void feed.fetchNextPage()} /> : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Palette.bg, width: '100%', maxWidth: 480, alignSelf: 'center' },
  list: { paddingHorizontal: 18, paddingBottom: 28 },
  footer: { marginVertical: 20 },
});
