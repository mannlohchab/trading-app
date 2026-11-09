import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { InsightPalette as P } from '@/constants/theme';
import { formatMarketPrice } from '@/lib/format';
import { cancelOrder, fetchOrders } from '@/lib/paperTrading';
import { useAuth } from '@/store/auth';

export function PaperOrders() {
  const userId = useAuth(s => s.user?.id);
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['paper-orders', userId], enabled: Boolean(userId), refetchInterval: 10_000,
    queryFn: ({ signal }) => fetchOrders(userId!, signal) });
  const cancel = useMutation({ mutationFn: (id: string) => cancelOrder(id),
    onSettled: () => { for (const key of ['paper-orders', 'paper-portfolio', 'profile-overview', 'transactions']) void qc.invalidateQueries({ queryKey: [key] }); } });
  const pending = (query.data?.orders ?? []).filter(o => o.status === 'PENDING');
  const recent = (query.data?.orders ?? []).filter(o => o.status !== 'PENDING').slice(0, 8);
  return <View style={styles.block}>
    <Text style={styles.heading}>Paper orders</Text>
    {query.isPending && <ActivityIndicator />}
    {query.isError && <Pressable accessibilityRole="button" onPress={() => void query.refetch()}><Text style={styles.error}>Could not load orders. Tap to retry.</Text></Pressable>}
    {cancel.isError && <Text accessibilityRole="alert" style={styles.error}>{cancel.error.message}</Text>}
    {query.isSuccess && !pending.length && <Text style={styles.meta}>No open orders.</Text>}
    {[...pending, ...recent].map(order => <View key={order.id} style={styles.row}>
      <View style={styles.details}>
        <Text style={styles.title}>{order.side} {order.quantity} {order.symbol}</Text>
        <Text style={styles.meta}>{order.orderType} · {order.status === 'PENDING' ? 'OPEN' : order.status}{order.source && order.source !== 'USER' ? ` · ${order.source.toLowerCase()}` : ''}{order.avgFillPrice != null ? ` · Filled ${formatMarketPrice(order.avgFillPrice, order)}` : order.limitPrice != null ? ` · ${order.orderType === 'STOP' ? 'Stop' : 'Limit'} ${formatMarketPrice(order.limitPrice, order)}` : ''}{order.rejectReason ? ` · ${order.rejectReason}` : ''}</Text>
      </View>
      {order.cancellable && <Pressable accessibilityRole="button" accessibilityLabel={`Cancel ${order.side.toLowerCase()} ${order.symbol} order`}
        disabled={cancel.isPending} onPress={() => cancel.mutate(order.id)} style={styles.cancel}>
        <Text style={styles.cancelText}>{cancel.isPending && cancel.variables === order.id ? 'Cancelling…' : 'Cancel'}</Text>
      </Pressable>}
    </View>)}
  </View>;
}
const styles = StyleSheet.create({
  block: { gap: 12, marginBottom: 24 }, heading: { fontSize: 20, fontWeight: '700', color: P.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: P.border },
  details: { flex: 1, gap: 5 }, title: { fontWeight: '600', color: P.text }, meta: { color: P.textSecondary, fontSize: 12 },
  error: { color: P.red }, cancel: { padding: 10, borderRadius: 8, backgroundColor: 'rgba(240,113,120,0.14)' }, cancelText: { color: P.red, fontWeight: '600' },
});
