import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';

import { Palette, Spacing } from '@/constants/theme';

type Props = {
  tabs: string[];
  value: string;
  onChange: (tab: string) => void;
};

export function SegmentedTabs({ tabs, value, onChange }: Props) {
  return (
    <View style={styles.row}>
      {tabs.map((tab) => {
        const selected = tab === value;
        return (
          <Pressable
            key={tab}
            onPress={() => onChange(tab)}
            style={[styles.tab, selected && styles.tabSelected]}
            accessibilityRole="tab"
            accessibilityState={{ selected }}>
            <Text style={[styles.label, selected && styles.labelSelected]}>{tab}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
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
