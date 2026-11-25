import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Text } from '@/components/ui/AppText';
import { Fonts } from '@/constants/theme';
import { makeStyles, useColorScheme } from '@/hooks/use-theme';
import {
  fetchMorningDecode,
  fetchMorningDecodeAudioDataUri,
  formatDuration,
} from '@/lib/morningDecodeApi';
import { useAuth } from '@/store/auth';

/** The player's own greys: a soft light card in light mode, a raised cool card in dark mode. */
const PLAYER = {
  light: { card: '#F2F2F5', ink: '#24252B', muted: '#747680', disabled: '#B2B3BB', track: '#DADBE0', fill: '#7D7F89', artwork: '#E1E1F1' },
  dark: { card: '#1B202B', ink: '#ECEEF4', muted: '#A0A6B8', disabled: '#4A4F5C', track: '#2E3340', fill: '#A0A6B8', artwork: '#262B37' },
} as const;
const WAVEFORM_HEIGHTS = [6, 11, 16, 8, 13, 6];

/** Shared daily audio briefing at the top of Home — no transcript. */
export function MorningDecodeCard() {
  const styles = useStyles();
  const { ink: PLAYER_INK, disabled: PLAYER_DISABLED } = PLAYER[useColorScheme()];
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
  const [dismissed, setDismissed] = useState(false);
  const webRef = useRef<WebView<object>>(null);

  const totalSeconds = duration > 0 ? duration : (brief?.durationSeconds ?? 0);
  const progress = totalSeconds > 0 ? Math.min(1, position / totalSeconds) : 0;
  const remainingSeconds = totalSeconds > 0 ? Math.max(0, totalSeconds - position) : null;
  const isLoading = audioState === 'loading' || briefQuery.isLoading;
  const isPlaying = audioState === 'playing';
  const playDisabled = !brief?.hasAudio || isLoading;
  const canSkip = !!brief?.hasAudio && !!audioUri && duration > 0 && (isPlaying || audioState === 'paused');

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

  const skipAudio = (seconds: number) => {
    if (!canSkip) return;
    webRef.current?.injectJavaScript(`window.__tgSkip&&window.__tgSkip(${seconds});true;`);
  };

  const dismissCard = () => {
    webRef.current?.injectJavaScript('window.__tgPause&&window.__tgPause();true;');
    setAudioState('paused');
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss Morning Decode"
          accessibilityHint="Hide this briefing for the current app session"
          onPress={dismissCard}
          hitSlop={2}
          style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
          <View style={[styles.closeLine, styles.closeLineForward]} accessible={false} />
          <View style={[styles.closeLine, styles.closeLineBackward]} accessible={false} />
        </Pressable>
        <View style={styles.header}>
          <View style={styles.artwork}>
            <Image source={require('@/assets/images/morning-decode-cover.jpg')} style={styles.art} contentFit="cover" accessible={false} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.title} accessibilityRole="header">{brief?.title ?? 'Morning Decode'}</Text>
            <Text style={styles.subtitle}>
              {brief?.sessionLabel ?? 'Daily market briefing'}{brief && !brief.hasAudio ? ' · Audio coming soon' : ''}
            </Text>
          </View>
          <View style={styles.waveform} accessible={false} importantForAccessibility="no-hide-descendants">
            {WAVEFORM_HEIGHTS.map((height, index) => (
              <View key={index} style={[styles.waveformBar, { height }, isPlaying && styles.waveformBarActive]} />
            ))}
          </View>
        </View>

        <View
          style={styles.progressRow}
          accessibilityRole="progressbar"
          accessibilityLabel="Morning Decode playback progress"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
          <Text style={styles.time}>{formatDuration(position)}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.time}>{remainingSeconds === null ? '—:—' : `−${formatDuration(remainingSeconds)}`}</Text>
        </View>

        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Rewind 15 seconds"
            accessibilityState={{ disabled: !canSkip }}
            disabled={!canSkip}
            onPress={() => skipAudio(-15)}
            style={({ pressed }) => [styles.skip, pressed && styles.pressed]}>
            <View style={styles.skipIcon}>
              <SymbolView
                name={{ ios: 'gobackward', android: 'replay', web: 'replay' }}
                size={26}
                tintColor={canSkip ? PLAYER_INK : PLAYER_DISABLED}
                type="monochrome"
                accessible={false}
              />
              <Text style={[styles.skipAmount, !canSkip && styles.disabledText]} accessible={false}>15</Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              !brief?.hasAudio
                ? 'Morning Decode audio not available'
                : isPlaying
                  ? 'Pause Morning Decode'
                  : 'Play Morning Decode'
            }
            accessibilityState={{ disabled: playDisabled, busy: isLoading }}
            disabled={playDisabled}
            onPress={() => void toggleAudio()}
            style={({ pressed }) => [styles.play, pressed && styles.pressed]}>
            {isLoading ? (
              <ActivityIndicator color={PLAYER_INK} size="small" />
            ) : isPlaying ? (
              <View style={styles.pauseIcon} accessible={false}>
                <View style={styles.pauseBar} />
                <View style={styles.pauseBar} />
              </View>
            ) : (
              <View style={[styles.playIcon, playDisabled && styles.playIconDisabled]} accessible={false} />
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Forward 15 seconds"
            accessibilityState={{ disabled: !canSkip }}
            disabled={!canSkip}
            onPress={() => skipAudio(15)}
            style={({ pressed }) => [styles.skip, pressed && styles.pressed]}>
            <View style={styles.skipIcon}>
              <SymbolView
                name={{ ios: 'goforward', android: 'forward_media', web: 'forward_media' }}
                size={26}
                tintColor={canSkip ? PLAYER_INK : PLAYER_DISABLED}
                type="monochrome"
                accessible={false}
              />
              <Text style={[styles.skipAmount, !canSkip && styles.disabledText]} accessible={false}>15</Text>
            </View>
          </Pressable>
        </View>

        {briefQuery.isError ? <Text style={styles.error}>Couldn’t load Morning Decode. Pull to refresh.</Text> : null}

        {audioError ? <Text style={styles.error}>{audioError}</Text> : null}
      </View>
      {brief?.disclaimer ? <Text style={styles.disclaimer}>{brief.disclaimer}</Text> : null}

      {audioUri ? (
        <WebView<object>
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
window.__tgSkip=function(seconds){
  var a=document.getElementById('a');
  if(!Number.isFinite(a.duration)||a.duration<=0)return;
  a.currentTime=Math.max(0,Math.min(a.duration,a.currentTime+seconds));
  window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'time',t:a.currentTime,d:a.duration}));
};
</script></body></html>`,
          }}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((Palette, _InsightPalette, scheme) => {
  const { card, ink: PLAYER_INK, muted: PLAYER_MUTED, disabled: PLAYER_DISABLED, track, fill, artwork } = PLAYER[scheme];
  return {
    wrap: { marginBottom: 11 },
    card: {
      position: 'relative',
      paddingHorizontal: 14,
      paddingTop: 8,
      paddingBottom: 5,
      borderRadius: 20,
      backgroundColor: card,
      boxShadow: '0 6px 24px rgba(35, 37, 55, 0.06)',
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 30 },
    closeButton: { position: 'absolute', zIndex: 2, top: 0, right: 0, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    closeLine: { position: 'absolute', width: 12, height: 1.5, borderRadius: 1, backgroundColor: PLAYER_INK },
    closeLineForward: { transform: [{ rotate: '45deg' }] },
    closeLineBackward: { transform: [{ rotate: '-45deg' }] },
    artwork: {
      width: 38,
      height: 38,
      borderRadius: 11,
      overflow: 'hidden',
      backgroundColor: artwork,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#000000',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 3px 9px rgba(57, 54, 92, 0.08)',
    },
    art: { width: '100%', height: '100%', borderRadius: 11 },
    copy: { flex: 1, minWidth: 0 },
    title: { fontFamily: Fonts.sans, color: PLAYER_INK, fontSize: 17, fontWeight: '700', letterSpacing: -0.5, lineHeight: 20 },
    subtitle: { fontFamily: Fonts.sans, color: PLAYER_MUTED, fontSize: 10, lineHeight: 13, marginTop: 1 },
    waveform: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 18 },
    waveformBar: { width: 3, borderRadius: 2, backgroundColor: PLAYER_DISABLED },
    waveformBarActive: { backgroundColor: PLAYER_INK },
    disclaimer: { fontFamily: Fonts.sans, color: PLAYER_MUTED, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 6, paddingHorizontal: 10 },
    error: { fontFamily: Fonts.sans, color: Palette.red, fontSize: 10, lineHeight: 13, textAlign: 'center', marginTop: 1 },
    controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginTop: 2 },
    play: {
      width: 48,
      height: 44,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
    },
    playIcon: {
      width: 0,
      height: 0,
      borderTopWidth: 12,
      borderBottomWidth: 12,
      borderLeftWidth: 20,
      borderTopColor: 'transparent',
      borderBottomColor: 'transparent',
      borderLeftColor: PLAYER_INK,
      marginLeft: 5,
    },
    playIconDisabled: { borderLeftColor: PLAYER_DISABLED },
    pauseIcon: { flexDirection: 'row', gap: 6 },
    pauseBar: { width: 7, height: 24, borderRadius: 3, backgroundColor: PLAYER_INK },
    skip: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    skipIcon: { width: 27, height: 27, alignItems: 'center', justifyContent: 'center' },
    skipAmount: { position: 'absolute', top: 10, fontFamily: Fonts.sans, fontSize: 8, lineHeight: 10, fontWeight: '700', color: PLAYER_INK },
    disabledText: { color: PLAYER_DISABLED },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
    track: {
      flex: 1,
      height: 4,
      borderRadius: 3,
      backgroundColor: track,
      overflow: 'hidden',
    },
    fill: {
      height: '100%',
      borderRadius: 3,
      backgroundColor: fill,
    },
    time: { fontFamily: Fonts.sans, color: PLAYER_MUTED, fontSize: 10, lineHeight: 12, fontWeight: '500', fontVariant: ['tabular-nums'] },
    pressed: { opacity: 0.5, transform: [{ scale: 0.96 }] },
    hiddenPlayer: { width: 1, height: 1, opacity: 0, position: 'absolute' },
  };
});
