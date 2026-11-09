import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { memo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';

import type { QuoteLike } from '@/components/markets/InstrumentRow';
import { SymbolIcon } from '@/components/markets/SymbolIcon';
import { Text } from '@/components/ui/AppText';
import { InsightPalette as P } from '@/constants/theme';
import { formatMarketPrice, formatPct } from '@/lib/format';

/** Same green/red as the chart page, so price direction reads the same everywhere. */
const UP = '#089981';
const DOWN = '#F23645';
const ICON = 44;

export type QuoteSection = { key: string; title: string; note?: string; data: QuoteLike[] };

function signed(value: number, quote: QuoteLike) {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatMarketPrice(Math.abs(value), quote, false)}`;
}

const QuoteRow = memo(function QuoteRow({ quote, last }: { quote: QuoteLike; last: boolean }) {
  const color = quote.change > 0 ? UP : quote.change < 0 ? DOWN : P.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${quote.symbol}, ${quote.name}, ${formatMarketPrice(quote.ltp, quote)}, ${formatPct(quote.changePercent)}`}
      accessibilityHint="Opens the chart"
      onPress={() => router.push({ pathname: '/instrument/[symbol]', params: { symbol: quote.symbol, exchange: quote.exchange, name: quote.name } })}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <SymbolIcon symbol={quote.symbol} exchange={quote.exchange} size={ICON} />
      <View style={[styles.body, !last && styles.divider]}>
        <View style={styles.left}>
          <Text style={styles.symbol} numberOfLines={1}>{quote.symbol}</Text>
          <Text style={styles.name} numberOfLines={1}>{quote.stale ? 'Last price · ' : ''}{quote.name}</Text>
        </View>
        <View style={styles.right}>
          <Text style={styles.price} numberOfLines={1}>{formatMarketPrice(quote.ltp, quote, false)}</Text>
          <Text style={[styles.change, { color }]} numberOfLines={1}>
            {signed(quote.change, quote)}  {formatPct(quote.changePercent).replace(/^-/, '−')}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

type Props = {
  sections: QuoteSection[];
  refreshing?: boolean;
  onRefresh?: () => void;
};

/** Watchlist-style grouped quotes: collapsible sections, icon + symbol/name, price + change. */
export function MarketQuoteList({ sections, refreshing = false, onRefresh }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const visible = sections.filter(section => section.data.length || section.note);
  return (
    <SectionList
      sections={visible.map(section => ({ ...section, data: collapsed[section.key] ? [] : section.data }))}
      keyExtractor={quote => `${quote.exchange}:${quote.symbol}`}
      keyboardShouldPersistTaps="handled"
      stickySectionHeadersEnabled={false}
      contentContainerStyle={styles.content}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
      renderSectionHeader={({ section }) => {
        const isCollapsed = Boolean(collapsed[section.key]);
        const count = sections.find(item => item.key === section.key)?.data.length ?? 0;
        return (
          <View style={styles.sectionWrap}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${section.title}, ${count} pairs`}
              accessibilityState={{ expanded: !isCollapsed }}
              onPress={() => setCollapsed(previous => ({ ...previous, [section.key]: !isCollapsed }))}
              style={({ pressed }) => [styles.sectionHeader, pressed && styles.pressed]}>
              <View style={[styles.chevron, isCollapsed && styles.chevronCollapsed]}>
                <SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={20} tintColor={P.text} accessible={false} />
              </View>
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </Pressable>
            {section.note ? <Text style={styles.note}>{section.note}</Text> : null}
          </View>
        );
      }}
      renderItem={({ item, index, section }) => <QuoteRow quote={item} last={index === section.data.length - 1} />}
      SectionSeparatorComponent={() => null}
      renderSectionFooter={() => <View style={styles.sectionGap} />}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 24 },
  pressed: { opacity: 0.6 },
  sectionWrap: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.border },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 16 },
  chevron: { width: 24, alignItems: 'center' },
  chevronCollapsed: { transform: [{ rotate: '-90deg' }] },
  sectionTitle: { color: P.text, fontSize: 15, fontWeight: '500' },
  note: { color: P.textMuted, fontSize: 12, lineHeight: 17, paddingHorizontal: 16, paddingBottom: 8, marginLeft: 36 },
  sectionGap: { height: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 16, minHeight: 72 },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', paddingRight: 16, paddingVertical: 12 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: P.border },
  left: { flex: 1, minWidth: 0 },
  symbol: { color: P.text, fontSize: 17, fontWeight: '600', letterSpacing: -0.2 },
  name: { color: P.textSecondary, fontSize: 14, marginTop: 3 },
  right: { alignItems: 'flex-end', maxWidth: '52%' },
  price: { color: P.text, fontSize: 17, fontWeight: '500', fontVariant: ['tabular-nums'] },
  change: { fontSize: 14, marginTop: 3, fontVariant: ['tabular-nums'] },
});
