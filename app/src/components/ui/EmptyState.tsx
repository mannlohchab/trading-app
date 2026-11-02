import { StyleSheet, Text, View } from 'react-native';

import { Palette, Spacing } from '@/constants/theme';

type Props = {
  title: string;
  subtitle?: string;
};

export function EmptyState({ title, subtitle }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
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
