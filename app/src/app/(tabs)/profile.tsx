import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InstrumentRowSkeleton } from '@/components/ui/Skeleton';
import { PortfolioDonut } from '@/components/charts/PortfolioDonut';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { GlassIcon, GlassPressable, type GlassIconName } from '@/components/ui/GlassIcon';
import { ProfileSettings } from '@/components/profile/ProfileSettings';
import { SymbolIcon } from '@/components/markets/SymbolIcon';
import { Palette } from '@/constants/theme';
import { api } from '@/lib/api';
import { formatInr, formatPct } from '@/lib/format';
import { useAuth, type User } from '@/store/auth';

const TABS = ['Overview', 'Portfolio', 'Settings'] as const;
const TAB_ICONS: Record<(typeof TABS)[number], GlassIconName> = { Overview: 'analytics', Portfolio: 'wallet', Settings: 'profile' };

type Overview = {
  user: User;
  portfolio: {
    equity: number;
    cashBalance: number;
    invested: number;
    unrealizedPnl: number;
    realizedPnl: number;
    totalPnl: number;
    totalPnlPercent: number;
    startingBalance: number;
    positions: {
      id: string;
      symbol: string;
      name: string;
      exchange: string;
      quantity: number;
      avgPrice: number;
      ltp: number;
      marketValue: number;
      unrealizedPnl: number;
      unrealizedPnlPercent: number;
    }[];
  };
  community: { posts: number; followers: number; following: number };
};

