export function formatInr(value: number, digits = 2): string {
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${value < 0 ? '-' : ''}₹${formatted}`;
}

export function formatPct(value: number, digits = 2): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatCompact(value: number): string {
  if (value >= 1e7) return `${(value / 1e7).toFixed(2)} Cr`;
  if (value >= 1e5) return `${(value / 1e5).toFixed(2)} L`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)} K`;
  return value.toFixed(0);
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export type PriceMetadata = { exchange?: string; symbol?: string; currency?: string; pricePrecision?: number };
export function marketMetadata(meta: PriceMetadata = {}) {
  const forex = meta.exchange === 'FOREX';
  const currency = meta.currency ?? (forex ? meta.symbol?.slice(-3) ?? 'USD' : meta.exchange === 'BINANCE' ? 'USDT' : 'INR');
  const pricePrecision = meta.pricePrecision ?? (forex ? currency === 'JPY' ? 3 : 5 : meta.exchange === 'BINANCE' && /^(XRP|DOGE)/.test(meta.symbol ?? '') ? 5 : 2);
  return { currency, pricePrecision: Math.max(0, Math.min(12, pricePrecision)) };
}
export function formatMarketPrice(value: number, meta: PriceMetadata = {}, includeCurrency = true): string {
  if (!Number.isFinite(value)) return '—';
  const {currency, pricePrecision} = marketMetadata(meta);
  if (currency === 'INR' && includeCurrency) return formatInr(value, pricePrecision);
  const formatted = value.toLocaleString('en-US', { minimumFractionDigits: pricePrecision, maximumFractionDigits: pricePrecision });
  return includeCurrency ? `${formatted} ${currency}` : formatted;
}
export function marketSourceLabel(source?: string) {
  return source === 'twelvedata' ? 'Twelve Data' : source === 'binance' ? 'Binance' : source === 'yahoo' ? 'Yahoo fallback' : source === 'angelone' ? 'Angel One' : source === 'demo' ? 'Demo · fictional' : 'Market data';
}
