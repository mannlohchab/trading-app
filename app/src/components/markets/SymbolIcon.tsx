import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { marketAssets } from '@/lib/marketAssets';

/** Bundled logos: cryptocurrency-icons (CC0) and flag-icons 1x1 (MIT). See assets/icons/markets. */
const CRYPTO_LOGOS: Record<string, number> = {
  BTC: require('@/assets/icons/markets/crypto/btc.svg'),
  ETH: require('@/assets/icons/markets/crypto/eth.svg'),
  SOL: require('@/assets/icons/markets/crypto/sol.svg'),
  BNB: require('@/assets/icons/markets/crypto/bnb.svg'),
  XRP: require('@/assets/icons/markets/crypto/xrp.svg'),
  DOGE: require('@/assets/icons/markets/crypto/doge.svg'),
  USDT: require('@/assets/icons/markets/crypto/usdt.svg'),
};

const CURRENCY_FLAGS: Record<string, number> = {
  EUR: require('@/assets/icons/markets/flags/eu.svg'),
  USD: require('@/assets/icons/markets/flags/us.svg'),
  GBP: require('@/assets/icons/markets/flags/gb.svg'),
  JPY: require('@/assets/icons/markets/flags/jp.svg'),
  CHF: require('@/assets/icons/markets/flags/ch.svg'),
  AUD: require('@/assets/icons/markets/flags/au.svg'),
  CAD: require('@/assets/icons/markets/flags/ca.svg'),
  NZD: require('@/assets/icons/markets/flags/nz.svg'),
};

function hashColor(symbol: string): string {
  const colors = ['#2962FF', '#E91E63', '#00897B', '#F57C00', '#7B1FA2', '#1565C0', '#C62828'];
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h + symbol.charCodeAt(i) * 17) % colors.length;
  return colors[h]!;
}

type Props = { symbol: string; exchange?: string; size?: number };

export function SymbolIcon({ symbol, exchange, size = 40 }: Props) {
  const upper = symbol.toUpperCase();
  const assets = marketAssets(upper, exchange);
  const forex = exchange?.toUpperCase() === 'FOREX' || upper.includes('/');
  const label = `${upper} icon`;

  // Forex: base-currency flag in front, quote-currency flag behind (EUR/USD → 🇪🇺 over 🇺🇸).
  const baseFlag = assets && CURRENCY_FLAGS[assets[0]];
  const quoteFlag = assets && CURRENCY_FLAGS[assets[1]];
  if (forex && baseFlag && quoteFlag) {
    const flag = Math.round(size * 0.72);
    const ring = { width: flag, height: flag, borderRadius: flag / 2 };
    return (
      <View style={{ width: size, height: size }} accessible accessibilityLabel={label}>
        <Image source={quoteFlag} style={[styles.flag, ring, { right: 0, bottom: 0 }]} contentFit="cover" />
        <Image source={baseFlag} style={[styles.flag, ring, { left: 0, top: 0 }]} contentFit="cover" />
      </View>
    );
  }

  // Crypto: base-asset logo with a small quote-asset badge (BTCUSDT → ₿ with a Tether badge).
  const baseLogo = assets && CRYPTO_LOGOS[assets[0]];
  if (!forex && baseLogo) {
    const quoteLogo = CRYPTO_LOGOS[assets[1]];
    const badge = Math.round(size * 0.42);
    return (
      <View style={{ width: size, height: size }} accessible accessibilityLabel={label}>
        <Image source={baseLogo} style={{ width: size, height: size }} contentFit="contain" />
        {quoteLogo ? (
          <Image source={quoteLogo} contentFit="contain"
            style={[styles.badge, { width: badge, height: badge, borderRadius: badge / 2, right: -size * 0.06, bottom: -size * 0.06 }]} />
        ) : null}
      </View>
    );
  }

  // Unknown instruments keep the letter badge.
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[styles.letter, { width: size, height: size, borderRadius: size * 0.25, backgroundColor: hashColor(upper) }]}>
      <Text style={[styles.label, { fontSize: size > 36 ? 13 : 11 }]} numberOfLines={1}>
        {forex ? upper.slice(0, 3) : upper.slice(0, 2)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flag: { position: 'absolute', borderWidth: 1.5, borderColor: '#FFFFFF', overflow: 'hidden' },
  badge: { position: 'absolute', borderWidth: 1.5, borderColor: '#FFFFFF', backgroundColor: '#FFFFFF' },
  letter: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.3)',
  },
  label: { color: '#FFFFFF', fontWeight: '800' },
});
