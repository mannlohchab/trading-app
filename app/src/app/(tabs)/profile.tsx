import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InstrumentRowSkeleton } from '@/components/ui/Skeleton';
import { PaperOrders } from '@/components/trading/PaperOrders';
import { fetchActivity, fetchPortfolio, type PaperActivity } from '@/lib/paperTrading';
import { PortfolioAllocationBar } from '@/components/charts/PortfolioAllocationBar';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { ProfileSettings } from '@/components/profile/ProfileSettings';
import { SymbolIcon } from '@/components/markets/SymbolIcon';
import { InsightPalette as P } from '@/constants/theme';
import { ApiError } from '@/lib/api';
import { formatMarketPrice, formatUsd, formatPct } from '@/lib/format';
import { displayNameOf, useAuth, type User } from '@/store/auth';

const TABS = ['Overview', 'Portfolio', 'Settings'] as const;
type Tab = (typeof TABS)[number];
/** Same green/red as the Market list and chart. */
const UP = '#089981';
const DOWN = '#F23645';

type PaperTransaction = PaperActivity;

const money = (value: number | null, digits = 2) => value === null ? '—' : formatUsd(value, digits);
const percent = (value: number | null) => value === null ? '—' : formatPct(value);
const tone = (value: number | null | undefined) => value == null || value === 0 ? P.textSecondary : value > 0 ? UP : DOWN;

function parseTimestamp(value: string) {
  const trimmed = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(trimmed) ? `${trimmed.replace(' ', 'T')}Z` : trimmed;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}
function formatMemberSince(value: string) {
  const date = parseTimestamp(value);
  return date ? date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : value;
}
function formatStamp(value: string) {
  const date = parseTimestamp(value);
  return date ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : value;
}
function overviewErrorMessage(error: unknown, hasData: boolean) {
  if (hasData) return 'Could not refresh your portfolio. Showing the last loaded values.';
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof TypeError || (error instanceof Error && /network|fetch|failed/i.test(error.message))) {
    return 'Could not reach the trading server. Your saved profile stays on this device; cash, positions, and activity appear when the API responds.';
  }
  return 'Your portfolio is temporarily unavailable.';
}

