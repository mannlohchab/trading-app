import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Text } from '@/components/ui/AppText';
import { Palette } from '@/constants/theme';
import { fetchDailyBrief, fetchDailyBriefAudioDataUri } from '@/lib/dailyBriefApi';
import { useAuth } from '@/store/auth';

/** Daily market brief at the top of Home: cached text + optional OpenRouter audio. */
export function HomeAiPrompt() {
  const userId = useAuth(s => s.user?.id);
  const briefQuery = useQuery({
    queryKey: ['daily-brief', userId],
    queryFn: ({ signal }) => fetchDailyBrief(signal),
    staleTime: 5 * 60_000,
    enabled: !!userId,
  });
  const brief = briefQuery.data;
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [audioState, setAudioState] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle');
  const [audioError, setAudioError] = useState<string>();
  const webRef = useRef<WebView<{}>>(null);

  const toggleAudio = useCallback(async () => {
    if (!brief?.hasAudio) {
      router.push('/(tabs)/ai');
      return;
    }
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
      const uri = audioUri ?? await fetchDailyBriefAudioDataUri();
      setAudioUri(uri);
      setAudioState('playing');
    } catch (error) {
      setAudioState('error');
      setAudioError(error instanceof Error ? error.message : 'Audio unavailable');
    }
  }, [audioState, audioUri, brief?.hasAudio]);

  const preview = brief?.content?.split('\n').filter(Boolean).slice(0, 3).join('\n');

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.header}>
          <Image source={require('@/assets/images/home-ai.png')} style={styles.art} contentFit="contain" accessible={false} />
          <View style={styles.copy}>
            <Text style={styles.kicker}>Daily brief{brief?.date ? ` · ${brief.date}` : ''}</Text>
            <Text style={styles.title}>AI market analysis</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={brief?.hasAudio ? (audioState === 'playing' ? 'Pause brief audio' : 'Play brief audio') : 'Open AI Insight'}
            onPress={() => void toggleAudio()}
            style={({ pressed }) => [styles.play, pressed && styles.pressed]}>
            {audioState === 'loading' || briefQuery.isLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.playText}>
                {brief?.hasAudio ? (audioState === 'playing' ? 'Pause' : 'Listen') : 'Ask'}
              </Text>
            )}
          </Pressable>
        </View>

        {briefQuery.isError ? (
          <Text style={styles.error}>Couldn’t load today’s brief. Pull to refresh or open AI Insight.</Text>
        ) : preview ? (
          <Text style={styles.body} numberOfLines={6}>{preview}</Text>
        ) : (
          <Text style={styles.hint}>{briefQuery.isLoading ? 'Preparing today’s brief…' : 'Ask about markets'}</Text>
        )}

        {audioError ? <Text style={styles.error}>{audioError}</Text> : null}
        {brief?.disclaimer ? <Text style={styles.disclaimer}>{brief.disclaimer}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open full AI Insight chat"
          onPress={() => router.push('/(tabs)/ai')}
          style={({ pressed }) => [styles.chatLink, pressed && styles.pressed]}>
          <Text style={styles.chatLinkText}>Continue in AI Insight ›</Text>
        </Pressable>
      </View>

      {audioUri ? (
        <WebView<{}>
          ref={webRef}
          originWhitelist={['*']}
          style={styles.hiddenPlayer}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          onMessage={(event: { nativeEvent: { data: string } }) => {
            const data = event.nativeEvent.data;
            if (data === 'ended' || data === 'pause') setAudioState('paused');
            if (data === 'play') setAudioState('playing');
          }}
          source={{
            html: `<!DOCTYPE html><html><body style="margin:0;background:transparent">
<audio id="a" src="${audioUri}" autoplay
  onplay="window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('play')"
  onpause="window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('pause')"
  onended="window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('ended')"></audio>
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
    gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  art: { width: 48, height: 48 },
  copy: { flex: 1, minWidth: 0 },
  kicker: { color: Palette.textMuted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  title: { color: Palette.text, fontSize: 16, fontWeight: '700', letterSpacing: -0.2, marginTop: 2 },
  body: { color: Palette.textSecondary, fontSize: 14, lineHeight: 20 },
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
  playText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  chatLink: { alignSelf: 'flex-start', paddingVertical: 2 },
  chatLinkText: { color: Palette.accent, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.75 },
  hiddenPlayer: { width: 1, height: 1, opacity: 0, position: 'absolute' },
});
