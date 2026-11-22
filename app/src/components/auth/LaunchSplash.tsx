import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { useAuth } from '@/store/auth';

import { BrandSplash } from './BrandSplash';

type Phase = 'hold' | 'leave' | 'gone';

/** Covers the first screen after launch when nobody is signed in. */
export function LaunchSplash() {
  const user = useAuth((s) => s.user);
  const [phase, setPhase] = useState<Phase>(() => (user ? 'gone' : 'hold'));

  useEffect(() => {
    if (phase !== 'hold') return;
    let cancel = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancel) return;
      timer = setTimeout(() => setPhase('leave'), reduced ? 280 : 1100);
    });
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'leave') return;
    const timer = setTimeout(() => setPhase('gone'), 280);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === 'gone') return null;

  return (
    <View style={styles.cover} pointerEvents="auto">
      <BrandSplash exiting={phase === 'leave'} />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFill, zIndex: 20 },
});
