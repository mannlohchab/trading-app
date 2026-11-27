/** Fixed-decimal number with thousands separators: 1234.5 → "1,234.50". */
export function formatUsd(n: number, digits = 2): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Price with the given decimals, or decimals that suit its size (BTC → 2, PEPE → 8). */
export function formatPrice(n: number | null | undefined, precision?: number): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = precision ?? (abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8);
  return formatUsd(n, digits);
}

export function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

/** Quantity with up to 8 decimals and no trailing zeros. */
export function formatQty(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? formatTime(ts)
    : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${formatTime(ts)}`;
}
