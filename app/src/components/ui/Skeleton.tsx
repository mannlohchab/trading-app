import { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Palette } from '@/constants/theme';

export function Skeleton({ style }: { style?: ViewStyle }) {
  const opacity = useSharedValue(0.35);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.8, { duration: 800 }), -1, true);
  }, [opacity]);
  const anim = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.base, style, anim]} />;
}

export function InstrumentRowSkeleton() {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton style={{ width: 80, height: 14, borderRadius: 4 }} />
        <Skeleton style={{ width: 120, height: 10, borderRadius: 4 }} />
      </View>
      <Skeleton style={{ width: 64, height: 28, borderRadius: 4 }} />
      <View style={{ width: 72, alignItems: 'flex-end', gap: 6 }}>
        <Skeleton style={{ width: 56, height: 14, borderRadius: 4 }} />
        <Skeleton style={{ width: 44, height: 10, borderRadius: 4 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: Palette.cardHover },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.borderSubtle,
  },
});
