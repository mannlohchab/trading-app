import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/ui/AppText';

type Props = { exiting?: boolean };

/** Wordmark on the same sky as the welcome screen. Coins arrive on the next screen. */
export function BrandSplash({ exiting = false }: Props) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(exiting ? 0 : 1, {
      duration: exiting ? 280 : 520,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
  }, [exiting, opacity]);

  const mark = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View style={styles.screen} accessibilityRole="image" accessibilityLabel="TradingGurukul">
      <Animated.View style={[styles.mark, mark]}>
        <Text style={styles.kicker}>Trading</Text>
        <Text style={styles.name}>Gurukul</Text>
        <View style={styles.rule} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F2EDEA', alignItems: 'center', justifyContent: 'center' },
  mark: { alignItems: 'center' },
  kicker: {
    color: '#16181D',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 3.4,
    textTransform: 'uppercase',
  },
  name: {
    color: '#16181D',
    fontSize: 44,
    lineHeight: 50,
    fontWeight: '600',
    letterSpacing: -1.4,
    marginTop: 4,
  },
  rule: { width: 28, height: 2, borderRadius: 1, backgroundColor: '#16181D', marginTop: 14 },
});
