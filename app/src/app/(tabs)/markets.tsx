import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InstrumentRow, type QuoteLike } from '@/components/markets/InstrumentRow';
import { HomeQuoteCard } from '@/components/markets/HomeQuoteCard';
import { SymbolIcon } from '@/components/markets/SymbolIcon';
import { GlassDirectionIcon, GlassIcon, GlassPressable } from '@/components/ui/GlassIcon';
import { WatchlistSection } from '@/components/markets/WatchlistSection';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { InstrumentRowSkeleton } from '@/components/ui/Skeleton';
import { Palette, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { formatPct } from '@/lib/format';
import { groupQuotes } from '@/lib/marketGroups';
import { useLiveMarket } from '@/hooks/use-live-market';
import { useAuth } from '@/store/auth';

type Watchlist = { id: string; name: string; isDefault: boolean };
type WatchlistItem = { id: string; symbol: string; exchange: string; name: string; quote: QuoteLike | null };

const TABS = ['Watchlist', 'Explore', 'Overview'] as const;

export default function MarketsScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Watchlist');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState({ crypto: true, forex: true });
  const [directory, setDirectory] = useState(false);
  const [pageWidth, setPageWidth] = useState(390);
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);

  const listsQuery = useQuery({
    queryKey: ['watchlists'],
    queryFn: () => api<{ watchlists: Watchlist[] }>('/api/watchlists'),
  });
  const activeListId = listsQuery.data?.watchlists[0]?.id;
  const activeListName = listsQuery.data?.watchlists[0]?.name ?? 'Watchlist';

  const itemsQuery = useQuery({
    queryKey: ['watchlist-items', activeListId],
    enabled: Boolean(activeListId),
    queryFn: () =>
      api<{ items: WatchlistItem[]; isDemo: boolean }>(`/api/watchlists/${activeListId}/items`),
    refetchInterval: 60_000,
  });

  const exploreQuery = useQuery({
    queryKey: ['explore'],
    enabled: true,
    queryFn: () =>
      api<{
        constituents: QuoteLike[];
        crypto?: QuoteLike[];
        forex?: QuoteLike[];
        availability?: { crypto: string; forex: string };
        gainers: QuoteLike[];
        losers: QuoteLike[];
        active: QuoteLike[];
        isDemo: boolean;
        marketSessions?: {crypto:string;forex:string};
        statusLabel: string;
      }>('/api/market/explore'),
    refetchInterval: 60_000,
  });

  const overviewQuery = useQuery({
    queryKey: ['overview'],
    enabled: tab === 'Overview',
    queryFn: () =>
      api<{
        marketSessions?: {crypto:string;forex:string};
        statusLabel: string;
        availability?: {crypto:string;forex:string};
        crypto?: QuoteLike[];
        forex?: QuoteLike[];
        sentiment: string;
        volatilityLabel: string;
        news: { id: string; title: string; source: string }[];
        events: { id: string; title: string; date: string }[];
        isDemo: boolean;
      }>('/api/market/overview'),
    refetchInterval: 60_000,
  });

  const searchQuery = useQuery({
    queryKey: ['search', query],
    enabled: searchOpen && query.length >= 1,
    queryFn: () =>
      api<{ results: { symbol: string; exchange: string; name: string; token?: string }[] }>(
        `/api/market/search?q=${encodeURIComponent(query)}`,
      ),
  });

  const addMutation = useMutation({
    mutationFn: (item: { symbol: string; exchange: string; name: string; token?: string }) =>
      api(`/api/watchlists/${activeListId}/items`, { method: 'POST', body: item }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['watchlist-items'] });
      setSearchOpen(false);
      setQuery('');
    },
  });

  const createListMutation = useMutation({
    mutationFn: (name: string) => api('/api/watchlists', { method: 'POST', body: { name } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['watchlists'] }),
  });

  const removeMutation = useMutation({
    mutationFn: (itemId: string) =>
      api(`/api/watchlists/${activeListId}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['watchlist-items'] }),
  });

  const watchlistQuotes = useMemo(
    () =>
      (itemsQuery.data?.items ?? [])
        .map((i) => i.quote)
        .filter((q): q is QuoteLike => Boolean(q)),
    [itemsQuery.data],
  );

  const grouped = useMemo(() => groupQuotes(watchlistQuotes), [watchlistQuotes]);

  const itemIdBySymbol = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of itemsQuery.data?.items ?? []) {
      map.set(`${item.exchange}:${item.symbol}`.toUpperCase(), item.id);
    }
    return map;
  }, [itemsQuery.data]);

  const discovery = [...(exploreQuery.data?.crypto ?? []), ...(exploreQuery.data?.forex ?? [])];
  const feedStatus = useLiveMarket([...(itemsQuery.data?.items ?? []), ...discovery].map(q => `${q.exchange}:${q.symbol}`));

  const isDemo = itemsQuery.data?.isDemo || exploreQuery.data?.isDemo || overviewQuery.data?.isDemo;

  function promptAddList() {
    if (Platform.OS === 'web') {
      const name = window.prompt('New watchlist name', 'My list');
      if (name?.trim()) createListMutation.mutate(name.trim());
      return;
    }
    if (Platform.OS === 'ios') {
      // Alert.prompt is iOS-only
      (Alert as typeof Alert & { prompt: Function }).prompt(
        'New watchlist',
        'Enter a name for this list',
        (name: string) => {
          if (name?.trim()) createListMutation.mutate(name.trim());
        },
        'plain-text',
        'My list',
      );
      return;
    }
    const n = (listsQuery.data?.watchlists.length ?? 0) + 1;
    createListMutation.mutate(`List ${n}`);
  }

  function removeBySymbol(symbol: string) {
    const id = itemIdBySymbol.get(symbol.toUpperCase());
    if (!id) return;
    if (Platform.OS === 'web') {
      if (window.confirm(`Remove ${symbol} from watchlist?`)) removeMutation.mutate(id);
      return;
    }
    Alert.alert('Remove', `Remove ${symbol} from watchlist?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeMutation.mutate(id) },
    ]);
  }

  const avgChange =
    watchlistQuotes.reduce((sum, q) => sum + q.changePercent, 0) / (watchlistQuotes.length || 1);
  const marketsUp = avgChange >= 0;
  const chips = (watchlistQuotes.length ? watchlistQuotes : discovery).slice(0, 4);
  const cardQuotes = [
    ...grouped.crypto,
    ...grouped.forex,
    ...(watchlistQuotes.length ? [] : discovery),
  ].slice(0, 6);
  const cardWidth = Math.min(214, Math.max(156, (pageWidth - 20) / 2));
  const marketHeadline = watchlistQuotes.length
    ? marketsUp ? 'Markets are\nUp Today' : 'Markets are\nDown Today'
    : 'Forex & Crypto\nAt a Glance';

  function openQuote(q: QuoteLike) {
    router.push({
      pathname: '/stock/[symbol]',
      params: { symbol: q.symbol, exchange: q.exchange, name: q.name },
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']} onLayout={(event) => setPageWidth(event.nativeEvent.layout.width)}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <Image
            source={{ uri: 'https://i.pinimg.com/736x/b7/4a/b3/b74ab3b922824a6ccc26837cb6f4498b.jpg' }}
            style={styles.logo}
            contentFit="cover"
            accessibilityLabel="Gurukul icon"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Gurukul home"
            accessibilityHint="Return to the homepage"
            style={({ pressed }) => [styles.brandHome, pressed && { opacity: 0.65 }]}
            onPress={() => setDirectory(false)}>
            <Text style={styles.brandName}>Gurukul</Text>
          </Pressable>
        </View>
        <View style={styles.headerRight}>
          <Pressable accessibilityRole="button" accessibilityLabel="Open portfolio" style={styles.portfolioPill} onPress={() => router.push('/(tabs)/profile')}>
            <Text style={styles.portfolioText}>Portfolio</Text>
          </Pressable>
          <GlassPressable accessibilityRole="button" accessibilityLabel="Open profile" style={styles.avatar} onPress={() => router.push('/(tabs)/profile')}>
            {user?.avatarUrl ? <Image source={{ uri: user.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <GlassIcon name="profile" size={28} />}
          </GlassPressable>
        </View>
      </View>

      <Text style={[styles.cardSymbol, {paddingHorizontal: 18, paddingBottom: 8}]}>{feedStatus}</Text>
      {exploreQuery.data?.availability?.forex && !exploreQuery.data?.forex?.length ? <Text style={[styles.cardSymbol, {paddingHorizontal: 18, paddingBottom: 8}]}>{exploreQuery.data.availability.forex}</Text> : null}
      {(itemsQuery.isError || exploreQuery.isError || overviewQuery.isError) && (
        <ErrorBanner
          message="Could not load market data. Is the API running?"
          onRetry={() => {
            void itemsQuery.refetch();
            void exploreQuery.refetch();
            void overviewQuery.refetch();
          }}
        />
      )}

      {!directory ? (
        <ScrollView contentContainerStyle={styles.homePad} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <Image source={require('@/assets/images/market-glow.svg')} style={StyleSheet.absoluteFill} contentFit="fill" accessible={false} pointerEvents="none" />
            <Text style={styles.heroTitle}>{marketHeadline}</Text>
            {isDemo ? <Text style={styles.heroHint}>Demo · Forex / Crypto</Text> : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {itemsQuery.isLoading
              ? Array.from({ length: 3 }).map((_, i) => <View key={i} style={styles.tickerSkeleton} />)
              : chips.map((q) => {
                  const up = q.changePercent >= 0;
                  return (
                    <GlassPressable accessibilityRole="button" accessibilityLabel={`Open ${q.name}`} key={q.symbol} style={styles.ticker} onPress={() => openQuote(q)}>
                      <SymbolIcon symbol={q.symbol} exchange={q.exchange} size={30} />
                      <View>
                        <Text style={styles.tickerName} numberOfLines={1}>
                          {q.name.split(' ')[0]}
                        </Text>
                        <View style={styles.tickerChange}>
                          <Text style={[styles.tickerPct, { color: up ? Palette.green : Palette.red }]}>
                            {formatPct(q.changePercent)}
                          </Text>
                          <GlassDirectionIcon up={up} size={14} />
                        </View>
                      </View>
                    </GlassPressable>
                  );
                })}
            </ScrollView>
          </View>

          <View style={styles.actions}>
            <GlassPressable accessibilityRole="button" style={styles.action} onPress={() => router.push('/(tabs)/profile')}>
              <Image source={require('@/assets/images/market-glow.svg')} style={StyleSheet.absoluteFill} contentFit="fill" accessible={false} />
              <Text style={styles.actionLabel}>Deposit</Text>
              <GlassIcon name="wallet" size={24} />
            </GlassPressable>
            <GlassPressable accessibilityRole="button" style={styles.action} onPress={() => router.push('/community/compose')}>
              <Image source={require('@/assets/images/market-glow.svg')} style={StyleSheet.absoluteFill} contentFit="fill" accessible={false} />
              <Text style={styles.actionLabel}>Send</Text>
              <GlassIcon name="send" size={24} />
            </GlassPressable>
            <GlassPressable accessibilityRole="button" style={styles.action} onPress={() => setSearchOpen(true)}>
              <Image source={require('@/assets/images/market-glow.svg')} style={StyleSheet.absoluteFill} contentFit="fill" accessible={false} />
              <Text style={styles.actionLabel}>Add pair</Text>
              <GlassIcon name="card" size={24} />
            </GlassPressable>
          </View>

          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{watchlistQuotes.length ? 'Your watchlist' : 'Discover markets'}</Text>
            <GlassPressable accessibilityRole="button" accessibilityLabel="See all watchlist instruments" style={styles.seeAllButton} onPress={() => setDirectory(true)}>
              <Text style={styles.seeAll}>See all</Text>
              <GlassIcon name="add" size={18} />
            </GlassPressable>
          </View>

          {itemsQuery.isLoading ? (
            <InstrumentRowSkeleton />
          ) : cardQuotes.length === 0 ? (
            <EmptyState title="Watchlist is empty" subtitle="Search BTCUSDT, ETHUSDT or EUR/USD to start your watchlist." />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cardScroll} contentContainerStyle={styles.cardRow}>
              {cardQuotes.map((q) => (
                  <HomeQuoteCard key={`${q.exchange}-${q.symbol}`} quote={q} width={cardWidth} onPress={() => openQuote(q)} onRemove={() => removeBySymbol(`${q.exchange}:${q.symbol}`)} />
              ))}
            </ScrollView>
          )}
          <GlassPressable
            accessibilityRole="button"
            accessibilityLabel="Explore markets"
            style={styles.allStocksButton}
            onPress={() => {
              setTab('Explore');
              setDirectory(true);
            }}>
            <Text style={styles.allStocksLabel}>Explore markets</Text>
            <GlassIcon name="up" size={20} rotation={90} />
          </GlassPressable>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.homePad}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{activeListName}</Text>
            <Pressable onPress={() => setDirectory(false)}>
              <Text style={styles.seeAll}>Home</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 4, paddingBottom: 16 }}>
            {TABS.map((t) => (
              <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)} style={[styles.dirTab, tab === t && styles.dirTabOn]}>
                {tab === t && <Image source={require('@/assets/images/market-glow.svg')} style={[StyleSheet.absoluteFill, { opacity: 0.55 }]} contentFit="fill" accessible={false} pointerEvents="none" />}
                <Text style={[styles.dirTabText, tab === t && styles.dirTabTextOn]}>{t}</Text>
              </Pressable>
            ))}
            <GlassPressable style={styles.dirTab} onPress={() => setSearchOpen(true)}>
              <GlassIcon name="add" size={18} /><Text style={styles.dirTabText}>Add</Text>
            </GlassPressable>
            <Pressable style={styles.dirTab} onPress={promptAddList}>
              <Text style={styles.dirTabText}>New list</Text>
            </Pressable>
          </ScrollView>
          {tab === 'Watchlist' && (
            <>
              {(itemsQuery.data?.items ?? []).filter(i => !i.quote).map(i => <Pressable key={i.id} onLongPress={() => removeBySymbol(`${i.exchange}:${i.symbol}`)} onPress={() => router.push({pathname:'/stock/[symbol]',params:{symbol:i.symbol,exchange:i.exchange,name:i.name}})} style={{padding:16}}><Text>{i.symbol} · Quote unavailable</Text></Pressable>)}
              <WatchlistSection title="Crypto" quotes={grouped.crypto} expanded={expanded.crypto} onToggle={() => setExpanded(e => ({...e, crypto: !e.crypto}))} onRemove={removeBySymbol} />
              <WatchlistSection title="Forex" quotes={grouped.forex} expanded={expanded.forex} onToggle={() => setExpanded(e => ({...e, forex: !e.forex}))} onRemove={removeBySymbol} />
            </>
          )}
          {tab === 'Explore' &&
            (exploreQuery.isLoading ? (
              <InstrumentRowSkeleton />
            ) : (
              <>
                <Text style={styles.sectionTitle}>Crypto</Text>
                <Text style={styles.cardSymbol}>{exploreQuery.data?.availability?.crypto}</Text>
                {(exploreQuery.data?.crypto ?? []).map(q => <InstrumentRow key={`${q.exchange}:${q.symbol}`} quote={q} />)}
                <Text style={styles.sectionTitle}>Forex</Text>
                <Text style={styles.cardSymbol}>{exploreQuery.data?.marketSessions?.forex}</Text>
                <Text style={styles.cardSymbol}>{exploreQuery.data?.availability?.forex}</Text>
                {(exploreQuery.data?.forex ?? []).map(q => <InstrumentRow key={`${q.exchange}:${q.symbol}`} quote={q} />)}
              </>
            ))}
          {tab === 'Overview' && overviewQuery.data && (
            <View style={styles.overviewCard}>
              <Text style={styles.cardName}>{overviewQuery.data.statusLabel}</Text>
              <Text style={styles.cardSymbol}>{overviewQuery.data.marketSessions?.forex}</Text>
              <Text style={styles.cardSymbol}>{overviewQuery.data.availability?.crypto} · {overviewQuery.data.availability?.forex}</Text>
              {[...(overviewQuery.data.crypto ?? []), ...(overviewQuery.data.forex ?? [])].map(q => <InstrumentRow key={`${q.exchange}:${q.symbol}`} quote={q} />)}
              <Text style={styles.cardSymbol}>
                {overviewQuery.data.sentiment} · {overviewQuery.data.volatilityLabel}
              </Text>
              {(overviewQuery.data.news ?? []).map((n) => (
                <Text key={n.id} style={styles.news}>
                  {n.title}
                </Text>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <Modal visible={searchOpen} animationType="slide" onRequestClose={() => setSearchOpen(false)}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.searchHeader}>
            <TextInput
              autoFocus
              style={styles.searchInput}
              placeholder="Search crypto / forex pairs"
              placeholderTextColor={Palette.textMuted}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="characters"
            />
            <Pressable onPress={() => setSearchOpen(false)}>
              <Text style={styles.cancel}>Close</Text>
            </Pressable>
          </View>
          <FlatList
            data={searchQuery.data?.results ?? []}
            keyExtractor={(item) => `${item.exchange}-${item.symbol}`}
            renderItem={({ item }) => (
              <Pressable
                style={styles.searchRow}
                onPress={() =>
                  addMutation.mutate({
                    symbol: item.symbol,
                    exchange: item.exchange,
                    name: item.name,
                    token: item.token,
                  })
                }>
                <Text style={styles.cardName}>{item.symbol}</Text>
                <Text style={styles.cardSymbol}>{item.name}</Text>
              </Pressable>
            )}
            ListEmptyComponent={<EmptyState title="Search symbols" subtitle="Try BTCUSDT, ETHUSDT, EUR/USD" />}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafb', width: '100%', maxWidth: 480, alignSelf: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logo: { width: 36, height: 36, borderRadius: 9, backgroundColor: '#fff' },
  brandName: { color: '#101217', fontSize: 17, fontWeight: '600', letterSpacing: -0.5 },
  brandHome: { minHeight: 44, justifyContent: 'center' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  portfolioPill: {
    borderWidth: 1, borderColor: '#7699db', backgroundColor: '#fff',
    borderRadius: 20, paddingHorizontal: 16, minHeight: 36, justifyContent: 'center',
  },
  portfolioText: { color: '#13161a', fontWeight: '500', fontSize: 11 },
  avatar: {
    width: 36, height: 36, borderRadius: 18, overflow: 'hidden',
    backgroundColor: '#dae4fb', alignItems: 'center', justifyContent: 'center',
  },
  homePad: { paddingHorizontal: 18, paddingBottom: 28 },
  hero: {
    minHeight: 186, backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: '#e9e9f0', paddingTop: 22,
  },
  heroTitle: { color: '#08090c', fontSize: 34, fontWeight: '600', lineHeight: 35, letterSpacing: -1.8, paddingHorizontal: 20 },
  heroHint: { color: '#5e687b', position: 'absolute', top: 12, right: 12, fontSize: 9 },
  chipRow: { gap: 10, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 18 },
  ticker: {
    flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#fff',
    borderRadius: 14, paddingHorizontal: 9, paddingVertical: 7,
    boxShadow: '0 4px 10px rgba(17, 37, 73, 0.06)',
  },
  tickerSkeleton: { width: 112, height: 44, borderRadius: 14, backgroundColor: '#f5f4f9' },
  tickerName: { color: '#111216', fontWeight: '500', fontSize: 12, maxWidth: 80 },
  tickerChange: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  tickerPct: { fontWeight: '500', fontSize: 10 },
  actions: { flexDirection: 'row', gap: 9, marginTop: 26, marginBottom: 6 },
  action: {
    flex: 1, backgroundColor: '#fff', overflow: 'hidden', borderWidth: 1, borderColor: '#e9e9f0',
    borderRadius: 6, minHeight: 38, paddingVertical: 8, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center', gap: 5,
  },
  actionLabel: { color: '#10121a', fontWeight: '400', fontSize: 13 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 22, marginBottom: 16 },
  sectionTitle: { color: '#101217', fontSize: 20, fontWeight: '600', letterSpacing: -0.7 },
  seeAllButton: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: '#dfe2e9', borderRadius: 7, paddingHorizontal: 10, minHeight: 30 },
  seeAll: { color: '#25262d', fontSize: 11, fontWeight: '400' },
  allStocksButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 16, minHeight: 48, paddingHorizontal: 16, paddingVertical: 12,
    borderWidth: 1, borderColor: '#dfe2e9', borderRadius: 12, backgroundColor: '#fff',
  },
  allStocksLabel: { color: '#25262d', fontSize: 14, fontWeight: '500' },
  cardScroll: { marginHorizontal: -18 },
  cardRow: { flexDirection: 'row', gap: 16, paddingHorizontal: 18, paddingBottom: 10 },
  cardName: { color: Palette.text, fontWeight: '600', fontSize: 16 },
  cardSymbol: { color: '#777d87', fontSize: 12, marginTop: 2 },
  dirTab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#EEEFF4', overflow: 'hidden', minHeight: 42,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  dirTabOn: { backgroundColor: '#fff', borderColor: '#C7D5F6', boxShadow: '0 3px 9px rgba(68,101,177,0.10)' },
  dirTabText: { color: '#7e8794', fontSize: 13, fontWeight: '500' },
  dirTabTextOn: { color: '#4B62A4', fontWeight: '600' },
  overviewCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    gap: 8,
  },
  news: { color: Palette.textSecondary, fontSize: 14, lineHeight: 20 },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: Spacing.three,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Palette.text,
  },
  cancel: { color: Palette.accent, fontWeight: '700' },
  searchRow: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.border,
  },
});

