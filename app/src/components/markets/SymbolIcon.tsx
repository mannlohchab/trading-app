import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

const LETTER_ONLY = new Set([
  'NIFTY',
  'BANKNIFTY',
  'SENSEX',
  'FINNIFTY',
  'INDIAVIX',
  'GOLD',
  'SILVER',
  'CRUDEOIL',
]);

const ICON_META: Record<string, { bg: string; label: string }> = {
  BTCUSDT: { bg: '#F7931A', label: '₿' },
  ETHUSDT: { bg: '#627EEA', label: 'ETH' },
  SOLUSDT: { bg: '#6844C8', label: 'SOL' },
  BNBUSDT: { bg: '#B58A00', label: 'BNB' },
  XRPUSDT: { bg: '#263238', label: 'XRP' },
  DOGEUSDT: { bg: '#B49B51', label: 'Ð' },
  NIFTY: { bg: '#2962FF', label: '50' },
  BANKNIFTY: { bg: '#0D7377', label: 'BN' },
  SENSEX: { bg: '#E91E63', label: '30' },
  FINNIFTY: { bg: '#7B1FA2', label: 'FN' },
  INDIAVIX: { bg: '#00897B', label: 'VX' },
  RELIANCE: { bg: '#1565C0', label: 'R' },
  TCS: { bg: '#6A1B9A', label: 'T' },
  INFY: { bg: '#0277BD', label: 'I' },
  HDFCBANK: { bg: '#004D40', label: 'H' },
  ICICIBANK: { bg: '#F57C00', label: 'IC' },
  SBIN: { bg: '#1B5E20', label: 'SB' },
  BHARTIARTL: { bg: '#C62828', label: 'A' },
  ITC: { bg: '#558B2F', label: 'IT' },
  LT: { bg: '#37474F', label: 'LT' },
  AXISBANK: { bg: '#AD1457', label: 'AX' },
  GOLD: { bg: '#C9A227', label: 'Au' },
  SILVER: { bg: '#90A4AE', label: 'Ag' },
  CRUDEOIL: { bg: '#212121', label: 'Oil' },
};

function hashColor(symbol: string): string {
  const colors = ['#2962FF', '#E91E63', '#00897B', '#F57C00', '#7B1FA2', '#1565C0', '#C62828'];
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h + symbol.charCodeAt(i) * 17) % colors.length;
  return colors[h]!;
}

/** Public ticker images. No API key. 404 falls back to the letter badge. */
export function companyLogoUrl(symbol: string, exchange = 'NSE'): string | null {
  const upper = symbol.toUpperCase();
  if (LETTER_ONLY.has(upper) || ['MCX', 'FOREX', 'BINANCE'].includes(exchange.toUpperCase())) return null;
  const suffix = exchange.toUpperCase() === 'BSE' ? 'BO' : 'NS';
  return `https://financialmodelingprep.com/image-stock/${upper}.${suffix}.png`;
}

type Props = { symbol: string; exchange?: string; size?: number };

export function SymbolIcon({ symbol, exchange = 'NSE', size = 40 }: Props) {
  const upper = symbol.toUpperCase();
  const meta = ICON_META[upper] ?? {
    bg: hashColor(upper),
    label: upper.slice(0, 2),
  };
  const logo = companyLogoUrl(upper, exchange);
  const [failed, setFailed] = useState(false);
  const borderRadius = size * 0.25;

  if (logo && !failed) {
    return (
      <View
        style={[
          styles.container,
          styles.logoContainer,
          { width: size, height: size, borderRadius },
        ]}>
        <Image
          source={{ uri: logo }}
          style={{ width: size * 0.72, height: size * 0.72 }}
          contentFit="contain"
          onError={() => setFailed(true)}
          accessibilityLabel={`${upper} logo`}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { width: size, height: size, borderRadius, backgroundColor: meta.bg },
      ]}>
      <Text style={[styles.label, { fontSize: size > 36 ? 13 : 11 }]} numberOfLines={1}>
        {meta.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.3)',
  },
  logoContainer: { backgroundColor: '#F4F5F7' },
  label: { color: '#FFFFFF', fontWeight: '800' },
});
