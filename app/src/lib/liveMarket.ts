import type { QueryClient } from '@tanstack/react-query';
type LiveQuote = { symbol: string; exchange: string; asOf?: number; [key: string]: any };
/** Patch only matching instruments; preserve historical chart data and newer observations. */
export function patchMarketData<T>(data: T, quote: LiveQuote): T {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) {
    const next = data.map(v => patchMarketData(v, quote));
    return (next.some((v,i) => v !== data[i]) ? next : data) as T;
  }
  const value = data as Record<string, any>;
  if (value.symbol === quote.symbol && value.exchange === quote.exchange && 'ltp' in value) {
    if ((value.asOf ?? 0) > (quote.asOf ?? 0)) return data;
    return {...value, ...quote} as T;
  }
  let changed = false; const next = {...value};
  for (const key of ['items','quote','crypto','forex','constituents','gainers','losers','active']) {
    if (!(key in value)) continue;
    const updated = key === 'quote' && value.quote === null && value.symbol === quote.symbol && value.exchange === quote.exchange
      ? quote : patchMarketData(value[key], quote);
    if (updated !== value[key]) { next[key] = updated; changed = true; }
  }
  return (changed ? next : data) as T;
}
export function updateMarketCaches(client: QueryClient, quote: LiveQuote) {
  for (const key of ['quote','watchlist-items','explore','overview']) {
    client.setQueriesData({queryKey: [key]}, data => patchMarketData(data, quote));
  }
}
export function mergeLiveCandle<T extends {time: number}>(candles: T[], candle: T): T[] {
  if (!candles.length) return candles; // REST must establish history first.
  const last = candles[candles.length - 1];
  if (candle.time < last.time) return candles;
  if (candle.time === last.time) return [...candles.slice(0,-1), candle];
  return [...candles.slice(-499), candle];
}

/** Retains stream observations so a delayed REST response cannot roll the chart back. */
export class CandleBuffer<T extends {time: number; volume?: number}> {
  version = 0;
  private observations = new Map<number, {bar: T; version: number}>();
  observe(bar: T) {
    this.observations.set(bar.time, {bar,version:++this.version});
    if (this.observations.size > 500) this.observations.delete(this.observations.keys().next().value!);
  }
  reconcile(snapshot: T[], startedVersion: number): T[] {
    const merged = new Map(snapshot.map(bar => [bar.time,bar]));
    const first = snapshot[0]?.time ?? 0;
    const last = snapshot.at(-1)?.time ?? 0;
    for (const [time, observation] of this.observations) {
      if (time < first) continue;
      const rest = merged.get(time);
      if (!rest || observation.version > startedVersion ||
        (time >= last && (observation.bar.volume ?? 0) >= (rest.volume ?? 0))) merged.set(time,observation.bar);
    }
    return [...merged.values()].sort((a,b) => a.time-b.time).slice(-500);
  }
}
