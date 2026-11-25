import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/AppText';

import { Spacing } from '@/constants/theme';
import { makeStyles } from '@/hooks/use-theme';

type Props = {
  message: string;
  onRetry?: () => void;
};

export function ErrorBanner({ message, onRetry }: Props) {
  const styles = useStyles();
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

const useStyles = makeStyles((Palette, _InsightPalette, scheme) => ({
  wrap: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    padding: Spacing.three,
    borderRadius: 10,
    // Translucent red tint; a touch stronger in dark mode so it still reads on near-black.
    backgroundColor: scheme === 'dark' ? 'rgba(244,63,94,0.16)' : 'rgba(246,70,93,0.12)',
    borderWidth: 1,
    borderColor: scheme === 'dark' ? 'rgba(244,63,94,0.4)' : 'rgba(246,70,93,0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  text: { color: Palette.red, flex: 1, fontSize: 13, lineHeight: 18 },
  retry: { color: Palette.text, fontWeight: '800', fontSize: 13 },
}));
