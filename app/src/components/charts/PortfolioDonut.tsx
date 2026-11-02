import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GlassPressable } from '@/components/ui/GlassIcon';

import { formatInr } from '@/lib/format';
import { svgImageSource } from '@/lib/svgImage';
import { buildPortfolioAllocation, portfolioPoint, type AllocationKey, type PortfolioAllocationInput } from '@/lib/portfolioAllocation';

type Props = { portfolio?: PortfolioAllocationInput; loading?: boolean };
type Selection = 'total' | AllocationKey;
const COLORS = { holdings: '#DC4C64', cash: '#169B70' };
const LABELS = { total: 'Portfolio value', holdings: 'Invested holdings', cash: 'Available cash' };

export function PortfolioDonut({ portfolio, loading }: Props) {
  const [selected, setSelected] = useState<Selection>('total');
  const allocation = useMemo(() => buildPortfolioAllocation(portfolio), [portfolio]);
  const value = allocation?.[selected];
  const svg = useMemo(() => {
    const circumference = 2 * Math.PI * 118;
    let offset = 0;
    const segments = allocation?.segments.map(segment => {
      const length = segment.share * circumference;
      const gap = allocation.segments.length > 1 ? Math.min(5, length * 0.15) : 0;
      const opacity = selected === 'total' || selected === segment.key ? 1 : 0.35;
      const midpoint = (offset + length / 2) / circumference * 360;
      const point = portfolioPoint(midpoint);
      const label = segment.share >= 0.12
        ? `<text x="${point.x}" y="${point.y}" dy="4.5" fill="#fff" font-family="Arial,sans-serif" font-size="14" font-weight="700" text-anchor="middle">${(segment.share * 100).toFixed(1)}%</text>` : '';
      const circle = `<circle cx="160" cy="160" r="118" fill="none" stroke="${COLORS[segment.key]}" stroke-width="48" stroke-dasharray="${length - gap} ${circumference - length + gap}" stroke-dashoffset="${-offset - gap / 2}" transform="rotate(-90 160 160)"/>`;
      offset += length;
      return `<g opacity="${opacity}">${circle}${label}</g>`;
    }).join('') ?? '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><circle cx="160" cy="160" r="118" fill="none" stroke="#F0F1F5" stroke-width="48"/>${segments}</svg>`;
  }, [allocation, selected]);
  const chartSource = useMemo(() => svgImageSource(svg, 320, 320), [svg]);

  return (
    <View>
      <View style={styles.chart}>
        <Image source={chartSource} style={StyleSheet.absoluteFill} contentFit="contain" accessible={false} />
        <GlassPressable style={styles.center} accessibilityRole="button" accessibilityLabel={value == null ? loading ? 'Loading portfolio' : 'Portfolio value unavailable' : `${LABELS[selected]} ${formatInr(value)}. Show total portfolio value.`} onPress={() => setSelected('total')}>
          <Text style={styles.centerLabel}>{LABELS[selected]}</Text>
          <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{value == null ? '—' : formatInr(value, 0)}</Text>
          <Text style={styles.centerHint}>{loading ? 'Loading portfolio…' : allocation ? selected === 'total' ? 'Paper portfolio' : 'Tap to view total' : 'Data unavailable'}</Text>
        </GlassPressable>
      </View>
      <View style={styles.legend}>
        {(['holdings', 'cash'] as const).map(key => (
          <GlassPressable key={key} onPress={() => setSelected(selected === key ? 'total' : key)} accessibilityRole="button" accessibilityState={{ selected: selected === key }} accessibilityLabel={`${LABELS[key]}, ${allocation ? formatInr(allocation[key]) : 'unavailable'}`} style={({ pressed }) => [styles.legendItem, selected === key && { borderColor: COLORS[key], backgroundColor: key === 'holdings' ? '#FFF5F6' : '#F0FAF6' }, pressed && { opacity: 0.7 }]}>
            <View style={styles.legendHeading}><View style={[styles.legendDot, { backgroundColor: COLORS[key] }]} />
              <Text style={styles.legendLabel}>{LABELS[key]}</Text>
              {allocation && allocation.total > 0 ? <Text style={[styles.share, { color: COLORS[key] }]}>{(allocation[key] / allocation.total * 100).toFixed(1)}%</Text> : null}
            </View>
            <Text style={styles.legendValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{allocation ? formatInr(allocation[key]) : '—'}</Text>
          </GlassPressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { width: '100%', maxWidth: 340, aspectRatio: 1, alignSelf: 'center', marginTop: 8 },
  center: { position: 'absolute', top: '32%', bottom: '32%', left: '18%', right: '18%', alignItems: 'center', justifyContent: 'center' },
  centerLabel: { color: '#71677E', fontSize: 13, marginBottom: 8 },
  amount: { color: '#352C45', fontSize: 30, fontWeight: '700', letterSpacing: -0.7, fontVariant: ['tabular-nums'] },
  centerHint: { color: '#82758F', fontSize: 11, marginTop: 8 },
  legend: { gap: 10 },
  legendItem: { borderWidth: 1, borderColor: '#EAE5F2', backgroundColor: '#FCFBFE', padding: 16, borderRadius: 14, gap: 10 },
  legendHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { color: '#71677E', fontSize: 13, flex: 1 },
  legendValue: { color: '#352C45', fontSize: 23, fontWeight: '600', fontVariant: ['tabular-nums'] },
  share: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
