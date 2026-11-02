import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';

import { InsightPalette, Palette, Spacing } from '@/constants/theme';

type Props = {
  title: string;
  subtitle?: string;
  variant?: 'default' | 'insight';
};

export function EmptyState({ title, subtitle, variant = 'default' }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, variant === 'insight' && { color: InsightPalette.text }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, variant === 'insight' && { color: InsightPalette.textSecondary }]}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: Spacing.five,
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: { color: Palette.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  subtitle: { color: Palette.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
