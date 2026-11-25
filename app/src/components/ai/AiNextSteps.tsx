import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { makeStyles } from '@/hooks/use-theme';
import type { AiAction } from '@/lib/aiActions';

/**
 * Buttons under an answer. "Open" buttons navigate; "ask" chips send a follow-up, so they only work
 * on the latest reply while nothing is streaming.
 */
export const AiNextSteps = memo(function AiNextSteps({ actions, onAsk, canAsk }: { actions: AiAction[]; onAsk: (prompt: string) => void; canAsk: boolean }) {
  const styles = useStyles();
  const visible = actions.filter(a => a.kind === 'open' || canAsk);
  if (!visible.length) return null;
  return <View style={styles.row} accessibilityLabel="Suggested next steps">
    {visible.map((action, index) => action.kind === 'open'
      ? <Pressable key={`open-${index}`} accessibilityRole="link" accessibilityLabel={action.label}
          onPress={() => router.push(action.href)} style={({ pressed }) => [styles.open, pressed && styles.pressed]}>
          <Text style={styles.openText}>{action.label} ›</Text>
        </Pressable>
      : <Pressable key={`ask-${index}`} accessibilityRole="button" accessibilityLabel={`Ask: ${action.prompt}`}
          onPress={() => onAsk(action.prompt)} style={({ pressed }) => [styles.ask, pressed && styles.pressed]}>
          <Text style={styles.askText}>{action.label}</Text>
        </Pressable>)}
  </View>;
});

const useStyles = makeStyles((_Palette, P) => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  open: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: P.accent },
  openText: { color: P.onSolid, fontSize: 13, fontWeight: '600' },
  ask: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: P.border, backgroundColor: P.card },
  askText: { color: P.body, fontSize: 13, fontWeight: '500' },
  pressed: { opacity: 0.7 },
}));
