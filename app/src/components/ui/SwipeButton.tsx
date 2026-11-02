import { type Ref, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { AppFont } from '@/constants/theme';

import { getSwipeOffset, isSwipeComplete } from './swipe-gesture';
import { SwipeConfetti } from './SwipeConfetti';

export type SwipeButtonHandle = { submit: () => Promise<void> };

type SwipeButtonProps = {
  loading?: boolean;
  // Return false after displaying a submission error so the user can retry.
  onSwipeComplete: () => Promise<boolean>;
  onSuccess: () => void;
  ref?: Ref<SwipeButtonHandle>;
};

const HANDLE_WIDTH = 48;
const TRACK_INSET = 4;

export function SwipeButton({ loading = false, onSwipeComplete, onSuccess, ref }: SwipeButtonProps) {
  const [travel, setTravel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [focused, setFocused] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const offset = useSharedValue(0);
  const success = useSharedValue(0);
  const locked = loading || busy || completed;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    offset.value = withTiming(locked ? travel : 0, { duration: 220 });
  }, [locked, offset, travel]);

  useEffect(() => {
    success.value = withTiming(completed ? 1 : 0, { duration: 280 });
    if (!completed) return;
    // Hold the checkmark and confetti like the reference before entering the app.
    const timer = setTimeout(onSuccess, 2000);
    return () => clearTimeout(timer);
  }, [completed, onSuccess, success]);

  const completeSwipe = useCallback(async () => {
    if (locked || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    offset.value = withTiming(travel, { duration: 160 });
    let succeeded = false;
    try {
      succeeded = await onSwipeComplete();
    } finally {
      if (mounted.current) {
        setCompleted(succeeded);
        setBusy(false);
        if (!succeeded) offset.value = withTiming(0, { duration: 220 });
      }
      submitting.current = succeeded;
    }
  }, [locked, offset, onSwipeComplete, travel]);

  useImperativeHandle(ref, () => ({ submit: completeSwipe }), [completeSwipe]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !locked && !submitting.current && travel > 0,
    onMoveShouldSetPanResponder: (_, gesture) => !locked && !submitting.current
      && travel > 0 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: () => { offset.value = 0; },
    onPanResponderMove: (_, gesture) => {
      if (!locked && !submitting.current) offset.value = getSwipeOffset(gesture.dx, travel);
    },
    onPanResponderRelease: (_, gesture) => {
      if (locked || submitting.current) return;
      if (isSwipeComplete(gesture.dx, travel)) {
        void completeSwipe();
      } else {
        offset.value = withTiming(0, { duration: 220 });
      }
    },
    onPanResponderTerminate: () => {
      if (!locked && !submitting.current) offset.value = withTiming(0, { duration: 220 });
    },
  }), [completeSwipe, locked, offset, travel]);

  const handleStyle = useAnimatedStyle(() => ({
    opacity: completed ? 0 : 1,
    transform: [{ translateX: offset.value }],
  }));
  const successStyle = useAnimatedStyle(() => ({
    opacity: completed ? 1 : 0,
    left: 3 + travel * (1 - success.value),
    width: HANDLE_WIDTH + travel * success.value,
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: completed ? 0 : locked ? 1 : 1 - Math.min(1, offset.value / Math.max(1, travel)) * 0.65,
  }));

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={completed ? 'Signed in' : loading || busy ? 'Signing in' : 'Swipe to sign in'}
      accessibilityHint="Drag the arrow to the right, or activate to sign in."
      accessibilityState={{ disabled: locked, busy: loading || busy }}
      accessibilityLiveRegion="polite"
      accessibilityActions={[{ name: 'activate', label: 'Sign in' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate') void completeSwipe();
      }}
      onAccessibilityTap={() => { void completeSwipe(); }}
      tabIndex={locked ? -1 : 0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(event) => {
        const { key, repeat } = event.nativeEvent;
        if ((key === 'Enter' || key === ' ') && !repeat) {
          event.preventDefault();
          void completeSwipe();
        }
      }}
      style={[styles.container, completed && styles.celebrating]}>
      <View
        onLayout={(event) => setTravel(Math.max(0, event.nativeEvent.layout.width - HANDLE_WIDTH - TRACK_INSET * 2))}
        style={[styles.track, focused && styles.focused]}>
        <Animated.Text selectable={false} style={[styles.label, labelStyle]}>
          {loading || busy ? 'Signing in…' : 'Swipe to sign in'}
        </Animated.Text>
        <Animated.View
          {...pan.panHandlers}
          accessible={false}
          hitSlop={6}
          style={[styles.handle, handleStyle]}>
          {loading || busy ? (
            <ActivityIndicator color="#262626" size="small" />
          ) : (
            <View style={styles.chevron} />
          )}
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.success, successStyle]}>
          <View style={styles.checkmark} />
        </Animated.View>
      </View>
      {completed ? <SwipeConfetti /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', alignSelf: 'center', marginTop: 16, paddingVertical: 4 },
  celebrating: { zIndex: 1 },
  track: {
    height: 56,
    backgroundColor: '#171717',
    borderWidth: 1,
    borderColor: '#292929',
    borderRadius: 12,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  focused: { borderColor: '#a3a3a3' },
  success: {
    position: 'absolute', top: 3, bottom: 3,
    backgroundColor: '#00c896', borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  label: { fontFamily: AppFont, color: '#858585', fontSize: 16, fontWeight: '400', textAlign: 'center', marginHorizontal: 54 },
  handle: {
    position: 'absolute', left: 3, top: 3, width: HANDLE_WIDTH, height: 48,
    borderRadius: 8, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  chevron: { width: 8, height: 8, borderTopWidth: 2, borderRightWidth: 2, borderColor: '#262626', transform: [{ rotate: '45deg' }], marginLeft: -4 },
  checkmark: { width: 8, height: 14, borderBottomWidth: 2, borderRightWidth: 2, borderColor: '#164e3e', transform: [{ rotate: '45deg' }], marginTop: -4 },
});
