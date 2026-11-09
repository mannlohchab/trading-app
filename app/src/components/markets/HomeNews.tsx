import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { GlassIcon, GlassPressable } from '@/components/ui/GlassIcon';
import { Palette } from '@/constants/theme';
import { fetchNews } from '@/lib/newsApi';
import { NewsRow, NewsRowSkeleton } from './NewsList';

const COUNT = 4;

/** "Latest news" on Home: the newest stories, refreshed every few minutes (the backend polls sources every 10). */
export function HomeNews() {
  const news = useQuery({
    queryKey: ['news', 'home'],
    queryFn: ({ signal }) => fetchNews({ limit: COUNT, signal }),
    refetchInterval: 3 * 60_000,
    staleTime: 60_000,
  });
  const articles = news.data?.articles ?? [];
  // News is secondary on Home: when there is none (yet), the section stays out of the way.
  if (news.isSuccess && articles.length === 0) return null;

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">Latest news</Text>
        <GlassPressable accessibilityRole="button" accessibilityLabel="See all news" style={styles.seeAllButton} onPress={() => router.push('/news')}>
          <Text style={styles.seeAll}>See all</Text>
          <GlassIcon name="add" size={18} />
        </GlassPressable>
      </View>
      {news.isError && !news.data ? (
        <ErrorBanner message="Could not load the news." onRetry={() => void news.refetch()} />
      ) : (
        <View style={styles.card}>
          {news.isPending
            ? Array.from({ length: 3 }, (_, i) => <NewsRowSkeleton key={i} last={i === 2} />)
            : articles.map((article, i) => <NewsRow key={article.id} article={article} last={i === articles.length - 1} />)}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 22, marginBottom: 12 },
  title: { color: Palette.text, fontSize: 20, fontWeight: '600', letterSpacing: -0.7 },
  seeAllButton: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: Palette.border, borderRadius: 7, paddingHorizontal: 10, minHeight: 30 },
  seeAll: { color: Palette.text, fontSize: 11, fontWeight: '400' },
  card: { backgroundColor: Palette.card, borderRadius: 18, borderWidth: 1, borderColor: Palette.border, paddingHorizontal: 16, paddingVertical: 2 },
});
