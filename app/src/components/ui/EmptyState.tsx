import { View } from 'react-native';
import { Text } from '@/components/ui/AppText';

import { Spacing } from '@/constants/theme';
import { makeStyles, useInsightPalette } from '@/hooks/use-theme';

type Props = {
  title: string;
  subtitle?: string;
  variant?: 'default' | 'insight';
};

export function EmptyState({ title, subtitle, variant = 'default' }: Props) {
  const styles = useStyles();
  const InsightPalette = useInsightPalette();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, variant === 'insight' && { color: InsightPalette.text }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, variant === 'insight' && { color: InsightPalette.textSecondary }]}>{subtitle}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((Palette) => ({
  wrap: {
    padding: Spacing.five,
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: { color: Palette.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  subtitle: { color: Palette.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18 },
}));
