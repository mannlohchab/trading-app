import { useEffect, useMemo, useState, type FormEvent } from "react";
import { pairName } from "../lib/api/market";
import { COMMISSION_RATE, MARKET_BUFFER, orderProblem, requiredCash, sellableQuantity } from "../lib/api/paper";
import { formatQty, formatUsd } from "../lib/format";
import { baseAsset, quoteAsset } from "../lib/marketAssets";
import { floorToStep, stepFor } from "../lib/pricePrecision";
import { useTradingStore } from "../lib/trading-store";
import type { OrderType, Side } from "../lib/types";

type SizeUnit = "quote" | "base";

const TYPE_LABEL: Record<OrderType, string> = { market: "Market", limit: "Limit", stop: "Stop" };

export function OrderForm() {
  const {
    symbol,
    ticker,
    account,
    accountError,
    instrument,
    pricePrecision,
    quantityPrecision,
    placeOrder,
    orderSideFocus,
    setOrderSideFocus,
  } = useTradingStore();

  const base = baseAsset(symbol);
  const quote = quoteAsset(symbol);
  const [side, setSide] = useState<Side>(orderSideFocus);
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>("quote");
  const [amount, setAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const step = instrument?.stepSize ?? stepFor(quantityPrecision);
  const bid = ticker.bid || ticker.last;
  const ask = ticker.ask || ticker.last;
  const last = ticker.last;

  useEffect(() => setSide(orderSideFocus), [orderSideFocus]);

  // New pair: clear prices so they reseed from its quote.
  useEffect(() => {
    setLimitPrice("");
    setStopPrice("");
    setAmount("");
    setError(null);
  }, [symbol]);

  useEffect(() => {
    if (last > 0) {
      setLimitPrice((prev) => prev || last.toFixed(pricePrecision));
      setStopPrice((prev) => prev || last.toFixed(pricePrecision));
    }
  }, [last, pricePrecision]);

  /** The price the order is expected to execute at, for sizing and cost estimates. */
  const refPrice =
    orderType === "limit"
      ? Number(limitPrice) || 0
      : orderType === "stop"
        ? Number(stopPrice) || 0
        : side === "buy"
          ? ask
          : bid;

  const quantity = useMemo(() => {
    const value = Number(amount) || 0;
    const raw = sizeUnit === "base" ? value : refPrice > 0 ? value / refPrice : 0;
    return floorToStep(raw, step);
  }, [amount, sizeUnit, refPrice, step]);

  const qty = Number(quantity) || 0;
  const notional = qty * refPrice;
  const fee = notional * COMMISSION_RATE;
  const cost = side === "buy" ? requiredCash(orderType, refPrice, qty) : notional - fee;
  const available = account?.available ?? 0;
  const sellable = sellableQuantity(account, symbol);

  const selectSide = (next: Side) => {
    setSide(next);
    setOrderSideFocus(next);
    setError(null);
  };

  /** Size to a share of what's available: cash for buys, holdings for sells. */
  const fillPercent = (pct: number) => {
    if (side === "sell") {
      const q = floorToStep((sellable * pct) / 100, step);
      setSizeUnit("base");
      setAmount(q);
      return;
    }
    const multiplier = (orderType === "market" ? 1 + MARKET_BUFFER : 1) * (1 + COMMISSION_RATE);
    const spend = ((available * pct) / 100) / multiplier;
    setSizeUnit("quote");
    setAmount(spend > 0 ? (Math.floor(spend * 100) / 100).toFixed(2) : "");
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = orderProblem({
      side,
      type: orderType,
      quantity,
      price: limitPrice,
      stopPrice,
      last,
      quoteTime: ticker.time,
      account,
      symbol,
    });
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    try {
      const result = await placeOrder({
        side,
        type: orderType,
        quantity,
        ...(orderType === "limit" ? { price: limitPrice } : {}),
        ...(orderType === "stop" ? { stopPrice } : {}),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const filled = result.order?.status === "filled";
      setFlash(
        `${side === "buy" ? "Buy" : "Sell"} ${formatQty(qty)} ${base} ${
          filled ? `filled at ${formatUsd(result.order?.avgFillPrice ?? refPrice, pricePrecision)}` : "placed"
        }`,
      );
      setAmount("");
      window.setTimeout(() => setFlash(null), 2500);
    } finally {
      setSubmitting(false);
    }
  }

  const sellActive = side === "sell";

  return (
    <form onSubmit={onSubmit} className="flex h-full min-h-0 flex-col overflow-hidden bg-ex-panel">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-ex-border px-3">
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-ex-panel-2 text-[8px] font-bold text-ex-text">
          {base.slice(0, 3)}
        </span>
        <span className="text-[14px] font-semibold tracking-tight text-ex-text">{symbol}</span>
        <span className="truncate text-[12px] text-ex-muted">{pairName(symbol)}</span>
        <span className="ml-auto rounded bg-ex-panel-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ex-muted">
          Paper
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {/* Sell / Buy */}
        <div className="grid grid-cols-2 overflow-hidden rounded-lg">
          <button
            type="button"
            onClick={() => selectSide("sell")}
            className={`flex flex-col items-start px-3 py-2.5 text-left transition-colors ${
              sellActive ? "bg-ex-down-dim text-ex-down" : "bg-ex-bg text-ex-text hover:bg-ex-panel-2"
            }`}
          >
            <span className="text-[13px] font-semibold">Sell</span>
            <span className="font-mono text-[12px] font-medium tabular-nums">
              {bid > 0 ? formatUsd(bid, pricePrecision) : "—"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => selectSide("buy")}
            className={`flex flex-col items-end px-3 py-2.5 text-right transition-colors ${
              !sellActive ? "bg-ex-up-dim text-ex-up" : "bg-ex-bg text-ex-text hover:bg-ex-panel-2"
            }`}
          >
            <span className="text-[13px] font-semibold">Buy</span>
            <span className="font-mono text-[12px] font-medium tabular-nums">
              {ask > 0 ? formatUsd(ask, pricePrecision) : "—"}
            </span>
          </button>
        </div>

        {/* Market / Limit / Stop */}
        <div className="flex gap-4 border-b border-ex-border text-[13px]">
          {(["market", "limit", "stop"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setOrderType(t);
                setError(null);
              }}
              className={`-mb-px border-b-2 pb-2 ${
                orderType === t
                  ? "border-ex-text font-semibold text-ex-text"
                  : "border-transparent text-ex-muted hover:text-ex-text"
              }`}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        {orderType === "limit" && (
          <PriceInput label="Limit price" value={limitPrice} onChange={setLimitPrice} unit={quote} />
        )}
        {orderType === "stop" && (
          <PriceInput
            label={side === "buy" ? "Trigger price (above market)" : "Trigger price (below market)"}
            value={stopPrice}
            onChange={setStopPrice}
            unit={quote}
          />
        )}

        {/* Size */}
        <div className="space-y-1.5">
          <span className="text-[12px] text-ex-muted">{sizeUnit === "quote" ? `Amount (${quote})` : `Quantity (${base})`}</span>
          <div className="flex overflow-hidden rounded-lg border border-ex-border focus-within:border-ex-border-strong">
            <input
              value={amount}
              inputMode="decimal"
              placeholder="0.00"
              onChange={(e) => setAmount(e.target.value.replace(",", "."))}
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-[14px] text-ex-text outline-none placeholder:text-ex-muted"
            />
            <button
              type="button"
              title="Switch unit"
              onClick={() => {
                if (sizeUnit === "quote") {
                  setAmount(quantity);
                  setSizeUnit("base");
                } else {
                  setAmount(notional > 0 ? notional.toFixed(2) : "");
                  setSizeUnit("quote");
                }
              }}
              className="flex items-center gap-1 border-l border-ex-border bg-ex-bg px-3 text-[12px] text-ex-text"
            >
              {sizeUnit === "quote" ? quote : base}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M7 8h11l-2-2M17 16H6l2 2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => fillPercent(pct)}
                className="rounded border border-ex-border py-1 text-[11px] text-ex-muted hover:bg-ex-panel-2 hover:text-ex-text"
              >
                {pct}%
              </button>
            ))}
          </div>
          <p className="text-[11px] text-ex-muted">
            {sizeUnit === "quote" ? `≈ ${quantity || "0"} ${base}` : `≈ ${formatUsd(notional, 2)} ${quote}`}
          </p>
        </div>

        {/* Order info */}
        <div className="space-y-2">
          <div className="text-[13px] font-semibold text-ex-text">Order info</div>
          <InfoRow
            label="Available"
            value={
              side === "buy"
                ? account
                  ? `${formatUsd(available, 2)} ${quote}`
                  : "—"
                : `${formatQty(sellable)} ${base}`
            }
          />
          <InfoRow label={side === "buy" ? "Est. cost" : "Est. proceeds"} value={qty > 0 ? `${formatUsd(cost, 2)} ${quote}` : "—"} />
          <InfoRow label="Fee (0.1%)" value={qty > 0 ? `${formatUsd(fee, 2)} ${quote}` : "—"} />
          {orderType === "market" && side === "buy" && (
            <p className="text-[11px] text-ex-muted">
              Market buys reserve a 2% price buffer; unused cash is released on fill.
            </p>
          )}
        </div>

        {accountError && !account && <p className="text-[12px] text-ex-down">{accountError}</p>}
        {error && (
          <p className="text-[12px] text-ex-down" role="alert">
            {error}
          </p>
        )}
        {flash && <p className="text-[12px] text-ex-up">{flash}</p>}
      </div>

      {/* Submit */}
      <div className="shrink-0 border-t border-ex-border p-3">
        <button
          type="submit"
          disabled={submitting}
          className={`flex w-full flex-col items-center rounded-lg py-3 text-white hover:brightness-110 disabled:opacity-60 ${
            sellActive ? "bg-ex-down" : "bg-ex-up"
          }`}
        >
          <span className="text-[16px] font-bold leading-tight">
            {submitting ? "Submitting…" : sellActive ? `Sell ${base}` : `Buy ${base}`}
          </span>
          {!submitting && (
            <span className="text-[11px] font-medium opacity-90">
              {quantity || "0"} {base} · {TYPE_LABEL[orderType].toUpperCase()}
            </span>
          )}
        </button>
      </div>
    </form>
  );
}

function PriceInput({
  label,
  value,
  onChange,
  unit,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-[12px] text-ex-muted">{label}</span>
      <div className="flex overflow-hidden rounded-lg border border-ex-border focus-within:border-ex-border-strong">
        <input
          value={value}
          inputMode="decimal"
          onChange={(e) => onChange(e.target.value.replace(",", "."))}
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-[14px] text-ex-text outline-none"
        />
        <span className="flex items-center px-3 text-[12px] text-ex-muted">{unit}</span>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-ex-muted">{label}</span>
      <span className="font-mono font-semibold text-ex-text">{value}</span>
    </div>
  );
}
