import { Image } from 'expo-image';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { Skeleton } from '@/components/ui/Skeleton';
import { Palette } from '@/constants/theme';
import { timeAgo } from '@/lib/format';
import { isOpenable, type NewsArticle } from '@/lib/newsApi';

/** Opens the publisher's page in the in-app browser (a new tab on web). */
export function openArticle(article: NewsArticle) {
  if (!isOpenable(article)) return;
  void openBrowserAsync(article.url, { presentationStyle: WebBrowserPresentationStyle.AUTOMATIC }).catch(() => {});
}

const ago = (iso: string) => {
  const value = timeAgo(iso);
  return value === 'just now' ? value : `${value} ago`;
};

export const NewsRow = memo(function NewsRow({ article, last }: { article: NewsArticle; last?: boolean }) {
  const openable = isOpenable(article);
  return (
    <Pressable
      accessibilityRole={openable ? 'link' : 'text'}
      accessibilityLabel={`${article.breaking ? 'Breaking. ' : ''}${article.title}. ${article.publisher.name}, ${ago(article.publishedAt)}`}
      accessibilityHint={openable ? 'Opens the full story' : undefined}
      disabled={!openable}
      onPress={() => openArticle(article)}
      style={({ pressed }) => [styles.row, !last && styles.divider, pressed && styles.pressed]}>
      <View style={styles.copy}>
        <View style={styles.meta}>
          {article.breaking ? <Text style={styles.breaking}>Breaking</Text> : null}
          <Text style={styles.publisher} numberOfLines={1}>{article.publisher.name}</Text>
          <Text style={styles.time}>· {ago(article.publishedAt)}</Text>
        </View>
        <Text style={styles.title} numberOfLines={3}>{article.title}</Text>
        {article.assets.length ? (
          <View style={styles.tags}>
            {article.assets.slice(0, 3).map(asset => <Text key={asset} style={styles.tag}>{asset}</Text>)}
          </View>
        ) : null}
      </View>
      {article.imageUrl ? (
        <Image source={{ uri: article.imageUrl }} style={styles.thumb} contentFit="cover" transition={150} accessible={false} recyclingKey={article.id} />
      ) : null}
    </Pressable>
  );
});

export function NewsRowSkeleton({ last }: { last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <View style={[styles.copy, { gap: 8 }]}>
        <Skeleton style={{ width: 110, height: 10, borderRadius: 4 }} />
        <Skeleton style={{ width: '95%', height: 14, borderRadius: 4 }} />
        <Skeleton style={{ width: '70%', height: 14, borderRadius: 4 }} />
      </View>
      <Skeleton style={styles.thumb} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 14 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Palette.border },
  pressed: { opacity: 0.6 },
  copy: { flex: 1, minWidth: 0 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 },
  breaking: { color: '#fff', backgroundColor: Palette.red, fontSize: 9, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden' },
  publisher: { flexShrink: 1, color: Palette.textSecondary, fontSize: 11, fontWeight: '600' },
  time: { flexShrink: 0, color: Palette.textMuted, fontSize: 11 },
  title: { color: Palette.text, fontSize: 15, fontWeight: '600', lineHeight: 20, letterSpacing: -0.3 },
  tags: { flexDirection: 'row', gap: 5, marginTop: 7 },
  tag: { color: Palette.accent, backgroundColor: Palette.accentMuted, fontSize: 10, fontWeight: '600', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  thumb: { width: 76, height: 76, borderRadius: 12, backgroundColor: Palette.pill },
});
