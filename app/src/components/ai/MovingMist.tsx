import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

const BLOB = require('@/assets/images/ai-mist-blob.png');
const NATIVE = Platform.OS !== 'web';

/** Soft purple blobs. `size` is a fraction of the screen width. */
const BLOBS = [
  { color: '#A855F7', size: 1.25, opacity: 0.21 },
  { color: '#C084FC', size: 1.05, opacity: 0.2 },
  { color: '#8B5CF6', size: 0.95, opacity: 0.15 },
  { color: '#D8B4FE', size: 1.15, opacity: 0.225 },
] as const;

type Drift = { x: Animated.Value; y: Animated.Value; scale: Animated.Value };

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

/**
 * Welcome-screen backdrop: purple blobs that wander to random spots, slowly and indefinitely.
 * Motion runs only while `active`, the screen is focused, and Reduce Motion is off.
 */
export function MovingMist({ active }: { active: boolean }) {
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [reduceMotion, setReduceMotion] = useState(false);
  const [focused, setFocused] = useState(true);
  const [drifts] = useState<Drift[]>(() => BLOBS.map(() => ({
    x: new Animated.Value(0), y: new Animated.Value(0), scale: new Animated.Value(1),
  })));

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);

  // Focus is tracked through navigation events, so it still updates while the tab is frozen.
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  const { width, height } = area;
  useEffect(() => {
    if (!width || !height) return;
    // Spread the blobs out before the first move so they never start stacked.
    drifts.forEach((drift, i) => {
      drift.x.setValue(width * (i % 2 ? 0.35 : -0.35));
      drift.y.setValue(height * (i < 2 ? -0.25 : 0.1));
    });
  }, [drifts, width, height]);

  useEffect(() => {
    if (!active || !focused || reduceMotion || !width || !height) return;
    let running = true;
    const animations: Animated.CompositeAnimation[] = [];
    const move = (drift: Drift, index: number) => {
      if (!running) return;
      const duration = randomBetween(7000, 12000);
      const easing = Easing.inOut(Easing.sin);
      const animation = Animated.parallel([
        Animated.timing(drift.x, { toValue: randomBetween(-0.5, 0.5) * width, duration, easing, useNativeDriver: NATIVE }),
        // Keep the colour mostly in the upper two thirds, behind the welcome text.
        Animated.timing(drift.y, { toValue: randomBetween(-0.4, 0.2) * height, duration, easing, useNativeDriver: NATIVE }),
        Animated.timing(drift.scale, { toValue: randomBetween(0.8, 1.25), duration, easing, useNativeDriver: NATIVE }),
      ]);
      animations[index] = animation;
      animation.start(({ finished }) => { if (finished) move(drift, index); });
    };
    drifts.forEach(move);
    return () => {
      running = false;
      animations.forEach((animation) => animation?.stop());
    };
  }, [active, focused, reduceMotion, drifts, width, height]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width: w, height: h } = event.nativeEvent.layout;
    if (w !== width || h !== height) setArea({ width: w, height: h });
  };

  return (
    <View pointerEvents="none" style={styles.fill} onLayout={onLayout}>
      {width > 0 && BLOBS.map((blob, i) => {
        const size = width * blob.size;
        return (
          <Animated.View key={blob.color} style={[styles.blob, {
            width: size, height: size, opacity: blob.opacity,
            left: (width - size) / 2, top: (height - size) / 2,
            transform: [{ translateX: drifts[i].x }, { translateY: drifts[i].y }, { scale: drifts[i].scale }],
          }]}>
            <Image source={BLOB} tintColor={blob.color} style={styles.fill} contentFit="contain" accessible={false} />
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  blob: { position: 'absolute' },
});
