import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppTopBar } from '@/components/navigation/AppTopBar';

import { InstrumentRow, type QuoteLike } from '@/components/markets/InstrumentRow';
import { HomeQuoteCard } from '@/components/markets/HomeQuoteCard';
import { HomeNews } from '@/components/markets/HomeNews';
import { WelcomeGift } from '@/components/markets/WelcomeGift';
import { GlassIcon, GlassPressable, type GlassIconName } from '@/components/ui/GlassIcon';
import SpecularButton from '@/components/ui/SpecularButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { InstrumentRowSkeleton } from '@/components/ui/Skeleton';
import { Palette, Spacing } from '@/constants/theme';
import { formatPct } from '@/lib/format';
import { marketAssets } from '@/lib/marketAssets';
import { fetchTickerList, searchPairs } from '@/lib/marketData';
import { useLiveMarket } from '@/hooks/use-live-market';

const HERO_COINS: Record<string, number> = {
  BTC: require('@/assets/images/hero-btc.png'),
  ETH: require('@/assets/images/hero-eth.png'),
  BNB: require('@/assets/images/hero-bnb.png'),
  SOL: require('@/assets/images/hero-sol.png'),
  USDT: require('@/assets/images/hero-usdt.png'),
};

// Watchlists have no backend yet, so Home shows live discovery lists from Binance instead.
const TABS = ['Most active', 'Gainers', 'Losers'] as const;
const SORT = { 'Most active': 'volume', Gainers: 'gainers', Losers: 'losers' } as const;

function openQuote(q: { symbol: string; exchange: string; name: string }) {
  router.push({
    pathname: '/stock/[symbol]',
    params: { symbol: q.symbol, exchange: q.exchange, name: q.name },
  });
}

