import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/AppText';
import { Fonts } from '@/constants/theme';
import { economicValue } from '@/lib/economics';
import { type CalendarEvent } from '@/lib/financialCalendar';

type Kind = 'high' | 'medium' | 'low' | 'other';

const PASTEL: Record<Kind, string> = {
  high: '#DEF2FC',
  medium: '#E7F6EE',
  low: '#FCF0E6',
  other: '#F4F4F6',
};

const INK: Record<Kind, string> = {
  high: '#3D7EBF',
  medium: '#2F9E62',
  low: '#E08A45',
  other: '#8E8E93',
};

function kindOf(event: CalendarEvent): Kind {
  if (event.importance === 3) return 'high';
  if (event.importance === 2) return 'medium';
  if (event.importance === 1) return 'low';
  return 'other';
}

function impactLabel(event: CalendarEvent) {
  if (event.status === 'holiday') return 'Holiday';
  if (event.importance === 3) return 'High impact';
  if (event.importance === 2) return 'Medium impact';
  if (event.importance === 1) return 'Low impact';
  return 'Release';
}

function clockLabel(event: CalendarEvent, timeZone: string) {
  if (event.status === 'holiday') return 'All day';
  if (!event.date) return 'Time TBC';
  return new Date(event.date).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
}

function KindIcon({ kind }: { kind: Kind }) {
  const color = INK[kind];
  if (kind === 'high') return <View style={styles.iconSlot} accessible={false}>
    <View style={[styles.bell, { borderColor: color }]} />
    <View style={[styles.bellClapper, { backgroundColor: color }]} />
  </View>;
  if (kind === 'medium') return <View style={[styles.ring, { borderColor: color }]} accessible={false} />;
  return <View style={styles.iconSlot} accessible={false}>
    <View style={[styles.miniCal, { borderColor: color }]}>
      <View style={[styles.miniCalHeader, { backgroundColor: color }]} />
    </View>
  </View>;
}

export function CalendarEventCard({ event, timeZone, onSource, layout = 'list' }: {
  event: CalendarEvent;
  timeZone: string;
  onSource: (url: string) => void;
  layout?: 'list' | 'timeline';
}) {
  const kind = kindOf(event);
  const sourceUrl = event.sourceUrl ?? event.url;
  const time = clockLabel(event, timeZone);
  const kicker = [event.currency ?? event.country, impactLabel(event)].filter(Boolean).join(' · ');
  const figures = event.status === 'holiday' ? '' : [['Actual', event.actual], ['Forecast', event.forecast], ['Previous', event.previous]]
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) => `${label} ${economicValue(value)}`)
    .join(' · ');

  const body = <>
    <Text style={layout === 'timeline' ? styles.cardKicker : styles.kicker}>{kicker}</Text>
    <Text style={layout === 'timeline' ? styles.cardTitle : styles.title}>{event.event}</Text>
    <Text style={layout === 'timeline' ? styles.cardTime : styles.time}>{time}</Text>
    {figures ? <Text style={layout === 'timeline' ? styles.cardFigures : styles.figures}>{figures}</Text> : null}
    {event.reference ? <Text style={styles.note}>{event.reference}</Text> : null}
    {event.dataStale ? <Text style={styles.note}>Source marks this release as stale.</Text> : null}
  </>;

  if (layout === 'timeline') {
    return <View style={styles.timelineRow}>
      <Text style={styles.gutter}>{time}</Text>
      <View style={[styles.card, { backgroundColor: PASTEL[kind] }]}>
        <View style={styles.cardTop}>
          <View style={styles.cardCopy}>{body}</View>
          <KindIcon kind={kind} />
        </View>
        {sourceUrl ? <Pressable accessibilityRole="link" accessibilityLabel={`View source for ${event.event}`} onPress={() => onSource(sourceUrl)} style={styles.cardLink}>
          <Text style={[styles.linkText, { color: INK[kind] }]}>Source</Text>
        </Pressable> : null}
      </View>
    </View>;
  }

  return <View style={styles.listRow}>
    <KindIcon kind={kind} />
    <View style={styles.listCopy}>
      {body}
    </View>
    {sourceUrl ? <Pressable accessibilityRole="link" accessibilityLabel={`View source for ${event.event}`} onPress={() => onSource(sourceUrl)} hitSlop={8} style={({ pressed }) => [styles.sourceMark, pressed && styles.pressed]}>
      <Text style={styles.sourceMarkText}>↗</Text>
    </Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  listRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EFEFF4',
  },
  listCopy: { flex: 1, minWidth: 0 },
  kicker: { fontFamily: Fonts.sans, color: '#8E8E93', fontSize: 12, lineHeight: 16, fontWeight: '500' },
  title: { fontFamily: Fonts.sans, color: '#1C1C1E', fontSize: 16, lineHeight: 21, fontWeight: '600', letterSpacing: -0.3, marginTop: 1 },
  time: { fontFamily: Fonts.sans, color: '#8E8E93', fontSize: 13, lineHeight: 18, marginTop: 2 },
  figures: { fontFamily: Fonts.sans, color: '#8E8E93', fontSize: 12, lineHeight: 17, marginTop: 4 },
  note: { fontFamily: Fonts.sans, color: '#AEAEB2', fontSize: 11, lineHeight: 15, marginTop: 3 },
  sourceMark: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  sourceMarkText: { fontFamily: Fonts.sans, color: '#1C1C1E', fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.45 },
  timelineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  gutter: { width: 64, fontFamily: Fonts.sans, color: '#8E8E93', fontSize: 11, lineHeight: 16, fontWeight: '500', paddingTop: 14 },
  card: { flex: 1, minWidth: 0, borderRadius: 18, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardCopy: { flex: 1, minWidth: 0 },
  cardKicker: { fontFamily: Fonts.sans, color: '#6B6B70', fontSize: 12, lineHeight: 16, fontWeight: '500' },
  cardTitle: { fontFamily: Fonts.sans, color: '#1C1C1E', fontSize: 16, lineHeight: 21, fontWeight: '700', letterSpacing: -0.3, marginTop: 1 },
  cardTime: { fontFamily: Fonts.sans, color: '#3A3A3C', fontSize: 13, lineHeight: 18, marginTop: 8 },
  cardFigures: { fontFamily: Fonts.sans, color: '#6B6B70', fontSize: 12, lineHeight: 17, marginTop: 4 },
  cardLink: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center', marginTop: 2 },
  linkText: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '600' },
  iconSlot: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  ring: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.6, marginTop: 2 },
  bell: { width: 12, height: 10, borderWidth: 1.6, borderBottomWidth: 0, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  bellClapper: { width: 6, height: 2, borderRadius: 1, marginTop: 1 },
  miniCal: { width: 16, height: 15, borderWidth: 1.5, borderRadius: 3, overflow: 'hidden' },
  miniCalHeader: { height: 4 },
});
