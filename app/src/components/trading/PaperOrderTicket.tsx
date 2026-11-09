import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { Palette } from '@/constants/theme';
import { DEMO_MODE } from '@/lib/demoMode';
import { formatMarketPrice, formatUsd, marketMetadata } from '@/lib/format';
import { fetchQuote } from '@/lib/marketData';
import { fetchPortfolio, orderProblem, placeOrder, requiredCash, sellableQuantity, type OrderDraft } from '@/lib/paperTrading';
import { useAuth } from '@/store/auth';

type Submission = { symbol: string; side: 'BUY' | 'SELL'; orderType: 'MARKET' | 'LIMIT'; quantity: string; limitPrice?: string; clientOrderId: string };
export function PaperOrderTicket({ symbol, exchange, initialSide, onBusyChange }: {
  symbol: string; exchange: string; initialSide: 'BUY' | 'SELL'; onBusyChange: (busy: boolean) => void;
}) {
  const userId = useAuth(s => s.user?.id);
  const qc = useQueryClient();
  const [draft, setDraft] = useState<OrderDraft>({ symbol, exchange, side: initialSide, orderType: 'MARKET', quantity: '', limitPrice: '' });
  const requestId = useRef<string | null>(null);
  const submitting = useRef(false);
  const metadata = marketMetadata({ symbol, exchange });
  const portfolio = useQuery({ queryKey: ['paper-portfolio', userId], enabled: Boolean(userId), retry: false, refetchInterval: 30_000,
    queryFn: ({ signal }) => fetchPortfolio(userId!, signal) });
  const quote = useQuery({ queryKey: ['quote', symbol, exchange], retry: false, refetchInterval: 15_000,
    queryFn: ({ signal }) => fetchQuote(symbol, signal) });
  const mutation = useMutation({
    mutationFn: (body: Submission) => placeOrder(userId!, body),
    onSettled: () => {
      submitting.current = false;
      for (const key of ['paper-portfolio', 'profile-overview', 'transactions', 'paper-orders']) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
  useEffect(() => { onBusyChange(mutation.isPending); }, [mutation.isPending, onBusyChange]);
  const available = sellableQuantity(portfolio.data, symbol, exchange);
  const problem = portfolio.isError ? 'Could not load your account balance. Refresh before trading.'
    : quote.isError ? 'Market prices are unavailable. Refresh before trading.'
    : orderProblem({ ...draft, portfolio: portfolio.data, quote: quote.data?.quote, isDemo: DEMO_MODE || quote.data?.isDemo });
  const price = draft.orderType === 'LIMIT' ? Number(draft.limitPrice) : quote.data?.quote.ltp;
  const estimate = draft.side === 'BUY'
    ? requiredCash(draft.orderType, price ?? NaN, Number(draft.quantity))
    : Number(draft.quantity) * (price ?? NaN) * (1 - 0.001);
  function edit(update: Partial<OrderDraft>) {
    if (submitting.current) return;
    setDraft(current => ({ ...current, ...update })); requestId.current = null; mutation.reset();
  }
  function submit() {
    if (problem || submitting.current || mutation.isSuccess) return;
    submitting.current = true;
    requestId.current ??= `paper-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    mutation.mutate({ symbol, side: draft.side, orderType: draft.orderType, quantity: draft.quantity.trim(),
      ...(draft.orderType === 'LIMIT' ? { limitPrice: draft.limitPrice.trim() } : {}), clientOrderId: requestId.current });
  }
  return <View style={styles.ticket}>
    <View style={styles.switcher}>{(['BUY', 'SELL'] as const).map(side => <Pressable key={side} accessibilityRole="button"
      accessibilityState={{ selected: draft.side === side }} disabled={mutation.isPending} onPress={() => edit({ side })}
      style={[styles.option, draft.side === side && { backgroundColor: side === 'BUY' ? '#089981' : '#F23645' }]}>
      <Text style={[styles.optionText, draft.side === side && styles.selected]}>{side === 'BUY' ? 'Buy' : 'Sell'}</Text>
    </Pressable>)}</View>
    <View style={styles.row}><Text>Available cash</Text><Text style={styles.value}>{portfolio.data ? formatUsd(portfolio.data.availableCash) : '—'}</Text></View>
    <View style={styles.row}><Text>Available to sell</Text><Text style={styles.value}>{portfolio.data ? available : '—'} {symbol.replace(/USDT$/, '')}</Text></View>
    {!!portfolio.data?.reservedCash && <Text style={styles.note}>{formatUsd(portfolio.data.reservedCash)} reserved for pending buys.</Text>}
    <View style={styles.switcher}>{(['MARKET', 'LIMIT'] as const).map(orderType => <Pressable key={orderType} accessibilityRole="button"
      accessibilityState={{ selected: draft.orderType === orderType }} disabled={mutation.isPending} onPress={() => edit({ orderType })}
      style={[styles.option, draft.orderType === orderType && styles.activeType]}><Text>{orderType === 'MARKET' ? 'Market' : 'Limit'}</Text></Pressable>)}</View>
    <View style={styles.row}><Text>Current quote</Text><Text style={styles.value}>{quote.data ? formatMarketPrice(quote.data.quote.ltp, metadata) : '—'}</Text></View>
    {draft.orderType === 'LIMIT' && <><Text>Limit price ({metadata.currency})</Text><TextInput accessibilityLabel="Limit price" keyboardType="decimal-pad"
      editable={!mutation.isPending} value={draft.limitPrice} onChangeText={limitPrice => edit({ limitPrice: limitPrice.replace(',', '.') })} style={styles.input} placeholder="Limit price" /></>}
    <Text>Quantity</Text>
    <TextInput accessibilityLabel="Quantity" keyboardType="decimal-pad" value={draft.quantity} editable={!mutation.isPending}
      onChangeText={quantity => edit({ quantity: quantity.replace(',', '.') })} style={styles.input} placeholder="0.01" />
    {draft.side === 'SELL' && available > 0 && <Pressable accessibilityRole="button" disabled={mutation.isPending} onPress={() => edit({ quantity: String(available) })}><Text style={styles.link}>Use all available quantity</Text></Pressable>}
    <View style={styles.row}><Text>{draft.side === 'BUY' ? (draft.orderType === 'MARKET' ? 'Cash held (incl. 2% buffer and fee)' : 'Cash held (incl. fee)') : 'Estimated proceeds after fee'}</Text><Text style={styles.value}>{Number.isFinite(estimate) && estimate > 0 ? formatUsd(estimate) : '—'}</Text></View>
    {mutation.isSuccess ? <Text accessibilityRole="alert" style={mutation.data.order.status === 'REJECTED' ? styles.error : styles.success}>{mutation.data.order.status === 'FILLED'
      ? `${mutation.variables.side === 'BUY' ? 'Bought' : 'Sold'} ${mutation.variables.quantity} ${mutation.variables.symbol} at ${formatMarketPrice(mutation.data.fillPrice!, metadata)}.`
      : mutation.data.order.status === 'PENDING' ? 'Limit order open. It fills when the live price reaches it; cancel it in Profile → Portfolio.'
      : mutation.data.order.status === 'REJECTED' ? `Order rejected${mutation.data.order.rejectReason ? `: ${mutation.data.order.rejectReason}` : '.'}`
      : `Order ${mutation.data.order.status.toLowerCase()}.`}</Text>
      : problem ? <Text style={styles.note}>{problem}</Text> : null}
    {mutation.isError && <Text accessibilityRole="alert" style={styles.error}>{mutation.error.message}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={draft.side === 'BUY' ? 'Place buy order' : 'Place sell order'}
      disabled={Boolean(problem) || mutation.isPending || mutation.isSuccess} onPress={submit}
      style={[styles.submit, { backgroundColor: draft.side === 'BUY' ? '#089981' : '#F23645' }, (Boolean(problem) || mutation.isPending || mutation.isSuccess) && styles.disabled]}>
      {mutation.isPending ? <ActivityIndicator color="white" /> : <Text style={styles.submitText}>{mutation.isSuccess ? 'Order submitted' : draft.side === 'BUY' ? 'Place buy order' : 'Place sell order'}</Text>}
    </Pressable>
    <Pressable accessibilityRole="button" disabled={mutation.isPending} onPress={() => { void portfolio.refetch(); void quote.refetch(); }}><Text style={styles.link}>Refresh balance and quote</Text></Pressable>
    <Text style={styles.note}>Virtual USDT on live Binance prices, no leverage or short selling. Market orders fill at the bid/ask with 0.1% commission; limit orders fill when the live price reaches them. The server checks your balance and holdings again before filling.</Text>
  </View>;
}
const styles = StyleSheet.create({
  ticket: { gap: 14 }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, value: { fontWeight: '600' },
  switcher: { flexDirection: 'row', gap: 6, backgroundColor: Palette.pill, borderRadius: 12, padding: 4 },
  option: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 8 }, optionText: { fontWeight: '600', color: Palette.text }, selected: { color: 'white' }, activeType: { backgroundColor: Palette.cardHover },
  input: { borderWidth: 1, borderColor: Palette.border, borderRadius: 12, padding: 14, fontSize: 20, color: Palette.text, backgroundColor: Palette.bg },
  submit: { padding: 16, alignItems: 'center', borderRadius: 12 }, submitText: { color: 'white', fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.45 }, error: { color: '#E11D48' }, success: { color: '#059669' }, note: { color: Palette.textSecondary, lineHeight: 20, fontSize: 13 }, link: { color: '#0052D6', fontWeight: '600' },
});
