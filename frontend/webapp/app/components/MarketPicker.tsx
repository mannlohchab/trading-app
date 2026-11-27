import { useEffect, useState } from "react";
import { searchMarkets, type ListedMarket } from "../lib/api/market";
import { formatCompact, formatPrice } from "../lib/format";
import { useTradingStore } from "../lib/trading-store";

/** Most active USDT pairs; typing searches the backend's full catalog. */
export function MarketPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { markets, symbol, setSymbol } = useTradingStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ListedMarket[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Debounced catalog search.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchMarkets(q, controller.signal)
        .then((found) => setResults(found))
        .catch(() => {
          if (!controller.signal.aborted) setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  if (!open) return null;

  const q = query.trim().toUpperCase();
  const local = markets.filter((m) => !q || m.market.includes(q) || m.name.toUpperCase().includes(q));
  // Show matches from the loaded list right away, then the backend's results.
  const rows = results ? [...local, ...results.filter((r) => !local.some((l) => l.market === r.market))] : local;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-20" onClick={onClose}>
      <div className="w-full max-w-lg border border-ex-border-strong bg-ex-panel shadow-xl" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pairs, e.g. ETH or solana"
          className="w-full border-b border-ex-border bg-ex-bg px-3 py-2.5 text-[13px] text-ex-text outline-none placeholder:text-ex-muted"
        />
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-3 py-1.5 text-[11px] text-ex-muted">
          <span>Pair</span>
          <span className="text-right">Last</span>
          <span className="w-16 text-right">24h</span>
          <span className="w-16 text-right">Volume</span>
        </div>
        <ul className="max-h-[400px] overflow-y-auto">
          {rows.length === 0 && (
            <li className="px-3 py-4 text-center text-[12px] text-ex-muted">
              {markets.length === 0 || searching ? "Loading…" : "No matches"}
            </li>
          )}
          {rows.map((m) => (
            <li key={m.market}>
              <button
                type="button"
                onClick={() => {
                  setSymbol(m.market);
                  onClose();
                }}
                className={`grid w-full grid-cols-[1fr_auto_auto_auto] gap-x-4 px-3 py-2 text-left font-mono text-[12px] hover:bg-ex-panel-2 ${
                  m.market === symbol ? "text-ex-accent" : "text-ex-text"
                }`}
              >
                <span className="truncate">
                  {m.base}
                  <span className="text-ex-muted">/{m.quote}</span>
                  <span className="ml-2 font-sans text-[11px] text-ex-muted">{m.name}</span>
                </span>
                <span className="text-right">{formatPrice(m.last)}</span>
                <span className={`w-16 text-right ${m.changePct24h >= 0 ? "text-ex-up" : "text-ex-down"}`}>
                  {m.changePct24h >= 0 ? "+" : ""}
                  {m.changePct24h.toFixed(2)}%
                </span>
                <span className="w-16 text-right text-ex-muted">{formatCompact(m.volume24h)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