export default function MarketsScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Most active');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [directory, setDirectory] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(true);
  const [pageWidth, setPageWidth] = useState(390);

  const exploreQuery = useQuery({
    queryKey: ['explore', 'volume'],
    queryFn: ({ signal }) => fetchTickerList('volume', 30, signal),
    refetchInterval: 60_000,
  });
  const listQuery = useQuery({
    queryKey: ['explore', SORT[tab]],
    enabled: directory,
    queryFn: ({ signal }) => fetchTickerList(SORT[tab], 30, signal),
    refetchInterval: 60_000,
  });
  const searchQuery = useQuery({
    queryKey: ['search', query],
    enabled: searchOpen && query.trim().length >= 1,
    queryFn: ({ signal }) => searchPairs(query, signal),
  });

  const discovery = exploreQuery.data?.crypto ?? [];
  const listed = directory ? listQuery.data?.crypto ?? [] : [];
  const feedStatus = useLiveMarket([...discovery, ...listed].map(q => `${q.exchange}:${q.symbol}`));

  const avgChange = discovery.slice(0, 10).reduce((sum, q) => sum + q.changePercent, 0) / (Math.min(discovery.length, 10) || 1);
  const marketsUp = avgChange >= 0;
  const chips = discovery.slice(0, 3);
  const cardQuotes = discovery.slice(0, 6);
  const cardWidth = Math.min(214, Math.max(156, (pageWidth - 20) / 2));
  const marketHeadline = discovery.length
    ? marketsUp ? 'Crypto is\nup today' : 'Crypto is\ndown today'
    : 'Crypto,\nat a glance';
  const pillLabel = (q: QuoteLike) => marketAssets(q.symbol, q.exchange)?.[0] ?? q.symbol;
  const shortcuts: { label: string; icon?: GlassIconName; art?: number; onPress: () => void }[] = [
    { label: 'Search', icon: 'add', onPress: () => setSearchOpen(true) },
    { label: 'Markets', art: require('@/assets/images/home-markets.png'), onPress: () => router.push('/(tabs)/market') },
    { label: 'Portfolio', art: require('@/assets/images/home-portfolio.png'), onPress: () => router.push('/(tabs)/profile') },
    { label: 'AI Insight', art: require('@/assets/images/home-ai.png'), onPress: () => router.push('/(tabs)/ai') },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']} onLayout={(event) => setPageWidth(event.nativeEvent.layout.width)}>
      <AppTopBar onBrandPress={() => setDirectory(false)} />

      <Text style={[styles.cardSymbol, {paddingHorizontal: 18, paddingBottom: 8}]}>{feedStatus}</Text>
      {(exploreQuery.isError || listQuery.isError) && (
        <ErrorBanner
          message="Could not load market data. Is the API running?"
          onRetry={() => {
            void exploreQuery.refetch();
            if (directory) void listQuery.refetch();
          }}
        />
      )}

      {!directory ? (
        <ScrollView contentContainerStyle={styles.homePad} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={styles.heroCopy}>
                <Text style={styles.heroTitle} accessibilityRole="header">{marketHeadline}</Text>
                <Text style={styles.heroSubtitle}>
                  {discovery.length ? (
                    <>The 10 most active pairs average <Text style={[styles.heroHighlight, { color: marketsUp ? Palette.green : Palette.red }]}>{formatPct(avgChange)}</Text></>
                  ) : (
                    <>Live prices for <Text style={styles.heroHighlight}>crypto</Text></>
                  )}
                </Text>
              </View>
              <Image
                source={require('@/assets/images/home-insight.png')}
                style={styles.heroArt}
                contentFit="contain"
                accessible={false}
                pointerEvents="none"
              />
            </View>
            <View style={styles.heroPills}>
              {exploreQuery.isLoading
                ? Array.from({ length: 3 }).map((_, i) => <View key={i} style={styles.pillSkeleton} />)
                : chips.map((q) => {
                    const label = pillLabel(q);
                    const coin = HERO_COINS[label];
                    return (
                    <Pressable
                      key={`${q.exchange}:${q.symbol}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${q.name}, ${formatPct(q.changePercent)}`}
                      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
                      onPress={() => openQuote(q)}>
                      {coin ? (
                        <Image source={coin} style={styles.pillCoin} contentFit="contain" accessible={false} />
                      ) : null}
                      <Text style={styles.pillSymbol} numberOfLines={1}>{label}</Text>
                      <Text style={[styles.pillChange, { color: q.changePercent >= 0 ? Palette.green : Palette.red }]} numberOfLines={1}>
                        {formatPct(q.changePercent)}
                      </Text>
                    </Pressable>
                    );
                  })}
            </View>
            <SpecularButton
              size="lg"
              radius={28}
              tint="#0066FF"
              tintOpacity={0.06}
              textColor="#16181D"
              lineColor="#0066FF"
              baseColor="#C9CEDB"
              intensity={1}
              idleIntensity={0.35}
              shineSize={10}
              shineFade={34}
              thickness={1.2}
              glow={1}
              followMouse
              proximity={250}
              accessibilityRole="button"
              accessibilityLabel="Explore markets"
              onClick={() => router.push('/(tabs)/market')}
              onPress={() => router.push('/(tabs)/market')}
              style={styles.heroCta}>
              Explore markets
            </SpecularButton>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.shortcutScroll} contentContainerStyle={styles.shortcuts}>
            {shortcuts.map(item => (
              <GlassPressable key={item.label} accessibilityRole="button" accessibilityLabel={item.label} style={styles.shortcut} onPress={item.onPress}>
                <View style={styles.shortcutArt}>
                  {item.art ? (
                    <Image source={item.art} style={styles.shortcutImage} contentFit="contain" accessible={false} />
                  ) : item.icon ? (
                    <GlassIcon name={item.icon} size={32} />
                  ) : null}
                </View>
                <Text style={styles.shortcutLabel} numberOfLines={2}>{item.label}</Text>
              </GlassPressable>
            ))}
          </ScrollView>

          <HomeNews />

          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Discover markets</Text>
            <GlassPressable accessibilityRole="button" accessibilityLabel="See all markets" style={styles.seeAllButton} onPress={() => setDirectory(true)}>
              <Text style={styles.seeAll}>See all</Text>
              <GlassIcon name="add" size={18} />
            </GlassPressable>
          </View>

          {exploreQuery.isLoading ? (
            <InstrumentRowSkeleton />
          ) : cardQuotes.length === 0 ? (
            <EmptyState title="No prices yet" subtitle="Market data appears once the server reaches Binance." />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cardScroll} contentContainerStyle={styles.cardRow}>
              {cardQuotes.map((q) => (
                <HomeQuoteCard key={`${q.exchange}-${q.symbol}`} quote={q} width={cardWidth} onPress={openQuote} />
              ))}
            </ScrollView>
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.homePad}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Markets</Text>
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
              <GlassIcon name="add" size={18} /><Text style={styles.dirTabText}>Search</Text>
            </GlassPressable>
          </ScrollView>
          {listQuery.isLoading ? <InstrumentRowSkeleton /> : listed.map(q => <InstrumentRow key={`${q.exchange}:${q.symbol}`} quote={q} />)}
        </ScrollView>
      )}

      <WelcomeGift visible={welcomeOpen} onClose={() => setWelcomeOpen(false)} />

      <Modal visible={searchOpen} animationType="slide" onRequestClose={() => setSearchOpen(false)}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.searchHeader}>
            <TextInput
              autoFocus
              accessibilityLabel="Search crypto pairs"
              style={styles.searchInput}
              placeholder="Search crypto pairs"
              placeholderTextColor={Palette.textMuted}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Pressable onPress={() => setSearchOpen(false)}>
              <Text style={styles.cancel}>Close</Text>
            </Pressable>
          </View>
          <FlatList
            data={searchQuery.data ?? []}
            keyExtractor={(item) => `${item.exchange}-${item.symbol}`}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                style={styles.searchRow}
                onPress={() => { setSearchOpen(false); setQuery(''); openQuote(item); }}>
                <Text style={styles.cardName}>{item.symbol}</Text>
                <Text style={styles.cardSymbol}>{item.name}</Text>
              </Pressable>
            )}
            ListEmptyComponent={searchQuery.isError
              ? <EmptyState title="Search failed" subtitle="Check your connection and try again." />
              : <EmptyState title="Search symbols" subtitle="Try BTC, ETH or SOL" />}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Palette.bg, width: '100%', maxWidth: 480, alignSelf: 'center' },
  homePad: { paddingHorizontal: 18, paddingBottom: 28 },
  hero: { paddingTop: 4, paddingBottom: 8 },
  heroTop: { minHeight: 168, justifyContent: 'center' },
  heroCopy: { maxWidth: 196 },
  heroArt: { position: 'absolute', width: 196, height: 196, right: -28, top: -12 },
  heroTitle: { color: Palette.text, fontSize: 40, fontWeight: '700', lineHeight: 44, letterSpacing: -1.4, textAlign: 'left' },
  heroSubtitle: { color: Palette.text, fontSize: 16, lineHeight: 22, textAlign: 'left', marginTop: 14 },
  heroHighlight: { color: Palette.accent, fontWeight: '700' },
  heroPills: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20 },
  pill: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Palette.pill, borderRadius: 8, paddingLeft: 4, paddingRight: 8, paddingVertical: 2 },
  pillCoin: { width: 26, height: 26 },
  pillSkeleton: { flex: 1, height: 32, borderRadius: 8, backgroundColor: Palette.pill },
  pillSymbol: { flexShrink: 1, color: Palette.text, fontSize: 13, fontWeight: '600' },
  pillChange: { flexShrink: 0, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.6 },
  heroCta: { alignSelf: 'stretch', width: '100%', marginTop: 28, height: 56 },
  shortcutScroll: { marginTop: 26, marginHorizontal: -18 },
  shortcuts: { paddingHorizontal: 10, gap: 2 },
  shortcut: { width: 96, alignItems: 'center', gap: 2, paddingVertical: 4 },
  shortcutArt: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  shortcutImage: { width: 84, height: 84 },
  shortcutLabel: { color: Palette.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 17 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 22, marginBottom: 16 },
  sectionTitle: { color: Palette.text, fontSize: 20, fontWeight: '600', letterSpacing: -0.7 },
  seeAllButton: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: Palette.border, borderRadius: 7, paddingHorizontal: 10, minHeight: 30 },
  seeAll: { color: Palette.text, fontSize: 11, fontWeight: '400' },
  cardScroll: { marginHorizontal: -18 },
  cardRow: { flexDirection: 'row', gap: 16, paddingHorizontal: 18, paddingBottom: 10 },
  cardName: { color: Palette.text, fontWeight: '600', fontSize: 16 },
  cardSymbol: { color: Palette.textSecondary, fontSize: 12, marginTop: 2 },
  dirTab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Palette.card,
    borderWidth: 1, borderColor: Palette.border, overflow: 'hidden', minHeight: 42,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  dirTabOn: { backgroundColor: Palette.accentMuted, borderColor: '#0066FF' },
  dirTabText: { color: Palette.textSecondary, fontSize: 13, fontWeight: '500' },
  dirTabTextOn: { color: '#0052D6', fontWeight: '600' },
  overviewCard: {
    backgroundColor: Palette.card,
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
    backgroundColor: Palette.card,
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

