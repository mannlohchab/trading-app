import { View } from 'react-native';
import { Text } from '@/components/ui/AppText';

import { makeStyles } from '@/hooks/use-theme';

export function DemoBadge({ visible }: { visible?: boolean }) {
  const styles = useStyles();
  if (!visible) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>Demo data</Text>
    </View>
  );
}

const useStyles = makeStyles((Palette) => ({
  badge: {
    backgroundColor: Palette.accentMuted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  text: { color: Palette.accent, fontSize: 11, fontWeight: '700' },
}));
