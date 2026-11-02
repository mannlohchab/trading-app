import { AppError } from '../lib/errors';
import type { Candle } from './types';
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export class RequestCache {
  private entries = new Map<string, { until: number; value: Promise<any> }>();
  constructor(private now = Date.now) {}
  get<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && existing.until > this.now()) return existing.value;
    for (const [k,v] of this.entries) if (v.until <= this.now()) this.entries.delete(k);
    if (this.entries.size >= 256) this.entries.delete(this.entries.keys().next().value!);
    const value = Promise.resolve().then(load);
    this.entries.set(key, { until: this.now() + ttl, value });
    value.catch(() => { if (this.entries.get(key)?.value === value) this.entries.delete(key); });
    return value;
  }
}
export function number(value: unknown, allowZero = false): number {
  if (value === null || value === undefined || value === '') throw new AppError(503, 'Incomplete market data', 'MARKET_DATA_UNAVAILABLE');
  const n = Number(value);
  if (!Number.isFinite(n) || (allowZero ? n < 0 : n <= 0)) throw new AppError(503, 'Invalid market data', 'MARKET_DATA_UNAVAILABLE');
  return n;
}
export function validCandles(candles: Candle[]): Candle[] {
  const unique = new Map<number, Candle>();
  for (const c of candles) {
    [c.time,c.open,c.high,c.low,c.close].forEach(v => number(v)); number(c.volume,true);
    if (c.high < Math.max(c.open,c.close) || c.low > Math.min(c.open,c.close) || c.low > c.high) throw new AppError(503, 'Invalid OHLC data');
    unique.set(c.time,c);
  }
  if (!unique.size) throw new AppError(503, 'Price history unavailable', 'MARKET_DATA_UNAVAILABLE');
  return [...unique.values()].sort((a,b) => a.time-b.time);
}
export async function requestJson(request: Fetcher, url: string): Promise<any> {
  try {
    const res = await request(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('Upstream rejected request');
    const body = await res.json() as any;
    if (body?.status === 'error' || (typeof body?.code === 'number' && body.code < 0)) throw new Error('Upstream error');
    return body;
  } catch { throw new AppError(503, 'Market provider unavailable', 'MARKET_DATA_UNAVAILABLE'); }
}
