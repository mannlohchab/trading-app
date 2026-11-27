import { useState } from "react";
import { useNavigate } from "react-router";
import { pairName } from "../lib/api/market";
import { displayName, useAuth } from "../lib/auth";
import { formatCompact, formatPct, formatUsd } from "../lib/format";
import { useTradingStore } from "../lib/trading-store";
import { MarketPicker } from "./MarketPicker";

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[10px] text-ex-muted">{label}</span>
      <span className="font-mono text-[12px] text-ex-text">{children}</span>
    </div>
  );
}

export function TopNav() {
  const { symbol, ticker, live, pricePrecision, account } = useTradingStore();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [marketsOpen, setMarketsOpen] = useState(false);
  const up = ticker.changePct24h >= 0;
  const hasQuote = ticker.symbol === symbol && ticker.last > 0;

  const onLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-ex-border bg-ex-panel px-3">
      <span className="text-[15px] font-bold tracking-tight text-ex-text">ZRS</span>

      {/* Pair + 24h stats */}
      <button
        type="button"
        onClick={() => setMarketsOpen(true)}
        className="flex items-center gap-2 rounded px-2 py-1 hover:bg-ex-panel-2"
        title="Change market"
      >
        <span className="flex flex-col items-start leading-tight">
          <span className="text-[14px] font-semibold text-ex-text">{symbol}</span>
          <span className="text-[10px] text-ex-muted">{pairName(symbol)}</span>
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-ex-muted">
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      <div className="flex items-center gap-5">
        <div className="flex items-center gap-1.5">
          <span className={`font-mono text-[16px] font-semibold ${up ? "text-ex-up" : "text-ex-down"}`}>
            {hasQuote ? formatUsd(ticker.last, pricePrecision) : "—"}
          </span>
          <span
            title={live ? "Live stream" : "Delayed (reconnecting)"}
            className={`size-1.5 rounded-full ${live ? "bg-ex-up" : "bg-ex-muted"}`}
          />
        </div>
        {hasQuote && (
          <div className="hidden items-center gap-5 md:flex">
            <Stat label="24h change">
              <span className={up ? "text-ex-up" : "text-ex-down"}>
                {ticker.change24h >= 0 ? "+" : ""}
                {formatUsd(ticker.change24h, pricePrecision)} ({formatPct(ticker.changePct24h)})
              </span>
            </Stat>
            <Stat label="24h high">{formatUsd(ticker.high24h, pricePrecision)}</Stat>
            <Stat label="24h low">{formatUsd(ticker.low24h, pricePrecision)}</Stat>
            <span className="hidden xl:contents">
              <Stat label="24h volume (USDT)">{formatCompact(ticker.quoteVolume24h)}</Stat>
            </span>
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3 text-xs">
        {account && (
          <div className="hidden font-mono text-[11px] text-ex-muted sm:block">
            Paper USDT <span className="text-ex-text">{formatUsd(account.available, 2)}</span>
          </div>
        )}
        {user && (
          <span className="hidden max-w-[180px] truncate text-[12px] text-ex-muted md:inline" title={user.email}>
            {displayName(user)}
          </span>
        )}
        <button
          type="button"
          onClick={() => void onLogout()}
          className="rounded border border-ex-border px-3 py-1.5 text-[12px] font-medium text-ex-text hover:bg-ex-panel-2"
        >
          Log Out
        </button>
      </div>
      <MarketPicker open={marketsOpen} onClose={() => setMarketsOpen(false)} />
    </header>
  );
}
