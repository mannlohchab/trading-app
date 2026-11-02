/** Paper accounts settle in USD. */
export function formatUsd(value: number, digits = 2): string {
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${value < 0 ? '-' : ''}$${formatted}`;
}

export function formatPct(value: number, digits = 2): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatCompact(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
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
  const currency = meta.currency ?? (forex ? meta.symbol?.slice(-3) ?? 'USD' : 'USDT');
  const pricePrecision = meta.pricePrecision ?? (forex ? currency === 'JPY' ? 3 : 5 : meta.exchange === 'BINANCE' && /^(XRP|DOGE)/.test(meta.symbol ?? '') ? 5 : 2);
  return { currency, pricePrecision: Math.max(0, Math.min(12, pricePrecision)) };
}
export function formatMarketPrice(value: number, meta: PriceMetadata = {}, includeCurrency = true): string {
  if (!Number.isFinite(value)) return '—';
  const {currency, pricePrecision} = marketMetadata(meta);
  const formatted = value.toLocaleString('en-US', { minimumFractionDigits: pricePrecision, maximumFractionDigits: pricePrecision });
  return includeCurrency ? `${formatted} ${currency}` : formatted;
}
export function marketSourceLabel(source?: string) {
  return source === 'twelvedata' ? 'Twelve Data' : source === 'binance' ? 'Binance' : source === 'demo' ? 'Demo · fictional' : 'Market data';
}
