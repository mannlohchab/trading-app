import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';

import { Palette, Spacing } from '@/constants/theme';

type Props = {
  message: string;
  onRetry?: () => void;
};

export function ErrorBanner({ message, onRetry }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button">
          <Text style={styles.retry}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    padding: Spacing.three,
    borderRadius: 10,
    backgroundColor: 'rgba(246,70,93,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(246,70,93,0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  text: { color: Palette.red, flex: 1, fontSize: 13, lineHeight: 18 },
  retry: { color: Palette.text, fontWeight: '800', fontSize: 13 },
});