export default function ProfileScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const [refreshing, setRefreshing] = useState(false);
  const clearSession = useAuth((s) => s.clearSession);
  const updateUser = useAuth((s) => s.updateUser);
  const sessionUser = useAuth((s) => s.user);
  const qc = useQueryClient();

  const overviewQuery = useQuery({
    queryKey: ['profile-overview', sessionUser?.id],
    queryFn: ({ signal }) => api<Overview>('/api/users/me/overview', { signal }),
    enabled: Boolean(sessionUser),
    refetchInterval: 15_000,
  });

  const txQuery = useQuery({
    queryKey: ['transactions', sessionUser?.id],
    enabled: tab === 'Portfolio' && Boolean(sessionUser),
    refetchInterval: tab === 'Portfolio' ? 15_000 : false,
    queryFn: ({ signal }) =>
      api<{
        transactions: {
          id: string;
          type: string;
          symbol: string | null;
          quantity: number | null;
          price: number | null;
          amount: number;
          realizedPnl: number | null;
          createdAt: string;
        }[];
      }>('/api/trading/transactions', { signal }),
  });

  const data = overviewQuery.data;
  const profileUser = data?.user ?? sessionUser;
  const pnlColor = (data?.portfolio.totalPnl ?? 0) >= 0 ? Palette.green : Palette.red;

  function selectTab(next: (typeof TABS)[number]) {
    setTab(next);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  function onUserSaved(user: User) {
    updateUser(user);
    void qc.cancelQueries({ queryKey: ['profile-overview', user.id] }).then(() => {
      qc.setQueryData<Overview>(['profile-overview', user.id], current => current ? { ...current, user } : current);
    });
  }

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([overviewQuery.refetch(), ...(tab === 'Portfolio' ? [txQuery.refetch()] : [])]);
    } finally { setRefreshing(false); }
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST', body: { refreshToken: useAuth.getState().refreshToken ?? undefined } });
    } catch {
      // ignore
    }
    await qc.cancelQueries();
    await clearSession();
    qc.clear();
    router.replace('/(auth)/login');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerBrand}><GlassIcon name="profile" size={30} tone="purple" /><Text style={styles.title}>My profile</Text></View>
        <GlassPressable accessibilityRole="button" accessibilityLabel="Refresh profile and portfolio" accessibilityState={{ disabled: refreshing }} disabled={refreshing} style={({ pressed }) => [styles.refreshButton, pressed && { opacity: 0.6 }]} onPress={() => void refresh()}>
          {refreshing ? <ActivityIndicator color="#7657BA" size="small" /> : <GlassIcon name="analytics" size={21} tone="purple" />}
          <Text style={styles.refreshText}>Refresh</Text>
        </GlassPressable>
      </View>

      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={Platform.OS !== 'web'}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor="#7657BA" colors={['#7657BA']} />}>
        {overviewQuery.isError ? <ErrorBanner message={data ? 'Could not refresh your portfolio. Showing the last loaded values.' : 'Your portfolio is temporarily unavailable.'} onRetry={() => void overviewQuery.refetch()} /> : null}
        {tab === 'Overview' && profileUser ? (
          <View style={styles.profileSummary}>
            <Image source={require('@/assets/images/profile-blue-glow.svg')} style={styles.profileGlow} contentFit="fill" accessible={false} pointerEvents="none" />
            <View style={styles.summaryTop}>
              <Text style={styles.eyebrow}>YOUR PROFILE</Text>
              <GlassPressable accessibilityRole="button" accessibilityLabel="Edit profile" style={styles.editButton} onPress={() => selectTab('Settings')}><Text style={styles.editText}>Edit profile</Text><GlassIcon name="profile" size={18} tone="blue" /></GlassPressable>
            </View>
            <View style={styles.profileCard}>
              <View style={styles.avatar}>
                {profileUser.avatarUrl ? <Image source={{ uri: profileUser.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <GlassIcon name="profile" size={44} tone="blue" />}
              </View>
              <View style={styles.profileIdentity}>
                <Text style={styles.name}>{profileUser.displayName ?? profileUser.username}</Text>
                <Text style={styles.profileMeta}>@{profileUser.username}</Text>
              </View>
            </View>
            {profileUser.bio ? <Text style={styles.bio}>{profileUser.bio}</Text> : null}
            {data ? <View style={styles.statsRow}>
              <Stat icon="send" tone="orange" label="Posts" value={String(data.community.posts)} />
              <Stat icon="community" tone="blue" label="Followers" value={String(data.community.followers)} />
              <Stat icon="profile" tone="blue" label="Following" value={String(data.community.following)} />
            </View> : null}
            <Text style={styles.joined}>Member since {new Date(profileUser.createdAt).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</Text>
          </View>
        ) : tab !== 'Overview' ? <View style={styles.pageHeading}><Text style={styles.pageTitle}>{tab === 'Portfolio' ? 'Your holdings' : 'Account settings'}</Text><Text style={styles.pageSubtitle}>{tab === 'Portfolio' ? 'Positions, balances and activity' : 'Your profile, preferences and security'}</Text></View> : null}

        <View style={styles.tabs} accessibilityRole="tablist">
          {TABS.map(item => <GlassPressable key={item} accessibilityRole="tab" accessibilityState={{ selected: tab === item }} onPress={() => selectTab(item)} style={[styles.tab, tab === item && styles.tabSelected]}><GlassIcon name={TAB_ICONS[item]} size={20} tone={tab === item ? 'purple' : undefined} /><Text style={[styles.tabText, tab === item && styles.tabTextSelected]}>{item}</Text></GlassPressable>)}
        </View>

        {overviewQuery.isLoading && tab === 'Portfolio' && <View style={{ padding: 16 }}><InstrumentRowSkeleton /></View>}

        {tab === 'Overview' ? (
          <View style={styles.hero}>
            <View style={styles.heroHeading}>
              <Text style={styles.heroTitle}>Portfolio overview</Text>
              <View style={styles.paperTag}><View style={styles.paperDot} /><Text style={styles.paperText}>Paper trading</Text></View>
            </View>
            <Text style={styles.heroSubtitle}>Your virtual investments, at a glance.</Text>
            <PortfolioDonut portfolio={data?.portfolio} loading={overviewQuery.isLoading} />
            <View style={styles.returnCard}>
              <View style={styles.returnLeft}>
                <View style={styles.inline}><GlassIcon name="coin" size={19} /><Text style={styles.returnLabel}>Total profit / loss</Text></View>
                <Text style={[styles.returnValue, data ? { color: pnlColor } : null]}>{data ? formatInr(data.portfolio.totalPnl) : '—'}</Text>
              </View>
              <View style={styles.returnRight}>
                <Text style={styles.returnLabel}>All-time return</Text>
                <Text style={[styles.returnPercent, data ? { color: pnlColor } : null]}>{data ? formatPct(data.portfolio.totalPnlPercent) : '—'}</Text>
              </View>
            </View>
          </View>
        ) : null}
        {tab === 'Overview' ? (
          <View style={styles.block}>
            <Text style={styles.quickHeading}>Quick access</Text>
            <View style={styles.quickActions}>
              <GlassPressable accessibilityRole="button" style={styles.quickAction} onPress={() => selectTab('Portfolio')}><GlassIcon name="wallet" size={32} tone="purple" /><Text style={styles.quickTitle}>My holdings</Text><Text style={styles.quickCaption}>Positions & activity</Text></GlassPressable>
              <GlassPressable accessibilityRole="button" style={styles.quickAction} onPress={() => router.push('/(tabs)/community')}><GlassIcon name="community" size={32} tone="purple" /><Text style={styles.quickTitle}>Community</Text><Text style={styles.quickCaption}>Ideas & discussions</Text></GlassPressable>
            </View>
          </View>
        ) : null}

        {tab === 'Portfolio' && data && (
          <View style={styles.block}>
            <View style={styles.card}>
              <View style={styles.inline}><GlassIcon name="wallet" size={25} /><Text style={styles.cardLabel}>Virtual portfolio</Text></View>
              <Text style={styles.equity}>{formatInr(data.portfolio.equity)}</Text>
              <Text style={[styles.pnl, { color: pnlColor }]}>
                {formatInr(data.portfolio.totalPnl)} ({formatPct(data.portfolio.totalPnlPercent)})
              </Text>
              <View style={styles.grid}>
                <Mini icon="wallet" label="Cash" value={formatInr(data.portfolio.cashBalance, 0)} />
                <Mini icon="chart" label="Invested" value={formatInr(data.portfolio.invested, 0)} />
                <Mini icon="analytics" label="Unrealized" value={formatInr(data.portfolio.unrealizedPnl, 0)} />
                <Mini icon="coin" label="Realized" value={formatInr(data.portfolio.realizedPnl, 0)} />
              </View>
            </View>

            <SectionHeading icon="chart" title="Open positions" detail={String(data.portfolio.positions.length)} />
            {data.portfolio.positions.length === 0 ? (
              <View style={styles.emptyCard}>
                <GlassIcon name="chart" size={42} /><Text style={styles.emptyTitle}>Your first investment starts here</Text>
                <Text style={styles.empty}>Explore a stock and place a paper trade to build your portfolio.</Text>
                <GlassPressable accessibilityRole="button" style={styles.exploreButton} onPress={() => router.push('/(tabs)/markets')}><Text style={styles.exploreText}>Explore markets</Text><GlassIcon name="up" size={22} rotation={90} /></GlassPressable>
              </View>
            ) : (
              data.portfolio.positions.map((p) => (
                <GlassPressable
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${p.name}, market value ${formatInr(p.marketValue)}`}
                  style={styles.pos}
                  onPress={() =>
                    router.push({ pathname: '/instrument/[symbol]', params: { symbol: p.symbol, exchange: p.exchange, name: p.name } })
                  }>
                  <SymbolIcon symbol={p.symbol} exchange={p.exchange} size={36} />
                  <View style={styles.positionName}>
                    <Text style={styles.symbol}>{p.symbol}</Text>
                    <Text style={styles.meta}>
                      {p.quantity} @ {p.avgPrice.toFixed(2)} · LTP {p.ltp.toFixed(2)}
                    </Text>
                  </View>
                  <View style={styles.positionValue}>
                    <Text style={styles.symbol} numberOfLines={1} adjustsFontSizeToFit>{formatInr(p.marketValue, 0)}</Text>
                    <Text style={[styles.positionPnl, { color: p.unrealizedPnl >= 0 ? Palette.green : Palette.red }]}>
                      {formatInr(p.unrealizedPnl)}
                    </Text>
                    <Text style={[styles.positionPnl, { color: p.unrealizedPnl >= 0 ? Palette.green : Palette.red }]}>
                      {formatPct(p.unrealizedPnlPercent)}
                    </Text>
                  </View>
                </GlassPressable>
              ))
            )}

          </View>
        )}

        {tab === 'Portfolio' && (
          <View style={styles.block}>
            <SectionHeading icon="card" title="Recent activity" />
            {txQuery.isLoading ? <InstrumentRowSkeleton /> : null}
            {txQuery.isError ? <ErrorBanner message="Could not refresh your transactions." onRetry={() => void txQuery.refetch()} /> : null}
            {txQuery.isSuccess && txQuery.data.transactions.length === 0 ? <View style={styles.emptyCard}><GlassIcon name="card" size={38} /><Text style={styles.emptyTitle}>No transactions yet</Text><Text style={styles.empty}>Your paper trades will appear here.</Text></View> : null}
            {(txQuery.data?.transactions ?? []).slice(0, 20).map((t) => (
              <View key={t.id} style={styles.pos}>
                <View style={styles.activityIcon}><GlassIcon name={t.type === 'BUY' ? 'down' : t.type === 'SELL' ? 'up' : 'coin'} size={28} /></View>
                <View style={styles.positionName}>
                  <Text style={styles.symbol}>
                    {t.type} {t.symbol ?? ''}
                  </Text>
                  <Text style={styles.meta}>{t.createdAt.slice(0, 19).replace('T', ' ')}</Text>
                </View>
                <Text style={[styles.symbol, styles.activityAmount]} numberOfLines={1} adjustsFontSizeToFit>{formatInr(t.amount, 0)}</Text>
              </View>
            ))}
          </View>
        )}

        {tab === 'Settings' && profileUser && (
          <ProfileSettings key={profileUser.id} user={profileUser} onUserSaved={onUserSaved} onLogout={logout} />
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SectionHeading({ icon, title, detail }: { icon: GlassIconName; title: string; detail?: string }) {
  return <View style={styles.sectionHeading}><GlassIcon name={icon} size={24} /><Text style={styles.sectionTitle}>{title}</Text>{detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}</View>;
}

function Stat({ icon, tone, label, value }: { icon: GlassIconName; tone: 'orange' | 'blue'; label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <GlassIcon name={icon} size={20} tone={tone} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.profileStatLabel}>{label}</Text>
    </View>
  );
}

function Mini({ icon, label, value }: { icon: GlassIconName; label: string; value: string }) {
  return (
    <View style={styles.mini}>
      <View style={styles.inline}><GlassIcon name={icon} size={22} /><Text style={styles.statLabel}>{label}</Text></View>
      <Text style={styles.miniValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  safe: { flex: 1, backgroundColor: '#F8F9FD' },
  header: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerBrand: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: '#211B30', fontSize: 22, fontWeight: '600', letterSpacing: -0.5 },
  refreshButton: { minHeight: 44, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E8E1F2', flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  refreshText: { color: '#6E579C', fontSize: 12, fontWeight: '500' },
  scrollContent: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingBottom: 32 },
  profileSummary: { marginHorizontal: 20, marginBottom: 22, padding: 20, borderRadius: 24, backgroundColor: '#F6FAFF', borderWidth: 1, borderColor: '#DAE8F6', overflow: 'hidden', boxShadow: '0 5px 20px rgba(46,102,163,0.06)' },
  profileGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 170, opacity: 0.28 },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 16 },
  eyebrow: { color: '#6382A1', fontSize: 10, letterSpacing: 1.8, fontWeight: '600' },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  profileIdentity: { flex: 1, minWidth: 0 },
  avatar: { width: 72, height: 72, borderRadius: 24, backgroundColor: '#E5F0FC', borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  name: { color: '#203F60', fontSize: 24, fontWeight: '600', letterSpacing: -0.6 },
  profileMeta: { color: '#6684A1', fontSize: 13, marginTop: 5 },
  editButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, minHeight: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.85)', borderWidth: 1, borderColor: '#C8DDF2' },
  editText: { color: '#3978B8', fontSize: 12, fontWeight: '500' },
  bio: { color: '#5C7690', fontSize: 14, lineHeight: 22, marginTop: 18 },
  joined: { color: '#7791AA', fontSize: 11, marginTop: 18, textAlign: 'center' },
  statsRow: { flexDirection: 'row', gap: 8, borderTopWidth: 1, borderTopColor: '#DDEAF7', marginTop: 20, paddingTop: 16 },
  stat: { flex: 1, alignItems: 'center', gap: 5 },
  statLabel: { color: '#82758F', fontSize: 12, fontWeight: '400' },
  profileStatLabel: { color: '#6684A1', fontSize: 12, fontWeight: '400' },
  statValue: { color: '#284D70', fontSize: 21, fontWeight: '600', fontVariant: ['tabular-nums'] },
  tabs: { marginHorizontal: 20, marginBottom: 20, flexDirection: 'row', padding: 4, backgroundColor: '#F0EDF6', borderWidth: 1, borderColor: '#EAE5F2', borderRadius: 16 },
  tab: { flex: 1, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: 12 },
  tabSelected: { backgroundColor: '#fff', boxShadow: '0 2px 8px rgba(83,62,125,0.08)' },
  tabText: { color: '#82758F', fontSize: 12, fontWeight: '500' },
  tabTextSelected: { color: '#6E579C', fontWeight: '600' },
  hero: { marginHorizontal: 20, padding: 18, paddingBottom: 18, backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderColor: '#EAE5F2' },
  heroHeading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  heroTitle: { color: '#352C45', fontSize: 18, fontWeight: '600', letterSpacing: -0.3 },
  heroSubtitle: { color: '#82758F', fontSize: 12, lineHeight: 18, marginTop: 8 },
  paperTag: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 9, backgroundColor: '#F6F2FC' },
  paperDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#A18BC7' },
  paperText: { color: '#82718F', fontSize: 10 },
  returnCard: { backgroundColor: '#FAF8FE', borderWidth: 1, borderColor: '#EEE8F6', borderRadius: 16, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', padding: 14, gap: 14, marginTop: 16 },
  returnLeft: { flexGrow: 1, minWidth: 130 },
  returnLabel: { color: '#82758F', fontSize: 11 },
  returnValue: { color: '#352C45', fontSize: 23, fontWeight: '600', marginTop: 7, letterSpacing: -0.5 },
  returnRight: { alignItems: 'flex-start', justifyContent: 'center', minWidth: 100 },
  returnPercent: { color: '#352C45', fontSize: 19, fontWeight: '600', marginTop: 7 },
  pageHeading: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 24 },
  pageTitle: { color: '#352C45', fontSize: 28, fontWeight: '600', letterSpacing: -0.8 },
  pageSubtitle: { color: '#82758F', fontSize: 13, marginTop: 7 },
  block: { paddingHorizontal: 20 },
  quickHeading: { color: '#514363', fontSize: 16, fontWeight: '600', marginTop: 24, marginBottom: 12 },
  quickActions: { flexDirection: 'row', gap: 12 },
  quickAction: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EAE5F2', borderRadius: 18, padding: 16, gap: 8 },
  quickTitle: { color: '#352C45', fontSize: 14, fontWeight: '600', marginTop: 4 },
  quickCaption: { color: '#82758F', fontSize: 12, lineHeight: 18 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24, marginBottom: 12 },
  sectionTitle: { color: '#514363', fontSize: 16, fontWeight: '600', flex: 1 },
  sectionDetail: { color: '#7657BA', fontSize: 12, backgroundColor: '#F1ECFC', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  meta: { color: '#82758F', fontSize: 11, lineHeight: 17, marginTop: 4 },
  card: { backgroundColor: '#fff', borderRadius: 22, padding: 20, borderWidth: 1, borderColor: '#EAE5F2', marginTop: 4 },
  cardLabel: { color: '#82758F', fontSize: 13 },
  equity: { color: '#352C45', fontSize: 32, fontWeight: '600', marginTop: 14, letterSpacing: -0.7 },
  pnl: { fontWeight: '500', fontSize: 14, marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 20 },
  mini: { flexBasis: '46%', flexGrow: 1, backgroundColor: '#FAF8FE', borderRadius: 14, padding: 12 },
  miniValue: { color: '#352C45', fontSize: 16, fontWeight: '600', marginTop: 8 },
  emptyCard: { backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#EAE5F2', padding: 24, alignItems: 'center', gap: 12 },
  emptyTitle: { color: '#514363', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  empty: { color: '#82758F', fontSize: 13, lineHeight: 20, textAlign: 'center' },
  exploreButton: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#DFD5F4', borderRadius: 12, paddingHorizontal: 16, minHeight: 44, marginTop: 4 },
  exploreText: { color: '#7657BA', fontSize: 13, fontWeight: '600' },
  pos: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EAE5F2', borderRadius: 16, marginBottom: 10 },
  positionName: { flex: 1, minWidth: 0 },
  positionValue: { alignItems: 'flex-end', maxWidth: '40%' },
  positionPnl: { fontSize: 11, marginTop: 4, fontWeight: '500' },
  activityIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#F6F2FC', alignItems: 'center', justifyContent: 'center' },
  activityAmount: { maxWidth: '35%' },
  symbol: { color: '#352C45', fontSize: 14, fontWeight: '600' },
});
