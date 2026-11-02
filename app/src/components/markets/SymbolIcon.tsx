import { StyleSheet, Text, View } from 'react-native';

const ICON_META: Record<string, { bg: string; label: string }> = {
  BTCUSDT: { bg: '#F7931A', label: '₿' },
  ETHUSDT: { bg: '#627EEA', label: 'ETH' },
  SOLUSDT: { bg: '#6844C8', label: 'SOL' },
  BNBUSDT: { bg: '#B58A00', label: 'BNB' },
  XRPUSDT: { bg: '#263238', label: 'XRP' },
  DOGEUSDT: { bg: '#B49B51', label: 'Ð' },
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
  const meta = ICON_META[upper] ?? {
    bg: hashColor(upper),
    // Forex pairs show their base currency (EUR/USD → EUR).
    label: exchange?.toUpperCase() === 'FOREX' ? upper.slice(0, 3) : upper.slice(0, 2),
  };
  const borderRadius = size * 0.25;

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
  label: { color: '#FFFFFF', fontWeight: '800' },
});
