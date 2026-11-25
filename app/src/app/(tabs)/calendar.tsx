import { useMutation, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import * as Linking from 'expo-linking';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, SectionList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CalendarEventCard } from '@/components/calendar/CalendarEventCard';
import { CalendarOverview } from '@/components/calendar/CalendarOverview';
import { TimezonePicker } from '@/components/calendar/TimezonePicker';
import { Text, TextInput } from '@/components/ui/AppText';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { Skeleton } from '@/components/ui/Skeleton';
import { Fonts } from '@/constants/theme';
import { makeStyles, useColorScheme, usePalette } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { fetchFinancialCalendar } from '@/lib/calendarApi';
import { calendarSections, calendarTimezone, filterCalendarEvents, toDateKey, type CalendarImpact, type CalendarView } from '@/lib/financialCalendar';
import { timezoneOption } from '@/lib/timezones';
import { useAuth, type User } from '@/store/auth';

const IMPACTS: { value: CalendarImpact; label: string; color?: string }[] = [
  { value: 'all', label: 'All impact' }, { value: 'high', label: 'High', color: '#A18AE7' },
  { value: 'medium', label: 'Medium', color: '#E9B16D' }, { value: 'low', label: 'Low', color: '#65B89A' },
];

/** Solid purple behind white icons and labels; reads on both themes. */
const PURPLE_FILL = '#6F47E9';
const FUNNEL_ICON = require('@/assets/icons/ui/funnel.png');

