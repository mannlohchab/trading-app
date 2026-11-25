import { memo, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { BAND, PILL, type BandTone, type PillTone } from '@/lib/runTicket';

const INK = '#0B0B2B';
const MUTED = '#7A8090';

export type TicketAction = {
  label: string;
  onPress: () => void;
  /** solid: dark pill. outline: light pill with a dark border. */
  variant?: 'solid' | 'outline';
  disabled?: boolean;
  pending?: boolean;
  accessibilityLabel?: string;
  /** For toggles such as "Compare". */
  checked?: boolean;
};

/**
 * A saved run as a ticket: a colored band (market and date), then a white body that overlaps it
 * with the name, a status pill, a dashed tear line, the headline number and actions.
 */
export const RunTicket = memo(function RunTicket(props: {
  band: BandTone;
  headerLeft: string;
  headerRight?: string;
  eyebrow?: string;
  title: string;
  status: { label: string; tone: PillTone };
  /** Headline number, e.g. "+4.26%". */
  value?: string | null;
  valueTone?: 'gain' | 'loss';
  /** Under the number: "Return · 37 trades · drawdown 3.1%". */
  caption?: string;
  /** Shown instead of the number (errors, "still running"). */
  note?: ReactNode;
  busy?: boolean;
  actions?: TicketAction[];
  onPress?: () => void;
  accessibilityLabel?: string;
  children?: ReactNode;
}) {
  const band = BAND[props.band];
  const pill = PILL[props.status.tone];
  const top = <>
    <View style={[styles.header, { backgroundColor: band.background }]}>
      <Text numberOfLines={1} style={[styles.headerText, styles.headerLeft, { color: band.text }]}>{props.headerLeft}</Text>
      {props.headerRight ? <Text style={[styles.headerText, { color: band.text }]}>{props.headerRight}</Text> : null}
    </View>
    <View style={styles.bodyTop}>
      <View style={styles.flex}>
        {props.eyebrow ? <Text numberOfLines={1} style={styles.eyebrow}>{props.eyebrow}</Text> : null}
        <Text numberOfLines={2} style={styles.title}>{props.title}</Text>
      </View>
      <View style={[styles.pill, { backgroundColor: pill.background }]}>
        <Text accessibilityLiveRegion="polite" style={[styles.pillText, { color: pill.text }]}>{props.status.label}</Text>
      </View>
    </View>
  </>;

  return <View style={styles.shadow}>
    <View accessibilityLabel={props.onPress ? undefined : props.accessibilityLabel} style={[styles.card, { backgroundColor: band.background }]}>
      {/* Only the band and title open the run: buttons below stay separate, reachable controls. */}
      {props.onPress
        ? <Pressable accessibilityRole="button" accessibilityLabel={props.accessibilityLabel ?? props.title} onPress={props.onPress}
            style={({ pressed }) => pressed && styles.pressed}>{top}</Pressable>
        : top}
      <View style={styles.bodyBottom}>
        <TearLine />
        <View style={styles.footer}>
          <View style={styles.flex}>
            {props.busy ? <ActivityIndicator size="small" color={INK} style={styles.spinner} /> : null}
            {props.value ? <Text style={[styles.value, props.valueTone === 'loss' && styles.loss, props.valueTone === 'gain' && styles.gain]}>{props.value}</Text> : null}
            {!props.value && !props.busy ? props.note : null}
          </View>
          {props.actions?.length ? <View style={styles.actions}>
            {props.actions.map(action => <TicketButton key={action.label} {...action} />)}
          </View> : null}
        </View>
        {props.caption || ((props.value || props.busy) && props.note) ? <View style={styles.details}>
          {props.caption ? <Text style={styles.caption}>{props.caption}</Text> : null}
          {props.value || props.busy ? props.note : null}
        </View> : null}
        {props.children}
      </View>
    </View>
  </View>;
});

function TicketButton({ label, onPress, variant = 'solid', disabled, pending, accessibilityLabel, checked }: TicketAction) {
  const outline = variant === 'outline';
  return <Pressable onPress={onPress} disabled={disabled || pending} hitSlop={4}
    accessibilityRole={checked === undefined ? 'button' : 'checkbox'} accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ disabled: disabled || pending, busy: pending, ...(checked !== undefined && { checked }) }}
    style={({ pressed }) => [styles.button, outline && styles.outline, (disabled || pending) && styles.disabled, pressed && styles.pressed]}>
    {pending ? <ActivityIndicator size="small" color={outline ? INK : '#FFFFFF'} /> : null}
    <Text style={[styles.buttonText, outline && styles.outlineText]}>{label}</Text>
  </Pressable>;
}

/** Dashed rule like a ticket's tear line (dashed borders render unreliably on Android). */
function TearLine() {
  return <View style={styles.tear} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {Array.from({ length: 60 }, (_, i) => <View key={i} style={styles.dash} />)}
  </View>;
}

const styles = StyleSheet.create({
  shadow: {
    borderRadius: 26,
    backgroundColor: 'transparent',
    ...Platform.select({
      ios: { shadowColor: '#1B2340', shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: 12 } },
      android: { elevation: 3 },
      default: { boxShadow: '0 12px 32px rgba(27, 35, 64, 0.08)' },
    }),
  },
  card: { borderRadius: 26, overflow: 'hidden' },
  pressed: { opacity: 0.85 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 34 },
  headerText: { fontSize: 17, letterSpacing: 0.3, fontWeight: '500' },
  headerLeft: { flexShrink: 1 },
  bodyTop: { marginTop: -18, backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 22, paddingTop: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  bodyBottom: { backgroundColor: '#FFFFFF', paddingHorizontal: 22, paddingBottom: 20, gap: 14 },
  details: { gap: 4, marginTop: -4 },
  flex: { flex: 1, minWidth: 0 },
  eyebrow: { color: MUTED, fontSize: 13, marginBottom: 6 },
  title: { color: INK, fontSize: 21, lineHeight: 27, fontWeight: '500', letterSpacing: -0.2 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginTop: 2 },
  pillText: { fontSize: 13, fontWeight: '600' },
  tear: { flexDirection: 'row', gap: 5, overflow: 'hidden', height: 1 },
  dash: { width: 7, height: 1, backgroundColor: '#E2E5EC' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  value: { color: INK, fontSize: 30, lineHeight: 36, fontWeight: '500', letterSpacing: -0.5 },
  gain: { color: '#078A62' },
  loss: { color: '#C62D2D' },
  caption: { color: MUTED, fontSize: 12.5, lineHeight: 18 },
  spinner: { alignSelf: 'flex-start', marginVertical: 6 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  button: { minHeight: 44, paddingHorizontal: 18, borderRadius: 999, backgroundColor: INK, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '500' },
  outline: { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: INK },
  outlineText: { color: INK },
  disabled: { opacity: 0.4 },
});
