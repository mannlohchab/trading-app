// The assistant's work while answering, as a trace: a line per tool call that pulses while it runs,
// shows a tick and its duration when done, and expands to show what it was asked.
import { memo, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/AppText';
import { InsightPalette as P } from '@/constants/theme';
import { formatDuration, stepDetails, stepTitle, visibleSteps, type ToolStep } from '@/lib/aiTrace';

const ERROR = '#B91C1C';

/** Gently pulses its children while `active` (a native stand-in for a text shimmer). Still when reduce-motion is on. */
function Pulse({ active, children }: { active: boolean; children: ReactNode }) {
  const [opacity] = useState(() => new Animated.Value(1));
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);
  useEffect(() => {
    if (!active || reduceMotion) { opacity.stopAnimation(); opacity.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active, reduceMotion, opacity]);
  return <Animated.View style={{ opacity, flexShrink: 1 }}>{children}</Animated.View>;
}

function StatusMark({ status }: { status: ToolStep['status'] | 'thinking' }) {
  if (status === 'done') return <Text style={styles.tick}>✓</Text>;
  if (status === 'error') return <Text style={[styles.tick, { color: ERROR }]}>!</Text>;
  return <View style={styles.dotBox}><View style={styles.dot} /></View>;
}

function Step({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const details = stepDetails(step);
  const expandable = details.length > 0 || !!step.error;
  const title = stepTitle(step);
  const duration = step.status === 'running' ? '' : formatDuration(step.durationMs);
  const line = (
    <View style={styles.line}>
      <StatusMark status={step.status} />
      <Pulse active={step.status === 'running'}>
        <Text numberOfLines={1} style={[styles.title, step.status === 'error' && styles.errorText]}>
          {title}{step.status === 'running' ? '…' : ''}
        </Text>
      </Pulse>
      {!!duration && <Text style={styles.duration}>{duration}</Text>}
      {expandable && <View style={[styles.chevron, open && styles.chevronOpen]} />}
    </View>
  );
  if (!expandable) return <View accessible accessibilityLabel={`${title}${duration ? `, ${duration}` : ''}`}>{line}</View>;
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}${step.status === 'error' ? ', failed' : ''}${duration ? `, ${duration}` : ''}`}
        accessibilityHint={open ? 'Hide details' : 'Show details'} hitSlop={6}
        onPress={() => setOpen((value) => !value)} style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}>
        {line}
      </Pressable>
      {open && (
        <View style={styles.details}>
          {details.map((row) => (
            <View key={row.label} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{row.label}</Text>
              <Text selectable style={styles.detailValue}>{row.value}</Text>
            </View>
          ))}
          {!!step.error && <Text selectable style={[styles.detailValue, styles.errorText]}>{step.error}</Text>}
        </View>
      )}
    </View>
  );
}

/** Tool steps, then (while nothing has been written yet) a pulsing "Thinking" line. */
export const AiTrace = memo(function AiTrace({ steps: all, thinking }: { steps?: ToolStep[]; thinking?: boolean }) {
  const steps = visibleSteps(all);
  if (!steps.length && !thinking) return null;
  return (
    <View style={styles.trace} accessibilityLiveRegion="polite">
      {steps?.map((step) => <Step key={step.id} step={step} />)}
      {thinking && (
        <View style={styles.line} accessible accessibilityLabel="Thinking">
          <StatusMark status="thinking" />
          <Pulse active><Text style={styles.title}>{steps?.length ? 'Putting it together…' : 'Thinking…'}</Text></Pulse>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  trace: { gap: 8, paddingVertical: 2 },
  trigger: { alignSelf: 'flex-start', maxWidth: '100%', borderRadius: 6 },
  pressed: { opacity: 0.6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 22, maxWidth: '100%' },
  title: { color: P.textSecondary, fontSize: 13, lineHeight: 19 },
  errorText: { color: ERROR },
  duration: { color: P.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  tick: { width: 14, textAlign: 'center', color: P.textMuted, fontSize: 12, fontWeight: '700' },
  dotBox: { width: 14, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#6E5CE6' },
  chevron: { width: 6, height: 6, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: P.textMuted, transform: [{ rotate: '-45deg' }], marginLeft: 1 },
  chevronOpen: { transform: [{ rotate: '45deg' }], marginTop: -3 },
  details: { marginTop: 6, marginBottom: 2, marginLeft: 6, paddingLeft: 14, borderLeftWidth: 1, borderLeftColor: P.border, gap: 4 },
  detailRow: { flexDirection: 'row', gap: 10 },
  detailLabel: { width: 76, color: P.textMuted, fontSize: 12, lineHeight: 18 },
  detailValue: { flex: 1, color: P.body, fontSize: 12, lineHeight: 18 },
});
