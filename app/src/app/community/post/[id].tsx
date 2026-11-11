import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, TextInput } from '@/components/ui/AppText';
import { PostCard } from '@/components/community/PostCard';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { InsightPalette as P } from '@/constants/theme';
import { api } from '@/lib/api';
import { COMMUNITY_API, refreshCommunity, type CommunityDetail, type CommunityComment } from '@/lib/community';
import { timeAgo } from '@/lib/format';
import { useAuth } from '@/store/auth';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useAuth(s => s.user?.id);
  const [comment, setComment] = useState('');
  const [replyTo, setReplyTo] = useState<CommunityComment>();
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ['post', userId, id],
    queryFn: ({ signal }) => api<CommunityDetail>(`${COMMUNITY_API}/posts/${id}`, { signal }),
  });
  const mutation = useMutation({
    mutationFn: () => api(`${COMMUNITY_API}/posts/${id}/comments`, {
      method: 'POST', body: { content: comment.trim(), parentId: replyTo?.id },
    }),
    onSuccess: async () => {
      setComment(''); setReplyTo(undefined);
      await refreshCommunity(client);
    },
  });
  const comments = detail.data?.comments ?? [];
  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <Stack.Screen options={{ headerStyle: { backgroundColor: P.bg }, headerTintColor: P.text }} />
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      {detail.error && <ErrorBanner message={detail.error.message || 'Unable to load this post.'} onRetry={() => void detail.refetch()} />}
      {detail.isPending ? <ActivityIndicator style={styles.loading} color={P.text} /> : <FlatList
        data={comments}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        refreshing={detail.isRefetching}
        onRefresh={() => void detail.refetch()}
        contentContainerStyle={styles.list}
        ListHeaderComponent={detail.data ? <>
          <PostCard post={detail.data.post} />
          <Text style={styles.section}>Comments ({detail.data.post.commentCount})</Text>
        </> : undefined}
        ListEmptyComponent={detail.data ? <Text style={styles.empty}>No comments yet. Start the conversation.</Text> : undefined}
        renderItem={({ item }) => {
          const parent = item.parentId ? comments.find(c => c.id === item.parentId) : undefined;
          return <View style={[styles.comment, item.parentId && styles.reply]}>
            {parent && <Text style={styles.meta}>Replying to {parent.author.displayName}: {parent.content.slice(0, 80)}{parent.content.length > 80 ? '…' : ''}</Text>}
            <Text style={styles.author}>{item.author.displayName}</Text>
            <Text style={styles.meta}>{timeAgo(item.createdAt)}</Text>
            <Text style={styles.content}>{item.content}</Text>
            <Pressable accessibilityRole="button" disabled={mutation.isPending} onPress={() => setReplyTo(item)} style={styles.replyButton}><Text style={styles.replyText}>Reply</Text></Pressable>
          </View>;
        }}
      />}
      {detail.data && <View style={styles.composer}>
        {mutation.error && <ErrorBanner message={mutation.error.message || 'Could not send your comment.'} />}
        {replyTo && <View style={styles.replyBanner}>
          <Text style={styles.meta}>Replying to {replyTo.author.displayName}</Text>
          <Pressable accessibilityRole="button" disabled={mutation.isPending} onPress={() => setReplyTo(undefined)} style={styles.replyButton}><Text style={styles.replyText}>Cancel reply</Text></Pressable>
        </View>}
        <View style={styles.row}>
          <TextInput style={styles.input} value={comment} onChangeText={setComment} placeholder="Write a comment…" accessibilityLabel="Comment" placeholderTextColor={P.textMuted} editable={!mutation.isPending} multiline maxLength={2000} />
          <Pressable accessibilityRole="button" style={[styles.send, (!comment.trim() || mutation.isPending) && styles.disabled]} onPress={() => mutation.mutate()} disabled={!comment.trim() || mutation.isPending}>
            <Text style={styles.sendText}>{mutation.isPending ? 'Sending…' : 'Send'}</Text>
          </Pressable>
        </View>
        <Text style={styles.counter}>{comment.length}/2000</Text>
      </View>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  flex: { flex: 1 }, safe: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: P.bg },
  loading: { padding: 40 }, list: { paddingTop: 12, paddingBottom: 24 },
  section: { color: P.text, fontSize: 16, fontWeight: '600', paddingHorizontal: 16, paddingBottom: 12 },
  empty: { color: P.textSecondary, fontSize: 14, padding: 16 },
  comment: { paddingHorizontal: 16, paddingTop: 12, borderBottomWidth: 1, borderBottomColor: P.border },
  reply: { marginLeft: 20, backgroundColor: P.card }, author: { color: P.text, fontWeight: '600', fontSize: 14 },
  meta: { color: P.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 4 },
  content: { color: P.body, fontSize: 15, lineHeight: 22 },
  replyButton: { minHeight: 40, justifyContent: 'center' }, replyText: { color: P.text, fontSize: 12, fontWeight: '600' },
  composer: { borderTopWidth: 1, borderTopColor: P.border, padding: 12, backgroundColor: P.bg },
  replyBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  input: { flex: 1, minHeight: 44, maxHeight: 120, backgroundColor: P.card, borderWidth: 1, borderColor: P.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: P.text },
  send: { backgroundColor: P.text, minHeight: 44, borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' },
  sendText: { color: P.onSolid, fontWeight: '600', fontSize: 13 }, disabled: { opacity: 0.4 },
  counter: { textAlign: 'right', fontSize: 11, color: P.textMuted, marginTop: 4 },
});
