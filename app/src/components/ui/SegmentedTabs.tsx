import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';

import { InsightPalette, Palette, Spacing } from '@/constants/theme';

type Props = {
  tabs: string[];
  value: string;
  onChange: (tab: string) => void;
  variant?: 'default' | 'insight';
};

export function SegmentedTabs({ tabs, value, onChange, variant = 'default' }: Props) {
  const warm = variant === 'insight';
  return (
    <View style={[styles.row, warm && styles.warmRow]}>
      {tabs.map((tab) => {
        const selected = tab === value;
        return (
          <Pressable
            key={tab}
            onPress={() => onChange(tab)}
            style={[styles.tab, selected && styles.tabSelected]}
            accessibilityRole="tab"
            accessibilityState={{ selected }}>
            <Text style={[styles.label, selected && styles.labelSelected, warm && styles.warmLabel, warm && selected && styles.warmSelected]}>{tab}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  warmRow: { backgroundColor: InsightPalette.soft },
  warmLabel: { color: InsightPalette.textSecondary, fontWeight: '500' },
  warmSelected: { color: InsightPalette.text, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    backgroundColor: '#EEF0F6',
    borderRadius: 14,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    borderRadius: 11,
  },
  tabSelected: {
    backgroundColor: '#FFFFFF',
  },
  label: {
    color: Palette.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  labelSelected: {
    color: Palette.accent,
    fontWeight: '700',
  },
});
