import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Text } from '@/components/ui/AppText';
import { Palette } from '@/constants/theme';
import {
  fetchMorningDecode,
  fetchMorningDecodeAudioDataUri,
  formatDuration,
} from '@/lib/morningDecodeApi';
import { useAuth } from '@/store/auth';

/** Shared daily audio briefing at the top of Home — no transcript. */
export function MorningDecodeCard() {
  const userId = useAuth(s => s.user?.id);
  const briefQuery = useQuery({
    queryKey: ['morning-decode', userId],
    queryFn: ({ signal }) => fetchMorningDecode(signal),
    staleTime: 5 * 60_000,
    enabled: !!userId,
  });
  const brief = briefQuery.data;
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [audioState, setAudioState] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle');
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioError, setAudioError] = useState<string>();
  const webRef = useRef<WebView<{}>>(null);

  const totalSeconds = duration > 0 ? duration : (brief?.durationSeconds ?? 0);
  const progress = totalSeconds > 0 ? Math.min(1, position / totalSeconds) : 0;

  const toggleAudio = useCallback(async () => {
    if (!brief?.hasAudio) return;
    if (audioState === 'playing') {
      webRef.current?.injectJavaScript('window.__tgPause&&window.__tgPause();true;');
      setAudioState('paused');
      return;
    }
    if (audioState === 'paused' && audioUri) {
      webRef.current?.injectJavaScript('window.__tgPlay&&window.__tgPlay();true;');
      setAudioState('playing');
      return;
    }
    setAudioState('loading');
    setAudioError(undefined);
    try {
      const uri = audioUri ?? await fetchMorningDecodeAudioDataUri();
      setAudioUri(uri);
      setAudioState('playing');
    } catch (error) {
      setAudioState('error');
      setAudioError(error instanceof Error ? error.message : 'Audio unavailable');
    }
  }, [audioState, audioUri, brief?.hasAudio]);

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.header}>
          <Image source={require('@/assets/images/home-ai.png')} style={styles.art} contentFit="contain" accessible={false} />
          <View style={styles.copy}>
            <Text style={styles.kicker}>{brief?.sessionLabel ?? 'Daily market briefing'}</Text>
            <Text style={styles.title}>{brief?.title ?? 'Morning Decode'}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              !brief?.hasAudio
                ? 'Morning Decode audio not available'
                : audioState === 'playing'
                  ? 'Pause Morning Decode'
                  : 'Play Morning Decode'
            }
            disabled={!brief?.hasAudio || audioState === 'loading' || briefQuery.isLoading}
            onPress={() => void toggleAudio()}
            style={({ pressed }) => [
              styles.play,
              (!brief?.hasAudio || briefQuery.isLoading) && styles.playDisabled,
              pressed && brief?.hasAudio && styles.pressed,
            ]}>
            {audioState === 'loading' || briefQuery.isLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.playText}>
                {brief?.hasAudio ? (audioState === 'playing' ? 'Pause' : 'Play') : 'Soon'}
              </Text>
            )}
          </Pressable>
        </View>

        <View style={styles.progressRow} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.time}>
            {formatDuration(position)} / {formatDuration(totalSeconds || brief?.durationSeconds)}
          </Text>
        </View>

        {briefQuery.isError ? (
          <Text style={styles.error}>Couldn’t load Morning Decode. Pull to refresh.</Text>
        ) : !brief?.hasAudio && !briefQuery.isLoading ? (
          <Text style={styles.hint}>Today’s briefing audio isn’t ready yet.</Text>
        ) : null}

        {audioError ? <Text style={styles.error}>{audioError}</Text> : null}
        {brief?.disclaimer ? <Text style={styles.disclaimer}>{brief.disclaimer}</Text> : null}
      </View>

      {audioUri ? (
        <WebView<{}>
          ref={webRef}
          originWhitelist={['*']}
          style={styles.hiddenPlayer}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          onMessage={(event: { nativeEvent: { data: string } }) => {
            const raw = event.nativeEvent.data;
            try {
              const msg = JSON.parse(raw) as { type?: string; t?: number; d?: number };
              if (msg.type === 'time') {
                if (typeof msg.t === 'number') setPosition(msg.t);
                if (typeof msg.d === 'number' && msg.d > 0) setDuration(msg.d);
                return;
              }
              if (msg.type === 'ended') {
                setAudioState('paused');
                setPosition(0);
                return;
              }
              if (msg.type === 'pause') setAudioState('paused');
              if (msg.type === 'play') setAudioState('playing');
            } catch {
              if (raw === 'ended' || raw === 'pause') setAudioState('paused');
              if (raw === 'play') setAudioState('playing');
            }
          }}
          source={{
            html: `<!DOCTYPE html><html><body style="margin:0;background:transparent">
<audio id="a" src="${audioUri}" autoplay
  onplay="window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'play'}))"
  onpause="window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'pause'}))"
  onended="window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'ended'}))"
  ontimeupdate="(function(a){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'time',t:a.currentTime,d:a.duration||0}))})(document.getElementById('a'))"
  onloadedmetadata="(function(a){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'time',t:a.currentTime,d:a.duration||0}))})(document.getElementById('a'))"
></audio>
<script>
window.__tgPlay=function(){document.getElementById('a').play()};
window.__tgPause=function(){document.getElementById('a').pause()};
</script></body></html>`,
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 18 },
  card: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: Palette.card,
    borderWidth: 1,
    borderColor: Palette.border,
    gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  art: { width: 48, height: 48 },
  copy: { flex: 1, minWidth: 0 },
  kicker: { color: Palette.textMuted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  title: { color: Palette.text, fontSize: 16, fontWeight: '700', letterSpacing: -0.2, marginTop: 2 },
  hint: { color: Palette.textSecondary, fontSize: 13 },
  disclaimer: { color: Palette.textMuted, fontSize: 11, lineHeight: 14 },
  error: { color: Palette.red, fontSize: 12 },
  play: {
    minHeight: 36,
    minWidth: 72,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: Palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playDisabled: { backgroundColor: Palette.textMuted },
  playText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  progressRow: { gap: 6 },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Palette.borderSubtle,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: Palette.accent,
  },
  time: { color: Palette.textMuted, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.75 },
  hiddenPlayer: { width: 1, height: 1, opacity: 0, position: 'absolute' },
});
