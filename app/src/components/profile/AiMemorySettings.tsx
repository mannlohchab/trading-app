import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { GlassIcon } from '@/components/ui/GlassIcon';
import { makeStyles } from '@/hooks/use-theme';
import { deleteAiMemory, deleteAllAiMemories, listAiMemories, type AiMemory } from '@/lib/aiApi';
import { DEMO_MODE } from '@/lib/demoMode';

/** Settings card: everything the AI assistant has saved about the user, each deletable. */
export function AiMemorySettings({ userId }: { userId: string }) {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const key = ['ai-memories', userId];
  const memories = useQuery({ queryKey: key, queryFn: ({ signal }) => listAiMemories(signal), enabled: !DEMO_MODE });
  const forget = useMutation({
    mutationFn: (id: string) => deleteAiMemory(id),
    onSuccess: (_, id) => queryClient.setQueryData<AiMemory[]>(key, list => list?.filter(m => m.id !== id)),
  });
  const forgetAll = useMutation({
    mutationFn: deleteAllAiMemories,
    onSuccess: () => queryClient.setQueryData<AiMemory[]>(key, []),
  });
  if (DEMO_MODE) return null;
  const items = memories.data ?? [];
  const busy = forget.isPending || forgetAll.isPending;
  const failed = forget.error ?? forgetAll.error;

  return <View style={styles.card}>
    <View style={styles.heading}><View style={styles.iconTile}><GlassIcon name="analytics" size={28} tone="purple" /></View>
      <View style={styles.flex}><Text accessibilityRole="header" style={styles.title}>What Insights remembers</Text>
        <Text style={styles.subtitle}>Facts you shared with the AI so it can tailor answers</Text></View></View>
    {memories.isPending ? <ActivityIndicator size="small" /> : null}
    {memories.isError ? <Text style={styles.helper}>Could not load what the AI remembers.</Text> : null}
    {memories.isSuccess && !items.length
      ? <Text style={styles.helper}>Nothing yet. Tell the assistant your goals, experience or risk limits and it will keep them in mind.</Text>
      : null}
    {items.map(memory => <View key={memory.id} style={styles.row}>
      <Text style={[styles.flex, styles.memory]}>{memory.content}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Forget: ${memory.content}`} disabled={busy}
        onPress={() => forget.mutate(memory.id)} hitSlop={8} style={({ pressed }) => [styles.forget, (pressed || busy) && styles.dim]}>
        <Text style={styles.forgetText}>Forget</Text>
      </Pressable>
    </View>)}
    {items.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel="Forget everything" disabled={busy}
      onPress={() => forgetAll.mutate()} style={({ pressed }) => [styles.forgetAll, (pressed || busy) && styles.dim]}>
      <Text style={styles.forgetText}>{forgetAll.isPending ? 'Forgetting…' : 'Forget everything'}</Text>
    </Pressable> : null}
    {failed ? <Text accessibilityRole="alert" style={styles.error}>{failed.message || 'Could not delete. Please try again.'}</Text> : null}
  </View>;
}

const useStyles = makeStyles((Palette) => ({
  card: { padding: 18, borderRadius: 22, backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  iconTile: { width: 46, height: 46, borderRadius: 15, backgroundColor: Palette.purpleMuted, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  title: { color: Palette.text, fontSize: 17, fontWeight: '600', letterSpacing: -0.3 },
  subtitle: { color: Palette.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 17 },
  helper: { color: Palette.textSecondary, fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Palette.border },
  memory: { color: Palette.text, fontSize: 13, lineHeight: 19 },
  forget: { paddingHorizontal: 10, paddingVertical: 6 },
  forgetAll: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6 },
  forgetText: { color: Palette.red, fontSize: 12, fontWeight: '600' },
  error: { color: Palette.red, fontSize: 12, lineHeight: 18, marginTop: 8 },
  dim: { opacity: 0.55 },
}));
