import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Palette, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [comment, setComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | undefined>();
  const qc = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ['post', id],
    queryFn: () =>
      api<{
        post: {
          id: string;
          content: string;
          symbol?: string | null;
          likeCount: number;
          createdAt: string;
          author: { username: string; displayName: string | null };
        };
        comments: {
          id: string;
          content: string;
          parentId: string | null;
          createdAt: string;
          author: { username?: string; displayName?: string | null };
        }[];
      }>(`/api/community/posts/${id}`),
  });

  const commentMutation = useMutation({
    mutationFn: () =>
      api(`/api/community/posts/${id}/comments`, {
        method: 'POST',
        body: { content: comment, parentId: replyTo },
      }),
    onSuccess: () => {
      setComment('');
      setReplyTo(undefined);
      void qc.invalidateQueries({ queryKey: ['post', id] });
    },
  });

  const post = detailQuery.data?.post;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerStyle: { backgroundColor: Palette.bgElevated },
          headerTintColor: Palette.text,
        }}
      />
      <FlatList
        data={detailQuery.data?.comments ?? []}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          post ? (
            <View style={styles.post}>
              <Text style={styles.author}>{post.author.displayName ?? post.author.username}</Text>
              <Text style={styles.meta}>
                @{post.author.username} · {timeAgo(post.createdAt)}
              </Text>
              <Text style={styles.content}>{post.content}</Text>
              {post.symbol ? <Text style={styles.chip}>{post.symbol}</Text> : null}
              <Text style={styles.section}>Comments</Text>
            </View>
          ) : (
            <View />
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.comment, item.parentId ? styles.reply : null]}>
            <Text style={styles.author}>{item.author.displayName ?? item.author.username}</Text>
            <Text style={styles.content}>{item.content}</Text>
            <Pressable onPress={() => setReplyTo(item.id)}>
              <Text style={styles.replyBtn}>Reply</Text>
            </Pressable>
          </View>
        )}
      />
      <View style={styles.composer}>
        {replyTo ? (
          <Pressable onPress={() => setReplyTo(undefined)}>
            <Text style={styles.replying}>Replying · tap to cancel</Text>
          </Pressable>
        ) : null}
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={comment}
            onChangeText={setComment}
            placeholder="Write a comment…"
            placeholderTextColor={Palette.textMuted}
          />
          <Pressable style={styles.send} onPress={() => commentMutation.mutate()} disabled={!comment.trim()}>
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Palette.bg },
  post: { padding: Spacing.three, borderBottomWidth: 1, borderBottomColor: Palette.border },
  author: { color: Palette.text, fontWeight: '700' },
  meta: { color: Palette.textMuted, fontSize: 12, marginTop: 2, marginBottom: 10 },
  content: { color: Palette.text, fontSize: 15, lineHeight: 22 },
  chip: {
    marginTop: 10,
    alignSelf: 'flex-start',
    color: Palette.accent,
    fontWeight: '700',
    backgroundColor: Palette.card,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  section: {
    color: Palette.textSecondary,
    fontWeight: '700',
    marginTop: 20,
    textTransform: 'uppercase',
    fontSize: 12,
  },
  comment: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.borderSubtle,
  },
  reply: { marginLeft: 20, backgroundColor: Palette.bgElevated },
  replyBtn: { color: Palette.accent, marginTop: 6, fontWeight: '600', fontSize: 12 },
  composer: { borderTopWidth: 1, borderTopColor: Palette.border, padding: Spacing.three },
  replying: { color: Palette.textMuted, marginBottom: 6, fontSize: 12 },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: Palette.card,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Palette.text,
  },
  send: {
    backgroundColor: Palette.accent,
    borderRadius: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  sendText: { color: '#fff', fontWeight: '700' },
});
