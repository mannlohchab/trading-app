import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { InsightPalette as P } from '@/constants/theme';
import { api } from '@/lib/api';
import { COMMUNITY_API, refreshCommunity, type CommunityPost } from '@/lib/community';
import { timeAgo } from '@/lib/format';
import { useAuth } from '@/store/auth';

type Action = 'like' | 'bookmark' | 'follow' | 'report';
const REASONS = ['Spam', 'Harassment', 'Misleading content', 'Other inappropriate content'];

export function PostCard({ post, onOpen }: { post: CommunityPost; onOpen?: () => void }) {
  const viewerId = useAuth(s => s.user?.id);
  const client = useQueryClient();
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [notice, setNotice] = useState('');
  const [shareError, setShareError] = useState('');
  const mutation = useMutation({
    // Like, save and follow are set (PUT) or cleared (DELETE) explicitly, so a retried tap can't flip them back.
    mutationFn: (action: Action) => {
      if (action === 'report') return api(`${COMMUNITY_API}/posts/${post.id}/report`, { method: 'POST', body: { reason } });
      const on = action === 'like' ? !post.liked : action === 'bookmark' ? !post.bookmarked : !post.following;
      const path = action === 'follow' ? `${COMMUNITY_API}/users/${post.author.id}/follow` : `${COMMUNITY_API}/posts/${post.id}/${action}`;
      return api(path, { method: on ? 'PUT' : 'DELETE' });
    },
    onMutate: () => { setNotice(''); setShareError(''); },
    onSuccess: async (_, action) => {
      if (action === 'report') { setReporting(false); setNotice('Report submitted for review.'); }
      await refreshCommunity(client);
    },
  });
  const busy = mutation.isPending;
  const action = (kind: Action) => mutation.mutate(kind);
  const error = mutation.error?.message || shareError;
  async function share() {
    setShareError(''); setNotice('');
    const message = `${post.author.displayName}: ${post.content}`;
    try {
      if (Platform.OS === 'web' && !navigator.share && navigator.clipboard) {
        await navigator.clipboard.writeText(message);
        setNotice('Post copied to clipboard.');
      } else await Share.share({ message });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setShareError(err instanceof Error ? err.message : 'Unable to share this post.');
    }
  }
  const content = <>
    <Text style={styles.content}>{post.content}</Text>
    {post.imageUrl && <Image source={{ uri: post.imageUrl }} style={styles.image} contentFit="contain" accessibilityLabel="Post attachment" />}
  </>;
  return <View style={styles.card}>
    <View style={styles.header}>
      {post.author.avatarUrl
        ? <Image source={{ uri: post.author.avatarUrl }} style={styles.avatar} />
        : <View style={styles.avatar}><Text style={styles.initial}>{post.author.displayName.slice(0, 1).toUpperCase()}</Text></View>}
      <View style={styles.authorBlock}>
        <Text style={styles.author}>{post.author.displayName}</Text>
        <Text style={styles.meta}>{post.author.username ? `@${post.author.username} · ` : ''}{timeAgo(post.createdAt)}{post.editedAt ? ' · edited' : ''}{post.isEditorsPick ? ' · Editors’ Pick' : ''}</Text>
      </View>
      {post.author.id !== viewerId && <Pressable accessibilityRole="button" accessibilityLabel={post.following ? `Unfollow ${post.author.displayName}` : `Follow ${post.author.displayName}`} disabled={busy} onPress={() => action('follow')} style={styles.follow}>
        <Text style={styles.buttonText}>{busy && mutation.variables === 'follow' ? 'Updating…' : post.following ? 'Following' : 'Follow'}</Text>
      </Pressable>}
    </View>
    {onOpen ? <Pressable accessibilityRole="button" accessibilityLabel={`Open post by ${post.author.displayName}`} onPress={onOpen}>{content}</Pressable> : content}
    {post.symbol && <Pressable style={styles.chip} accessibilityRole="button" accessibilityLabel={`View ${post.symbol}`} onPress={() => router.push({ pathname: '/instrument/[symbol]', params: { symbol: post.symbol!, ...(post.exchange ? { exchange: post.exchange } : {}) } })}>
      <Text style={styles.buttonText}>{post.symbol}</Text>
    </Pressable>}
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel={post.liked ? 'Unlike post' : 'Like post'} accessibilityState={{ selected: post.liked, disabled: busy }} disabled={busy} onPress={() => action('like')} style={styles.action}>
        <Text style={[styles.actionText, post.liked && styles.liked]}>{post.liked ? '♥' : '♡'} {post.likeCount}</Text>
      </Pressable>
      {onOpen ? <Pressable accessibilityRole="button" accessibilityLabel="Read comments" onPress={onOpen} style={styles.action}>
        <Text style={styles.actionText}>{post.commentCount} comments</Text>
      </Pressable> : <View style={styles.action}><Text style={styles.actionText}>{post.commentCount} comments</Text></View>}
      <Pressable accessibilityRole="button" accessibilityLabel={post.bookmarked ? 'Unsave post' : 'Save post'} accessibilityState={{ selected: post.bookmarked, disabled: busy }} disabled={busy} onPress={() => action('bookmark')} style={styles.action}>
        <Text style={[styles.actionText, post.bookmarked && styles.selected]}>{post.bookmarked ? '★ Saved' : '☆ Save'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={share} style={styles.action}><Text style={styles.actionText}>Share</Text></Pressable>
      {post.author.id !== viewerId && <Pressable accessibilityRole="button" disabled={busy} onPress={() => { mutation.reset(); setReporting(!reporting); setNotice(''); }} style={styles.action}><Text style={styles.actionText}>Report</Text></Pressable>}
    </View>
    {reporting && <View style={styles.report}>
      <Text style={styles.author}>Why are you reporting this post?</Text>
      {REASONS.map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: reason === value }} disabled={busy} onPress={() => setReason(value)} style={styles.action}>
        <Text style={styles.actionText}>{reason === value ? '●' : '○'} {value}</Text>
      </Pressable>)}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => action('report')} style={styles.follow}><Text style={styles.buttonText}>{busy ? 'Submitting…' : 'Submit report'}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => setReporting(false)} style={styles.action}><Text style={styles.actionText}>Cancel</Text></Pressable>
      </View>
    </View>}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{notice}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 16, padding: 16, backgroundColor: P.card, borderRadius: 16, borderWidth: 1, borderColor: P.border, boxShadow: '0 1px 2px rgba(31,31,30,0.04)' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  avatar: { width: 36, height: 36, borderRadius: 10, backgroundColor: P.soft, alignItems: 'center', justifyContent: 'center' },
  initial: { color: P.text, fontWeight: '600' },
  authorBlock: { flex: 1 }, author: { color: P.text, fontSize: 14, fontWeight: '600' },
  meta: { color: P.textMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  follow: { minHeight: 40, paddingHorizontal: 10, justifyContent: 'center', backgroundColor: P.soft, borderRadius: 8 },
  buttonText: { color: P.text, fontSize: 12, fontWeight: '600' },
  content: { color: P.body, fontSize: 15, lineHeight: 22 },
  image: { width: '100%', height: 220, marginTop: 12, borderRadius: 12, backgroundColor: P.bg },
  chip: { alignSelf: 'flex-start', backgroundColor: P.soft, borderRadius: 8, paddingHorizontal: 10, minHeight: 36, justifyContent: 'center', marginTop: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, borderTopWidth: 1, borderTopColor: P.border, paddingTop: 6, marginTop: 12 },
  action: { minHeight: 40, justifyContent: 'center' },
  actionText: { color: P.textSecondary, fontSize: 13 }, selected: { color: P.text, fontWeight: '600' }, liked: { color: P.red },
  report: { padding: 12, backgroundColor: P.bg, borderRadius: 12, marginTop: 8 },
  error: { color: P.red, fontSize: 13, lineHeight: 18, marginTop: 8 },
});