export default function FinancialCalendarScreen() {
  const styles = useStyles();
  const Palette = usePalette();
  const scheme = useColorScheme();
  const user = useAuth(s => s.user);
  const updateUser = useAuth(s => s.updateUser);
  const timeZone = calendarTimezone(user?.timezone);
  const deviceTimeZone = calendarTimezone();
  const zoneLabel = useMemo(() => { const o = timezoneOption(timeZone); return `${o.city} · ${o.offset}`; }, [timeZone]);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [zoneError, setZoneError] = useState('');
  const [impact, setImpact] = useState<CalendarImpact>('all');
  const [day, setDay] = useState('today');
  const [view, setView] = useState<CalendarView>('month');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [now, setNow] = useState(() => new Date());
  const query = useQuery({
    queryKey: ['financial-calendar', user?.id],
    queryFn: ({ signal }) => fetchFinancialCalendar(signal),
    enabled: user?.status === 'ACTIVE', staleTime: 5 * 60_000, retry: false,
  });
  const { refetch } = query;
  // Optimistic: the calendar re-renders in the new zone at once and rolls back if the profile save fails.
  const zoneMutation = useMutation({
    mutationFn: (zone: string) => api<{ timezone: string | null }>('/api/v1/me/profile', { method: 'PATCH', body: { timezone: zone } }),
    onMutate: zone => {
      const previous = useAuth.getState().user;
      setZoneError('');
      if (previous) updateUser({ ...previous, timezone: zone });
      return { previous };
    },
    onSuccess: profile => {
      const latest = useAuth.getState().user;
      if (latest && profile.timezone) updateUser({ ...latest, timezone: profile.timezone });
    },
    onError: (error, _zone, context?: { previous: User | null }) => {
      if (context?.previous) updateUser(context.previous);
      setZoneError(error.message || 'Could not save your time zone. Please try again.');
    },
  });
  const active = user?.status === 'ACTIVE';
  useFocusEffect(useCallback(() => {
    if (!active) return;
    setNow(new Date());
    void refetch();
    const timer = setInterval(() => { setNow(new Date()); void refetch(); }, 5 * 60_000);
    return () => clearInterval(timer);
  }, [active, refetch]));

  const today = toDateKey(now, timeZone);
  const data = query.data;
  // Keep Today relative to midnight; explicit dates stay selected even without published events.
  const selectedDay = day === 'today' ? today : day;
  const days = useMemo(() => calendarSections(data?.items ?? [], timeZone).filter(s => s.key !== 'undated'), [data, timeZone]);
  const sections = useMemo(() => calendarSections(filterCalendarEvents(data?.items ?? [], { search, impact, day: selectedDay }, timeZone), timeZone), [data, search, impact, selectedDay, timeZone]);
  const count = sections.reduce((sum, section) => sum + section.data.length, 0);
  const lastDay = days.at(-1)?.key;
  const oldWeek = lastDay !== undefined && lastDay < today;
  const saved = data?.stale || query.isError;
  const hasFilters = Boolean(search.trim()) || impact !== 'all';
  const agendaTitle = selectedDay === 'all' ? 'This week’s events' : selectedDay === today ? 'Today’s events' : 'Day’s events';

  const openSource = async (url: string) => {
    setLinkError('');
    try {
      if (!/^https?:\/\//i.test(url)) throw new Error('Unsupported link');
      await Linking.openURL(url);
    } catch { setLinkError('Could not open the source. Please try again.'); }
  };

  const header = <View>
    <CalendarOverview selectedDay={selectedDay} today={today} events={data?.items} timeZone={timeZone} view={view} onViewChange={setView} onDayChange={setDay} />
    <View style={styles.agendaHeading}>
      <View style={styles.agendaCopy}>
        <Text style={styles.agendaTitle} accessibilityRole="header">{agendaTitle}</Text>
        {data && <Text style={styles.eventCount}>{count}</Text>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Search and filter events" accessibilityState={{ expanded: filtersOpen }} onPress={() => setFiltersOpen(!filtersOpen)} style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}>
        <Image source={FUNNEL_ICON} style={styles.filterIcon} contentFit="contain" accessible={false} />
        {hasFilters && <View style={styles.activeFilterDot} />}
      </Pressable>
    </View>
    <View style={styles.agendaMeta}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Time zone: ${zoneLabel}. Change time zone`} disabled={zoneMutation.isPending} onPress={() => setZoneOpen(true)} style={({ pressed }) => [styles.zoneButton, pressed && styles.pressed]}>
        <Text style={styles.timezoneText} numberOfLines={1}>Times in <Text style={styles.zoneName}>{zoneLabel}</Text></Text>
        <View style={styles.zoneChevron} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={selectedDay === 'all' ? 'Show today' : 'Show full week'} onPress={() => setDay(selectedDay === 'all' ? 'today' : 'all')} style={({ pressed }) => [styles.scopeButton, pressed && styles.pressed]}>
        <Text style={styles.scopeText}>{selectedDay === 'all' ? 'Back to today' : 'Full week'}</Text>
        <View style={styles.scopeChevron} />
      </Pressable>
    </View>

    {filtersOpen && <View style={styles.filters}>
      <View style={styles.searchWrap}>
        <View accessible={false} pointerEvents="none" style={styles.searchIcon}><View style={styles.searchHandle} /></View>
        <TextInput accessibilityLabel="Search calendar events or currencies" value={search} onChangeText={setSearch} autoCorrect={false} placeholder="Search events or currencies" placeholderTextColor={scheme === 'dark' ? Palette.textMuted : '#96909F'} style={styles.search} />
      </View>
      <View style={styles.impactFilters}>
        {IMPACTS.map(item => <Pressable key={item.value} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: impact === item.value }} onPress={() => setImpact(item.value)} style={({ pressed }) => [styles.impactChip, impact === item.value && styles.impactChipActive, pressed && styles.pressed]}>
          {item.color && <View style={[styles.impactDot, { backgroundColor: item.color }]} />}
          <Text style={[styles.chipText, impact === item.value && styles.impactTextActive]}>{item.label}</Text>
        </Pressable>)}
      </View>
    </View>}
    {hasFilters && <Pressable accessibilityRole="button" accessibilityLabel="Clear calendar filters" onPress={() => { setSearch(''); setImpact('all'); }} style={styles.clearFilters}>
      <Text style={styles.scopeText}>Filters applied · Clear</Text>
    </Pressable>}
    {data?.isDemo && <Text style={styles.demoLabel}>DEMO SCHEDULE</Text>}
    {data?.stale && <Text style={styles.warningBanner}>The provider could not be refreshed. Showing the last saved schedule.</Text>}
    {oldWeek && <Text style={styles.warningBanner}>All events in this published schedule are before today.</Text>}
    {query.isError && <ErrorBanner message={data ? 'Could not refresh the calendar. Showing saved events.' : 'Could not load the calendar. Please try again shortly.'} onRetry={() => void refetch()} />}
    {linkError ? <ErrorBanner message={linkError} /> : null}
    {zoneError ? <ErrorBanner message={zoneError} /> : null}
  </View>;

  const footer = data ? <View style={styles.provenance}>
    <View style={styles.sourceRow}>
      {data.isDemo ? <Text style={styles.sourceText}>Demo preview · fictional events</Text> : <Pressable accessibilityRole="link" onPress={() => void openSource(data.sourceUrl)} style={styles.sourceLink}>
        <Text style={styles.sourceText}>{data.source} ↗</Text>
      </Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh calendar" accessibilityState={{ disabled: query.isFetching }} disabled={query.isFetching} onPress={() => void refetch()} style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}>
        <Text style={styles.refreshText}>{query.isFetching ? '···' : '↻'}</Text>
      </Pressable>
    </View>
    <Text style={[styles.meta, saved && styles.warning]}>{saved ? 'Saved data · ' : 'Retrieved '}{new Date(data.fetchedAt).toLocaleString('en-GB', { timeZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
    <Text style={styles.sourceNote}>{data.notice}</Text>
    <Text style={styles.sourceNote}>— means not supplied. Date-only events keep the publisher’s date. Only the published weekly schedule is available.</Text>
  </View> : undefined;

  const empty = <View style={styles.empty}>
    <Text style={styles.emptyTitle}>{hasFilters ? 'No matching events' : 'No events on this day'}</Text>
    <Text style={styles.emptyText}>{hasFilters ? 'Try another currency, search or impact level.' : 'There are no events for this date in the published schedule.'}</Text>
    {selectedDay !== 'all' && <Pressable accessibilityRole="button" onPress={() => setDay('all')} style={styles.emptyButton}><Text style={styles.scopeText}>View full schedule ↗</Text></Pressable>}
  </View>;

  return <SafeAreaView style={styles.safe} edges={['top']}>
    <SectionList
      sections={sections}
      keyExtractor={event => event.id}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      stickySectionHeadersEnabled={false}
      refreshing={query.isRefetching}
      onRefresh={() => void refetch()}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={query.isPending ? <View style={styles.loading}>{[0, 1, 2].map(i => <Skeleton key={i} style={styles.skeleton} />)}</View> : query.isError && !data ? undefined : empty}
      renderSectionHeader={({ section }) => selectedDay === 'all' ? <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>{section.key === today ? `Today · ${section.title}` : section.title}</Text>
        <Text style={styles.sectionCount}>{section.data.length} {section.data.length === 1 ? 'event' : 'events'}</Text>
      </View> : null}
      renderItem={({ item }) => <CalendarEventCard event={item} timeZone={timeZone} layout={view === 'week' ? 'timeline' : 'list'} onSource={url => void openSource(url)} />}
    />
    <TimezonePicker visible={zoneOpen} current={timeZone} device={deviceTimeZone} onClose={() => setZoneOpen(false)}
      onSelect={zone => { setZoneOpen(false); if (zone !== timeZone) zoneMutation.mutate(zone); }} />
  </SafeAreaView>;
}

const useStyles = makeStyles((Palette, _, scheme) => {
  const dark = scheme === 'dark';
  return {
    safe: { flex: 1, backgroundColor: Palette.bgElevated, width: '100%', maxWidth: 480, alignSelf: 'center' },
    list: { paddingHorizontal: 20, paddingBottom: 32 },
    agendaHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 18 },
    agendaCopy: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 },
    agendaTitle: { fontFamily: Fonts.sans, color: dark ? Palette.text : '#1C1C1E', fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.5, flexShrink: 1 },
    eventCount: { fontFamily: Fonts.sans, color: dark ? Palette.textMuted : '#AEAEB2', fontSize: 13, fontWeight: '500' },
    filterButton: { width: 36, height: 36, backgroundColor: PURPLE_FILL, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    filterIcon: { width: 18, height: 18 },
    activeFilterDot: { position: 'absolute', top: 5, right: 5, width: 6, height: 6, borderRadius: 3, backgroundColor: '#E3F5BB' },
    agendaMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', columnGap: 8, flexWrap: 'wrap', paddingBottom: 4 },
    zoneButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
    timezoneText: { fontFamily: Fonts.sans, color: dark ? Palette.textSecondary : '#8E8E93', fontSize: 12, lineHeight: 16, flexShrink: 1 },
    zoneName: { color: dark ? Palette.text : '#4E4658', fontWeight: '600' },
    zoneChevron: { width: 6, height: 6, marginTop: -3, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: dark ? Palette.textSecondary : '#8E8E93', transform: [{ rotate: '45deg' }] },
    scopeButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6 },
    scopeText: { fontFamily: Fonts.sans, color: Palette.purple, fontSize: 13, lineHeight: 18, fontWeight: '600' },
    scopeChevron: { width: 6, height: 6, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: Palette.purple, transform: [{ rotate: '-45deg' }] },
    filters: { paddingBottom: 12, gap: 9 },
    searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, borderRadius: 12, backgroundColor: dark ? Palette.purpleMuted : '#F6F2FC', borderWidth: 1.5, borderColor: dark ? '#3B3354' : '#CFC5DF' },
    searchIcon: { width: 13, height: 13, borderWidth: 1.8, borderColor: dark ? Palette.textSecondary : '#655D70', borderRadius: 7, marginRight: 3 },
    searchHandle: { position: 'absolute', width: 6, height: 1.5, backgroundColor: dark ? Palette.textSecondary : '#655D70', right: -5, bottom: -2, transform: [{ rotate: '45deg' }] },
    search: { fontFamily: Fonts.sans, flex: 1, minWidth: 0, minHeight: 44, paddingVertical: 10, fontSize: 13, fontWeight: '600', color: dark ? Palette.text : '#2F2936' },
    impactFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    impactChip: { flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingHorizontal: 12, gap: 6, justifyContent: 'center', borderRadius: 12, borderWidth: 1.5, borderColor: dark ? '#3B3354' : '#D8CFE5', backgroundColor: Palette.card },
    impactChipActive: { backgroundColor: PURPLE_FILL, borderColor: PURPLE_FILL },
    impactDot: { width: 6, height: 6, borderRadius: 3 },
    chipText: { fontFamily: Fonts.sans, color: dark ? Palette.textSecondary : '#514A59', fontSize: 12, fontWeight: '700' },
    impactTextActive: { color: Palette.onAccent, fontWeight: '800' },
    clearFilters: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    demoLabel: { fontFamily: Fonts.sans, color: dark ? Palette.textMuted : '#918B99', fontSize: 8, lineHeight: 12, letterSpacing: 1, marginBottom: 10 },
    provenance: { gap: 5, paddingTop: 15, marginTop: 12, borderTopWidth: 1, borderTopColor: dark ? Palette.borderSubtle : '#F1F0F4' },
    sourceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    sourceLink: { minHeight: 44, justifyContent: 'center', flexShrink: 1 },
    sourceText: { fontFamily: Fonts.sans, color: dark ? Palette.textSecondary : '#77707F', fontSize: 10, lineHeight: 16, flexShrink: 1 },
    sourceNote: { fontFamily: Fonts.sans, color: dark ? Palette.textMuted : '#918B99', fontSize: 10, lineHeight: 17 },
    meta: { fontFamily: Fonts.sans, color: dark ? Palette.textMuted : '#918B99', fontSize: 10, lineHeight: 16 },
    refresh: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 14, backgroundColor: dark ? Palette.pill : '#F7F5FA' },
    refreshText: { fontFamily: Fonts.sans, color: Palette.purple, fontSize: 22, lineHeight: 28 },
    warning: { color: dark ? Palette.yellow : '#946323' },
    warningBanner: { fontFamily: Fonts.sans, color: dark ? Palette.yellow : '#946323', fontSize: 11, lineHeight: 18, padding: 12, borderRadius: 12, backgroundColor: dark ? '#2A2010' : '#FFF5E6', marginBottom: 10 },
    sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 16, paddingBottom: 4 },
    sectionTitle: { flex: 1, color: dark ? Palette.textSecondary : '#8E8E93', fontFamily: Fonts.sans, fontSize: 13, lineHeight: 18, fontWeight: '600' },
    sectionCount: { fontFamily: Fonts.sans, color: dark ? Palette.textMuted : '#AEAEB2', fontSize: 12 },
    loading: { gap: 12, paddingTop: 12 },
    skeleton: { height: 72, borderRadius: 16 },
    empty: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 32, gap: 8, borderTopWidth: 1, borderTopColor: dark ? Palette.borderSubtle : '#F1F0F4' },
    emptyTitle: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '500', color: dark ? Palette.text : '#4E4658' },
    emptyText: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 20, textAlign: 'center', color: dark ? Palette.textMuted : '#918B99' },
    emptyButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
    pressed: { opacity: 0.55 },
  };
});
