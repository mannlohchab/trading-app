import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/AppText';
import { Fonts } from '@/constants/theme';
import { calendarGrid, eventDay, moveCalendarDate, type CalendarEvent, type CalendarView } from '@/lib/financialCalendar';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const NO_EVENTS: CalendarEvent[] = [];

type Props = {
  selectedDay: string;
  today: string;
  events?: CalendarEvent[];
  timeZone: string;
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  onDayChange: (day: string) => void;
};

function dotColor(event: CalendarEvent) {
  if (event.importance === 3) return '#4C8DFF';
  if (event.importance === 2) return '#34C759';
  if (event.importance === 1) return '#FF5A7A';
  return '#C7C7CC';
}

function headerDate(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  const month = date.toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short' });
  const weekday = date.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long' });
  return `${date.getUTCDate()} ${month}, ${String(date.getUTCFullYear()).slice(-2)} ${weekday}`;
}

function Chevron({ direction }: { direction: 'left' | 'right' | 'down' }) {
  const rotate = direction === 'left' ? '-135deg' : direction === 'down' ? '135deg' : '45deg';
  return <View style={[styles.chevron, { transform: [{ rotate }] }]} />;
}

export function CalendarOverview({ selectedDay, today, events = NO_EVENTS, timeZone, view, onViewChange, onDayChange }: Props) {
  const anchor = selectedDay === 'all' ? today : selectedDay;
  const cells = calendarGrid(anchor, view);
  const dots = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const event of events) {
      const key = eventDay(event, timeZone);
      const color = dotColor(event);
      const colors = map.get(key) ?? [];
      if (!colors.includes(color) && colors.length < 3) colors.push(color);
      map.set(key, colors);
    }
    return map;
  }, [events, timeZone]);

  return <View style={styles.calendar}>
    <View style={styles.header}>
      {view === 'week' ? <Pressable accessibilityRole="button" accessibilityLabel="Show month" onPress={() => onViewChange('month')} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <Chevron direction="left" />
      </Pressable> : null}
      <View style={styles.headerCopy}>
        {view === 'week' ? <Text style={styles.eyebrow}>This week</Text> : null}
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={styles.dateTitle}>{headerDate(anchor)}</Text>
          {view === 'month' ? <Pressable accessibilityRole="button" accessibilityLabel="Show week view" onPress={() => onViewChange('week')} style={({ pressed }) => [styles.inlineChevron, pressed && styles.pressed]}>
            <Chevron direction="down" />
          </Pressable> : null}
        </View>
      </View>
      <View style={styles.nav}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Previous ${view}`} onPress={() => onDayChange(moveCalendarDate(anchor, -1, view))} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          <Chevron direction="left" />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Next ${view}`} onPress={() => onDayChange(moveCalendarDate(anchor, 1, view))} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          <Chevron direction="right" />
        </Pressable>
      </View>
    </View>

    {view === 'week' ? <View style={styles.weekStrip}>
      {cells.map(key => {
        if (!key) return null;
        const cellDate = new Date(`${key}T12:00:00Z`);
        const selected = key === selectedDay;
        return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${headerDate(key)}${key === today ? ', today' : ''}${dots.has(key) ? ', has events' : ''}`} accessibilityState={{ selected }} onPress={() => onDayChange(key === today ? 'today' : key)} style={({ pressed }) => [styles.weekDay, pressed && styles.pressed]}>
          <Text style={[styles.weekName, selected && styles.weekNameSelected]}>{WEEKDAYS[cellDate.getUTCDay()]}</Text>
          <View style={[styles.weekNumber, selected && styles.weekNumberSelected]}>
            <Text style={[styles.weekNumberText, selected && styles.weekNumberTextSelected]}>{cellDate.getUTCDate()}</Text>
          </View>
        </Pressable>;
      })}
    </View> : <View>
      <View style={styles.weekdays}>{WEEKDAYS.map(label => <Text key={label} style={styles.weekday}>{label}</Text>)}</View>
      <View style={styles.monthGrid}>
        {cells.map((key, index) => {
          if (!key) return <View key={`blank-${index}`} style={styles.monthCell} />;
          const selected = key === selectedDay;
          const colors = dots.get(key) ?? [];
          return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${headerDate(key)}${key === today ? ', today' : ''}${colors.length ? ', has events' : ''}`} accessibilityState={{ selected }} onPress={() => onDayChange(key === today ? 'today' : key)} style={({ pressed }) => [styles.monthCell, pressed && styles.pressed]}>
            <View style={[styles.dayCircle, selected && styles.daySelected]}>
              <Text style={[styles.dayText, key === today && !selected && styles.todayText, selected && styles.dayTextSelected]}>{Number(key.slice(-2))}</Text>
            </View>
            <View style={styles.dotRow}>
              {colors.map(color => <View key={color} style={[styles.dot, { backgroundColor: color }]} />)}
            </View>
          </Pressable>;
        })}
      </View>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  calendar: { paddingTop: 8, paddingBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 18 },
  headerCopy: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  inlineChevron: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontFamily: Fonts.sans, color: '#8E8E93', fontSize: 12, lineHeight: 16, fontWeight: '500' },
  dateTitle: { fontFamily: Fonts.sans, color: '#1C1C1E', fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.3, flexShrink: 1 },
  nav: { flexDirection: 'row', alignItems: 'center' },
  iconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  chevron: { width: 8, height: 8, borderTopWidth: 1.5, borderRightWidth: 1.5, borderColor: '#1C1C1E', marginTop: -1 },
  weekdays: { flexDirection: 'row', marginBottom: 6 },
  weekday: { flex: 1, fontFamily: Fonts.sans, color: '#AEAEB2', fontSize: 12, lineHeight: 16, fontWeight: '500', textAlign: 'center' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  monthCell: { width: '14.285714%', height: 48, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 2 },
  dayCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  daySelected: { backgroundColor: '#111111' },
  dayText: { fontFamily: Fonts.sans, color: '#3A3A3C', fontSize: 15, lineHeight: 18, fontWeight: '500', fontVariant: ['tabular-nums'] },
  todayText: { fontWeight: '700', color: '#1C1C1E' },
  dayTextSelected: { color: '#FFFFFF', fontWeight: '600' },
  dotRow: { flexDirection: 'row', gap: 2, height: 6, marginTop: 2, alignItems: 'center' },
  dot: { width: 4, height: 4, borderRadius: 2 },
  weekStrip: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 8 },
  weekDay: { flex: 1, alignItems: 'center', gap: 6, minHeight: 62, paddingVertical: 4 },
  weekName: { fontFamily: Fonts.sans, color: '#8E8E93', fontSize: 12, lineHeight: 16, fontWeight: '500' },
  weekNameSelected: { color: '#1C1C1E', fontWeight: '700', textDecorationLine: 'underline' },
  weekNumber: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  weekNumberSelected: { backgroundColor: '#111111' },
  weekNumberText: { fontFamily: Fonts.sans, color: '#3A3A3C', fontSize: 15, lineHeight: 18, fontWeight: '500', fontVariant: ['tabular-nums'] },
  weekNumberTextSelected: { color: '#FFFFFF', fontWeight: '600' },
  pressed: { opacity: 0.45 },
});
