import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/AppText';
import { Palette } from '@/constants/theme';

/** Homepage entry into AI Insight, shown above the market hero. */
export function HomeAiPrompt() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ask AI Insight"
      accessibilityHint="Opens AI Insight"
      onPress={() => router.push('/(tabs)/ai')}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <Image source={require('@/assets/images/home-ai.png')} style={styles.art} contentFit="contain" accessible={false} />
      <View style={styles.copy}>
        <Text style={styles.title}>AI Insight</Text>
        <Text style={styles.hint}>Ask about markets</Text>
      </View>
      <View style={styles.ask}>
        <Text style={styles.askText}>Ask</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: Palette.card,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  art: { width: 52, height: 52 },
  copy: { flex: 1 },
  title: { color: Palette.text, fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },
  hint: { color: Palette.textSecondary, fontSize: 13, marginTop: 2 },
  ask: {
    minHeight: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: Palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.75 },
});