export default function ProfileScreen() {
  const [tab, setTab] = useState<Tab>('Overview');
  // Other screens can open a specific tab, e.g. the top bar's bell opens Settings. `at` makes each request distinct.
  const params = useLocalSearchParams<{ tab?: string; at?: string }>();
  const tabRequest = params.tab && (TABS as readonly string[]).includes(params.tab) ? `${params.tab}:${params.at ?? ''}` : undefined;
  const [handledTabRequest, setHandledTabRequest] = useState<string>();
  if (tabRequest && tabRequest !== handledTabRequest) {
    setHandledTabRequest(tabRequest);
    setTab(params.tab as Tab);
  }
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const [refreshing, setRefreshing] = useState(false);
  const signOut = useAuth((s) => s.signOut);
  const updateUser = useAuth((s) => s.updateUser);
  const sessionUser = useAuth((s) => s.user);
  const qc = useQueryClient();

  // Shares the order ticket's cache, so a fill shows up here straight away.
  const overviewQuery = useQuery({
    queryKey: ['paper-portfolio', sessionUser?.id],
    queryFn: ({ signal }) => fetchPortfolio(sessionUser!.id, signal),
    enabled: Boolean(sessionUser),
    refetchInterval: 15_000,
  });

  const txQuery = useQuery({
    queryKey: ['transactions', sessionUser?.id],
    enabled: Boolean(sessionUser) && (tab === 'Overview' || tab === 'Portfolio'),
    refetchInterval: tab === 'Overview' || tab === 'Portfolio' ? 15_000 : false,
    queryFn: ({ signal }) => fetchActivity(sessionUser!.id, signal),
  });

  const data = overviewQuery.data;
  const profileUser = sessionUser;
  const portfolio = data;
  const valuationNote = portfolio?.valuationStatus && portfolio.valuationStatus !== 'current' ? portfolio.valuationStatus : null;

  function selectTab(next: Tab) {
    setTab(next);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  function onUserSaved(user: User) {
    updateUser(user);
  }

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([overviewQuery.refetch(), ...(tab === 'Overview' || tab === 'Portfolio' ? [txQuery.refetch()] : [])]);
    } finally { setRefreshing(false); }
  }

  async function logout() {
    await qc.cancelQueries();
    await signOut();
    qc.clear();
    router.replace('/(auth)/login');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>Profile</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh profile and portfolio" accessibilityState={{ disabled: refreshing }} disabled={refreshing}
          onPress={() => void refresh()} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          {refreshing ? <ActivityIndicator color={P.text} size="small" />
            : <SymbolView name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} size={20} tintColor={P.text} accessible={false} />}
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={Platform.OS !== 'web'}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={P.text} colors={[P.text]} />}>
        {overviewQuery.isError ? <ErrorBanner message={overviewErrorMessage(overviewQuery.error, Boolean(data))} onRetry={() => void overviewQuery.refetch()} /> : null}

        {profileUser ? (
          <View style={styles.identity}>
            <View style={styles.identityRow}>
              <View style={styles.avatar}>
                {profileUser.avatarUrl
                  ? <Image source={{ uri: profileUser.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={`${displayNameOf(profileUser)} avatar`} />
                  : <Text style={styles.initial}>{displayNameOf(profileUser).charAt(0).toUpperCase()}</Text>}
              </View>
              <View style={styles.identityText}>
                <Text style={styles.name} numberOfLines={1}>{displayNameOf(profileUser)}</Text>
                <Text style={styles.handle} numberOfLines={1}>{profileUser.username ? `@${profileUser.username}` : profileUser.email}</Text>
              </View>
              {tab !== 'Settings' && (
                <Pressable accessibilityRole="button" accessibilityLabel="Edit profile" onPress={() => selectTab('Settings')} style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
                  <Text style={styles.editText}>Edit</Text>
                </Pressable>
              )}
            </View>
          </View>
        ) : null}

        <View style={styles.tabs}>
          <SegmentedTabs tabs={[...TABS]} value={tab} onChange={value => selectTab(value as Tab)} variant="insight" />
        </View>

        {tab === 'Overview' ? (
          <View style={styles.section}>
            <Text style={styles.kicker}>{portfolio && portfolio.equity === null ? 'Available cash · USDT' : 'Paper portfolio · USDT'}</Text>
            <Text style={styles.equity} numberOfLines={1} adjustsFontSizeToFit>
              {portfolio ? (portfolio.equity === null ? money(portfolio.availableCash ?? portfolio.cashBalance) : money(portfolio.equity)) : overviewQuery.isLoading ? ' ' : '—'}
            </Text>
            {portfolio && portfolio.totalPnl !== null ? (
              <Text style={[styles.equityChange, { color: tone(portfolio.totalPnl) }]}>
                {money(portfolio.totalPnl)}  {percent(portfolio.totalPnlPercent)} <Text style={styles.muted}>all time</Text>
              </Text>
            ) : null}
            {valuationNote ? <Text style={styles.note}>Some market prices are {valuationNote}. Cash, cost, and quantities below are from your paper account. Totals appear only when every position has a price.</Text> : null}
            <View style={styles.allocation}><PortfolioAllocationBar portfolio={portfolio} loading={overviewQuery.isLoading} /></View>
            {portfolio ? (
              <View style={styles.list}>
                <Line icon="cash" label="Available cash" value={money(portfolio.availableCash ?? portfolio.cashBalance)} />
                <Line icon="btc" label="In positions" value={money(portfolio.invested)} />
                <Line label="Open positions" value={String(portfolio.positions.length)} onPress={() => selectTab('Portfolio')} last />
              </View>
            ) : null}
            {txQuery.data && txQuery.data.transactions.length > 0 ? (
              <>
                <SectionTitle title="Recent activity" />
                {txQuery.data.transactions.slice(0, 5).map((t, index, all) => (
                  <ActivityRow key={t.id} tx={t} last={index === all.length - 1} />
                ))}
              </>
            ) : null}
            {profileUser ? <Text style={styles.footer}>Member since {formatMemberSince(profileUser.createdAt)}</Text> : null}
          </View>
        ) : null}

        {tab === 'Portfolio' && overviewQuery.isLoading && !portfolio ? <View style={styles.section}><InstrumentRowSkeleton /></View> : null}

        {tab === 'Portfolio' && !portfolio && !overviewQuery.isLoading ? (
          <View style={styles.section}>
            <Text style={styles.emptyTitle}>Portfolio figures are unavailable</Text>
            <Text style={styles.emptyText}>Your paper cash, positions, and orders load from the trading server. Pull to refresh once it responds. Nothing here is estimated.</Text>
            <View style={styles.orders}><PaperOrders /></View>
            <SectionTitle title="Recent activity" />
            <ActivityList query={txQuery} />
          </View>
        ) : null}

        {tab === 'Portfolio' && portfolio ? (
          <View style={styles.section}>
            <Text style={styles.kicker}>Total value</Text>
            <Text style={styles.equity} numberOfLines={1} adjustsFontSizeToFit>{money(portfolio.equity)}</Text>
            {portfolio.totalPnl !== null ? (
              <Text style={[styles.equityChange, { color: tone(portfolio.totalPnl) }]}>{money(portfolio.totalPnl)}  {percent(portfolio.totalPnlPercent)}</Text>
            ) : null}
            {valuationNote ? <Text style={styles.note}>Valuation {valuationNote}. Cash and quantities are current.</Text> : null}
            <View style={styles.list}>
              <Line icon="cash" label="Available cash" value={money(portfolio.availableCash ?? portfolio.cashBalance)} />
              <Line icon="cash" label="Reserved cash" value={money(portfolio.reservedCash ?? 0)} />
              <Line icon="btc" label="In positions" value={money(portfolio.invested)} />
              {portfolio.totalFees !== undefined ? <Line label="Fees paid" value={money(portfolio.totalFees)} /> : null}
              <Line label="Unrealized P&L" value={money(portfolio.unrealizedPnl)} color={tone(portfolio.unrealizedPnl)} />
              <Line label="Realized P&L" value={money(portfolio.realizedPnl)} color={tone(portfolio.realizedPnl)} last />
            </View>

            <SectionTitle title="Positions" count={portfolio.positions.length} />
            {portfolio.positions.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No positions yet</Text>
                <Text style={styles.emptyText}>Open a crypto chart and place a paper trade to build your portfolio.</Text>
                <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/market')} style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]}>
                  <Text style={styles.emptyButtonText}>Browse markets</Text>
                </Pressable>
              </View>
            ) : portfolio.positions.map((p, index) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${p.name}, market value ${money(p.marketValue)}`}
                onPress={() => router.push({ pathname: '/instrument/[symbol]', params: { symbol: p.symbol, exchange: p.exchange, name: p.name } })}
                style={({ pressed }) => [styles.row, index === portfolio.positions.length - 1 && styles.rowLast, pressed && styles.pressed]}>
                <SymbolIcon symbol={p.symbol} exchange={p.exchange} size={40} />
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{p.symbol}</Text>
                  <Text style={styles.rowMeta} numberOfLines={2}>
                    {p.quantity}{p.availableQuantity != null && p.availableQuantity !== p.quantity ? ` (${p.availableQuantity} available)` : ''} @ {formatMarketPrice(p.avgPrice, p, false)} · Last {p.ltp === null ? '—' : formatMarketPrice(p.ltp, p, false)}
                  </Text>
                </View>
                <View style={styles.rowRight}>
                  <Text style={styles.rowValue} numberOfLines={1}>{money(p.marketValue)}</Text>
                  <Text style={[styles.rowChange, { color: tone(p.unrealizedPnl) }]} numberOfLines={1}>{money(p.unrealizedPnl)}  {percent(p.unrealizedPnlPercent)}</Text>
                </View>
              </Pressable>
            ))}

            <View style={styles.orders}><PaperOrders /></View>

            <SectionTitle title="Recent activity" />
            <ActivityList query={txQuery} />
          </View>
        ) : null}

        {tab === 'Settings' && profileUser && (
          <ProfileSettings key={profileUser.id} user={profileUser} onUserSaved={onUserSaved} onLogout={logout} />
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ActivityRow({ tx, last }: { tx: PaperTransaction; last?: boolean }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={[styles.side, { backgroundColor: tx.type === 'BUY' ? 'rgba(8,153,129,0.16)' : tx.type === 'SELL' ? 'rgba(242,54,69,0.16)' : P.soft }]}>
        <Text style={[styles.sideText, { color: tx.type === 'BUY' ? UP : tx.type === 'SELL' ? DOWN : P.body }]}>{tx.type}</Text>
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>{tx.symbol ?? 'Account'}</Text>
        <Text style={styles.rowMeta}>{formatStamp(tx.createdAt)}</Text>
      </View>
      <Text style={styles.rowValue} numberOfLines={1}>{money(tx.amount)}</Text>
    </View>
  );
}

function ActivityList({ query }: { query: { isLoading: boolean; isError: boolean; isSuccess: boolean; data?: { transactions: PaperTransaction[] }; refetch: () => unknown } }) {
  return (
    <>
      {query.isLoading ? <InstrumentRowSkeleton /> : null}
      {query.isError ? <ErrorBanner message="Could not load your transactions." onRetry={() => void query.refetch()} /> : null}
      {query.isSuccess && query.data?.transactions.length === 0 ? <Text style={styles.emptyText}>Your paper trades will appear here.</Text> : null}
      {(query.data?.transactions ?? []).slice(0, 20).map((tx, index, all) => (
        <ActivityRow key={tx.id} tx={tx} last={index === all.length - 1} />
      ))}
    </>
  );
}

const LINE_ICONS = {
  cash: require('@/assets/images/cash-stack.png'),
  btc: require('@/assets/images/btc-coin.png'),
};

function Line({ label, value, color, last, onPress, icon }: { label: string; value: string; color?: string; last?: boolean; onPress?: () => void; icon?: keyof typeof LINE_ICONS }) {
  const content = <>
    <View style={styles.lineStart}>
      {icon ? <Image source={LINE_ICONS[icon]} style={styles.lineIcon} contentFit="contain" accessible={false} /> : null}
      <Text style={styles.lineLabel}>{label}</Text>
    </View>
    <Text style={[styles.lineValue, color ? { color } : null]} numberOfLines={1}>{value}{onPress ? '  ›' : ''}</Text>
  </>;
  return onPress
    ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.line, last && styles.lineLast, pressed && styles.pressed]}>{content}</Pressable>
    : <View style={[styles.line, last && styles.lineLast]}>{content}</View>;
}

function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {count !== undefined ? <Text style={styles.sectionCount}>{count}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pressed: { opacity: 0.55 },
  safe: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  title: { color: P.text, fontSize: 26, lineHeight: 34, letterSpacing: -0.3 },
  iconButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: P.soft, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingBottom: 40 },

  identity: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 18 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: P.soft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { color: P.text, fontSize: 24, fontWeight: '600' },
  identityText: { flex: 1, minWidth: 0 },
  name: { color: P.text, fontSize: 20, fontWeight: '600', letterSpacing: -0.2 },
  handle: { color: P.textSecondary, fontSize: 14, marginTop: 3 },
  editButton: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: P.border, backgroundColor: P.card, justifyContent: 'center' },
  editText: { color: P.text, fontSize: 13, fontWeight: '500' },
  bio: { color: P.body, fontSize: 14, lineHeight: 21, marginTop: 14 },
  community: { flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: P.border },
  communityStat: { flex: 1, alignItems: 'center' },
  communityValue: { color: P.text, fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  communityLabel: { color: P.textSecondary, fontSize: 12, marginTop: 2 },
  communityDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: P.border },

  tabs: { paddingHorizontal: 16, paddingBottom: 16 },
  section: { paddingHorizontal: 16 },
  kicker: { color: P.textMuted, fontSize: 12, letterSpacing: 0.3 },
  equity: { color: P.text, fontSize: 36, fontWeight: '600', letterSpacing: -0.8, marginTop: 4, fontVariant: ['tabular-nums'] },
  equityChange: { fontSize: 15, fontWeight: '500', marginTop: 4, fontVariant: ['tabular-nums'] },
  muted: { color: P.textMuted, fontWeight: '400' },
  note: { color: P.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 10 },
  allocation: { marginTop: 16 },
  list: { marginTop: 12, borderRadius: 14, backgroundColor: P.card, borderWidth: StyleSheet.hairlineWidth, borderColor: P.border, paddingHorizontal: 14 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: P.border },
  lineLast: { borderBottomWidth: 0 },
  lineStart: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  lineIcon: { width: 30, height: 30 },
  lineLabel: { color: P.textSecondary, fontSize: 14 },
  lineValue: { color: P.text, fontSize: 15, fontWeight: '500', fontVariant: ['tabular-nums'], flexShrink: 1 },
  footer: { color: P.textMuted, fontSize: 12, textAlign: 'center', marginTop: 24 },

  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 28, marginBottom: 6 },
  sectionTitle: { color: P.text, fontSize: 17, fontWeight: '600' },
  sectionCount: { color: P.textMuted, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: P.border },
  rowLast: { borderBottomWidth: 0 },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { color: P.text, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: P.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', maxWidth: '45%' },
  rowValue: { color: P.text, fontSize: 15, fontWeight: '500', fontVariant: ['tabular-nums'] },
  rowChange: { fontSize: 12, marginTop: 2, fontVariant: ['tabular-nums'] },
  side: { minWidth: 44, height: 26, borderRadius: 13, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  sideText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  orders: { marginTop: 20 },

  empty: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  emptyTitle: { color: P.text, fontSize: 16, fontWeight: '600' },
  emptyText: { color: P.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 300 },
  emptyButton: { marginTop: 6, minHeight: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: P.text, justifyContent: 'center' },
  emptyButtonText: { color: P.onSolid, fontSize: 13, fontWeight: '600' },
});
