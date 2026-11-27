import { useState, type ReactNode } from "react";
import { formatDateTime, formatPct, formatPrice, formatQty, formatUsd } from "../lib/format";
import { useTradingStore } from "../lib/trading-store";
import type { Order, Side } from "../lib/types";

type Tab = "positions" | "open" | "stops" | "fills" | "history";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending", OPEN: "Open", PARTIALLY_FILLED: "Partly filled", FILLED: "Filled",
  CANCELLED: "Cancelled", REJECTED: "Rejected", EXPIRED: "Expired",
};

function SideCell({ side }: { side: Side }) {
  return <span className={side === "buy" ? "text-ex-up" : "text-ex-down"}>{side.toUpperCase()}</span>;
}

function Pnl({ value, suffix }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="text-ex-muted">—</span>;
  return (
    <span className={value >= 0 ? "text-ex-up" : "text-ex-down"}>
      {value >= 0 ? "+" : ""}
      {formatUsd(value, 2)}
      {suffix}
    </span>
  );
}

const typeLabel = (o: Order) => (o.type === "stop" ? "Stop" : o.type === "limit" ? "Limit" : "Market");

export function BottomPanel() {
  const { account, positions, openOrders, stopOrders, fills, orderHistory, cancelOrder, closePosition } =
    useTradingStore();
  const [tab, setTab] = useState<Tab>("positions");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (id: string, action: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(id);
    setActionError(null);
    const result = await action();
    if (!result.ok) setActionError(result.error ?? "Request failed");
    setBusy(null);
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "positions", label: "Positions", count: positions.length },
    { id: "open", label: "Open Orders", count: openOrders.length },
    { id: "stops", label: "Stop Orders", count: stopOrders.length },
    { id: "fills", label: "Fills", count: fills.length },
    { id: "history", label: "Order History", count: orderHistory.length },
  ];

  const cancelButton = (o: Order) =>
    o.cancellable ? (
      <button
        key="cancel"
        type="button"
        disabled={busy === o.id}
        onClick={() => void run(o.id, () => cancelOrder(o.id))}
        className="text-ex-muted hover:text-ex-down disabled:opacity-50"
      >
        {busy === o.id ? "Cancelling…" : "Cancel"}
      </button>
    ) : null;

  const openRows = (list: Order[]) =>
    list.map((o) => [
      formatDateTime(o.createdAt),
      o.symbol,
      <SideCell key="side" side={o.side} />,
      typeLabel(o),
      o.price != null ? formatPrice(o.price) : "Market",
      formatQty(o.size),
      o.filledSize > 0 ? formatQty(o.filledSize) : "—",
      cancelButton(o),
    ]);

  return (
    <div className="flex h-48 shrink-0 flex-col border-t border-ex-border bg-ex-panel">
      <div className="flex h-9 shrink-0 items-center gap-0 border-b border-ex-border px-1 text-xs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative px-3 py-2 ${
              tab === t.id
                ? "font-medium text-ex-text after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-ex-accent"
                : "text-ex-muted hover:text-ex-text"
            }`}
          >
            {t.label}
            {typeof t.count === "number" && t.count > 0 ? <span className="ml-1 text-ex-accent">{t.count}</span> : null}
          </button>
        ))}
        {actionError && <span className="ml-3 truncate text-[11px] text-ex-down">{actionError}</span>}
        {account && (
          <div className="ml-auto hidden items-center gap-4 pr-3 font-mono text-[11px] text-ex-muted lg:flex">
            <span>
              Equity <span className="text-ex-text">{account.equity !== null ? formatUsd(account.equity, 2) : "—"}</span>
            </span>
            <span>
              Available <span className="text-ex-text">{formatUsd(account.available, 2)}</span>
            </span>
            <span>
              uPnL <Pnl value={account.unrealizedPnl} />
            </span>
            <span>
              Realized <Pnl value={account.realizedPnl} />
            </span>
            <span>
              Return <span className={(account.totalPnlPct ?? 0) >= 0 ? "text-ex-up" : "text-ex-down"}>{formatPct(account.totalPnlPct)}</span>
            </span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "positions" && (
          <Table
            headers={["Symbol", "Side", "Size", "Entry", "Mark", "uPnL", ""]}
            empty="No open positions"
            rows={positions.map((p) => [
              p.symbol,
              <span key="side" className={p.side === "long" ? "text-ex-up" : "text-ex-down"}>
                {p.side.toUpperCase()}
              </span>,
              formatQty(p.size),
              formatPrice(p.entryPrice),
              p.markPrice !== null ? formatPrice(p.markPrice) : "—",
              <span key="pnl">
                <Pnl value={p.unrealizedPnl} />
                {p.unrealizedPnlPct !== null && <span className="ml-1 text-ex-muted">({formatPct(p.unrealizedPnlPct)})</span>}
              </span>,
              <button
                key="close"
                type="button"
                disabled={busy === p.id}
                onClick={() => void run(p.id, () => closePosition(p.id))}
                className="text-ex-muted hover:text-ex-down disabled:opacity-50"
              >
                {busy === p.id ? "Closing…" : "Close"}
              </button>,
            ])}
          />
        )}

        {tab === "open" && (
          <Table
            headers={["Time", "Symbol", "Side", "Type", "Price", "Size", "Filled", ""]}
            empty="No open orders"
            rows={openRows(openOrders)}
          />
        )}

        {tab === "stops" && (
          <Table
            headers={["Time", "Symbol", "Side", "Type", "Trigger", "Size", "Filled", ""]}
            empty="No stop orders"
            rows={openRows(stopOrders)}
          />
        )}

        {tab === "fills" && (
          <Table
            headers={["Time", "Symbol", "Side", "Price", "Size", "Value"]}
            empty="No fills yet"
            rows={fills.map((f) => [
              formatDateTime(f.time),
              f.symbol,
              <SideCell key="side" side={f.side} />,
              formatPrice(f.price),
              formatQty(f.size),
              formatUsd(f.price * f.size, 2),
            ])}
          />
        )}

        {tab === "history" && (
          <Table
            headers={["Time", "Symbol", "Side", "Type", "Price", "Avg fill", "Size", "Status"]}
            empty="No order history"
            rows={orderHistory.map((o) => [
              formatDateTime(o.updatedAt),
              o.symbol,
              <SideCell key="side" side={o.side} />,
              typeLabel(o),
              o.price != null ? formatPrice(o.price) : "Market",
              o.avgFillPrice != null ? formatPrice(o.avgFillPrice) : "—",
              formatQty(o.size),
              <span key="status" title={o.rejectReason ?? undefined} className={o.status === "rejected" ? "text-ex-down" : undefined}>
                {STATUS_LABEL[o.rawStatus] ?? o.rawStatus}
              </span>,
            ])}
          />
        )}
      </div>
    </div>
  );
}

function Table({ headers, rows, empty }: { headers: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) {
    return <div className="flex h-full items-center justify-center text-[13px] text-ex-muted">{empty}</div>;
  }

  return (
    <table className="w-full text-left text-xs">
      <thead className="sticky top-0 bg-ex-panel text-[10px] text-ex-muted">
        <tr>
          {headers.map((h, i) => (
            <th key={h || `action-${i}`} className="px-3 py-2 font-normal">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="font-mono text-ex-text">
        {rows.map((row, i) => (
          <tr key={i} className="border-t border-ex-border/70 hover:bg-ex-panel-2">
            {row.map((cell, j) => (
              <td key={j} className="px-3 py-1.5">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
