import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';

import { Palette } from '@/constants/theme';

export function DemoBadge({ visible }: { visible?: boolean }) {
  if (!visible) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>Demo data</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: Palette.accentMuted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  text: { color: Palette.accent, fontSize: 11, fontWeight: '700' },
});
