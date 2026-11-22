import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/AppText';

/** Foreground checks are rate limited by EAS; once per 15 minutes is plenty. */
const FOREGROUND_CHECK_MS = 15 * 60_000;

/**
 * Over-the-air updates. expo-updates already checks on launch and applies a downloaded update on the
 * next cold start; this also checks when the app returns to the foreground and offers a restart as
 * soon as an update is ready, so testers don't need to force-close the app twice to see a fix.
 * Renders nothing in development, Expo Go and on web, where updates are disabled.
 */
export function UpdateBanner() {
  if (!Updates.isEnabled || __DEV__) return null;
  return <UpdateBannerInner />;
}

function UpdateBannerInner() {
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  // Remembers which update was dismissed, so a newer one is offered again.
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const lastCheck = useRef(0);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    lastCheck.current = Date.now(); // expo-updates has just checked on launch.
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active' || Date.now() - lastCheck.current < FOREGROUND_CHECK_MS) return;
      lastCheck.current = Date.now();
      void (async () => {
        try {
          const result = await Updates.checkForUpdateAsync();
          if (result.isAvailable) await Updates.fetchUpdateAsync();
        } catch {
          // Offline or rate limited: the next launch checks again.
        }
      })();
    });
    return () => subscription.remove();
  }, []);

  const updateId = downloadedUpdate?.updateId ?? 'pending';
  if (!isUpdatePending || dismissedId === updateId) return null;

  async function restart() {
    setRestarting(true);
    try {
      await Updates.reloadAsync();
    } catch {
      setRestarting(false);
    }
  }

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8 }]}>
      <View style={styles.pill} accessibilityRole="alert">
        <Text style={styles.text}>A new version is ready</Text>
        <Pressable accessibilityRole="button" onPress={restart} disabled={restarting} hitSlop={6} style={({ pressed }) => [styles.restart, pressed && styles.pressed]}>
          <Text style={styles.restartText}>{restarting ? 'Restarting…' : 'Restart'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Later" onPress={() => setDismissedId(updateId)} hitSlop={8} style={styles.later}>
          <Text style={styles.laterText}>Later</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 100 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 8, paddingVertical: 6, borderRadius: 24, backgroundColor: '#131722', boxShadow: '0 6px 20px rgba(19,23,34,0.25)' },
  text: { color: '#FFFFFF', fontSize: 14 },
  restart: { backgroundColor: '#2962FF', borderRadius: 16, paddingHorizontal: 12, minHeight: 32, justifyContent: 'center' },
  restartText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  later: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 4 },
  laterText: { color: '#B2B5BE', fontSize: 13 },
  pressed: { opacity: 0.7 },
});
