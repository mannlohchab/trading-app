import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, type SharedValue, useAnimatedStyle,
  useReducedMotion, useSharedValue, withTiming,
} from 'react-native-reanimated';

const COLORS = ['#facc15', '#fb7185', '#a855f7', '#38bdf8', '#a3e635', '#2dd4bf'];
const PIECES = Array.from({ length: 48 }, (_, index) => ({
  color: COLORS[index % COLORS.length],
  spread: ((index * 73) % 420) - 210,
  lift: 90 + ((index * 37) % 140),
  rotation: (index * 47) % 360,
  round: index % 4 === 0,
}));

function ConfettiPiece({ index, progress }: { index: number; progress: SharedValue<number> }) {
  const piece = PIECES[index];
  const animatedStyle = useAnimatedStyle(() => {
    const t = progress.value;
    return {
      opacity: Math.max(0, Math.min(1, (1 - t) * 5)),
      transform: [
        { translateX: piece.spread * t },
        { translateY: -4 * piece.lift * t * (1 - t) + 140 * t * t },
        { rotate: `${piece.rotation + t * 720}deg` },
        { scaleX: Math.cos(t * Math.PI * 5 + index) },
      ],
    };
  });

  return (
    <Animated.View style={[
      styles.piece,
      { backgroundColor: piece.color, borderRadius: piece.round ? 4 : 0 },
      animatedStyle,
    ]} />
  );
}

export function SwipeConfetti() {
  const progress = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    progress.value = withTiming(1, { duration: 1900, easing: Easing.out(Easing.quad) });
    return () => cancelAnimation(progress);
  }, [progress]);

  if (reducedMotion) return null;

  return (
    <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}>
      {PIECES.map((_, index) => <ConfettiPiece key={index} index={index} progress={progress} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', left: '50%', top: '50%', width: 5, height: 8 },
});
