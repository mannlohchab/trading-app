import { useState, type ReactNode } from "react";
import { pairName } from "../../lib/api/market";
import { formatUsd } from "../../lib/format";
import type { Side } from "../../lib/types";

const BUY = "var(--color-ex-up)";


export interface OhlcSnapshot {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartLegendProps {
  symbol: string;
  interval: string;
  ohlc: OhlcSnapshot | null;
  bid: number;
  ask: number;
  /** Decimals the pair is quoted with. */
  precision: number;
  seriesVisible: boolean;
  onToggleSeries: () => void;
  onTradeClick: (side: Side) => void;
}

export function ChartLegend({
  symbol,
  interval,
  ohlc,
  bid,
  ask,
  precision,
  seriesVisible,
  onToggleSeries,
  onTradeClick,
}: ChartLegendProps) {
  const up = ohlc ? ohlc.close >= ohlc.open : true;
  const color = up ? "text-ex-up" : "text-ex-down";
  const [valuesVisible, setValuesVisible] = useState(true);
  const [ticketOpen, setTicketOpen] = useState(true);

  const name = pairName(symbol);
  const spread = bid > 0 && ask > 0 ? Math.max(0, ask - bid) : 0;
  const change = ohlc ? ohlc.close - ohlc.open : 0;
  const changePct =
    ohlc && ohlc.open !== 0 ? (change / ohlc.open) * 100 : 0;

  return (
    <div className="pointer-events-none absolute left-2 top-1.5 z-10 flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-chart-muted">
        <span className="inline-flex items-center gap-1.5 font-medium text-chart-text">
          <CoinBadge symbol={symbol} />
          {name}
          <span className="font-normal text-chart-muted">
            · {interval} · {symbol}
          </span>
        </span>

        <span className="pointer-events-auto inline-flex items-center overflow-hidden rounded-sm bg-[#1e222d]">
          <IconBtn
            label={seriesVisible ? "Hide series" : "Show series"}
            active={seriesVisible}
            onClick={onToggleSeries}
          >
            {seriesVisible ? <EyeIcon /> : <EyeOffIcon />}
          </IconBtn>
          <IconBtn
            label={valuesVisible ? "Hide OHLC" : "Show OHLC"}
            active={valuesVisible}
            onClick={() => setValuesVisible((v) => !v)}
          >
            <WaveIcon />
          </IconBtn>
        </span>

        {ohlc && valuesVisible && (
          <>
            <OhlcLabel letter="O" precision={precision} value={ohlc.open} color={color} />
            <OhlcLabel letter="H" precision={precision} value={ohlc.high} color={color} />
            <OhlcLabel letter="L" precision={precision} value={ohlc.low} color={color} />
            <OhlcLabel letter="C" precision={precision} value={ohlc.close} color={color} />
            <span className={`font-mono ${color}`}>
              {formatDelta(change, precision)} ({formatDelta(changePct, 2)}%)
            </span>
          </>
        )}
      </div>

      {ticketOpen && (
        <div className="pointer-events-auto flex items-center gap-1.5">
          <TradeBtn
            precision={precision}
            side="sell"
            price={bid}
            onClick={() => onTradeClick("sell")}
          />
          <span className="min-w-[28px] text-center text-[11px] text-chart-text">
            {formatUsd(spread, precision)}
          </span>
          <TradeBtn
            precision={precision}
            side="buy"
            price={ask}
            onClick={() => onTradeClick("buy")}
          />
        </div>
      )}

      <button
        type="button"
        title={ticketOpen ? "Collapse ticket" : "Expand ticket"}
        aria-label={ticketOpen ? "Collapse ticket" : "Expand ticket"}
        onClick={() => setTicketOpen((open) => !open)}
        className="pointer-events-auto flex h-[18px] w-[18px] items-center justify-center rounded-[3px] border border-chart-border bg-chart-bg text-chart-muted hover:text-chart-text"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {ticketOpen ? (
            <path d="M2.5 4.5 6 8l3.5-3.5" />
          ) : (
            <path d="M2.5 7.5 6 4l3.5 3.5" />
          )}
        </svg>
      </button>
    </div>
  );
}

function OhlcLabel({
  letter,
  value,
  color,
  precision,
}: {
  letter: string;
  value: number;
  color: string;
  precision: number;
}) {
  return (
    <span className={color}>
      {letter} <span className="font-mono">{formatUsd(value, precision)}</span>
    </span>
  );
}

function TradeBtn({
  side,
  price,
  precision,
  onClick,
}: {
  side: Side;
  price: number;
  precision: number;
  onClick: () => void;
}) {
  const buy = side === "buy";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-[88px] flex-col items-center rounded-[4px] border bg-transparent px-3 py-1 leading-tight hover:bg-white/5"
      style={{
        borderColor: buy ? BUY : "var(--color-ex-down)",
        color: buy ? BUY : "var(--color-ex-down)",
      }}
    >
      <span className="font-mono text-[15px] font-bold">
        {price > 0 ? formatUsd(price, precision) : "—"}
      </span>
      <span className="text-[10px] font-semibold tracking-wide">
        {buy ? "BUY" : "SELL"}
      </span>
    </button>
  );
}

function formatDelta(n: number, digits = 1): string {
  const body = formatUsd(Math.abs(n), digits);
  if (n > 0) return `+${body}`;
  if (n < 0) return `-${body}`;
  return body;
}

function IconBtn({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-[18px] w-[18px] items-center justify-center ${
        active ? "text-chart-muted" : "text-chart-muted/40"
      } hover:text-chart-text`}
    >
      {children}
    </button>
  );
}

function EyeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M3 3l18 18M10.6 10.6A3 3 0 0012 15a3 3 0 002.4-4.4M6.1 6.1C3.7 7.7 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.4 4.8-1.1M9.9 4.2C10.6 4.1 11.3 4 12 4c6.5 0 10 8 10 8a18 18 0 01-3.2 4.2" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M3 14c2.5-5 4.5-5 7 0s4.5 5 7 0 4.5-5 7 0" strokeLinecap="round" />
    </svg>
  );
}

function CoinBadge({ symbol }: { symbol: string }) {
  if (symbol === "BTCUSD") return <BtcLogo className="size-4 shrink-0" />;
  const base = symbol.endsWith("USD") ? symbol.slice(0, -3) : symbol;
  const label = base.slice(0, 3);
  return (
    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-ex-panel-2 text-[7px] font-bold text-chart-text">
      {label}
    </span>
  );
}

function BtcLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      aria-hidden
      focusable="false"
    >
      <circle cx="16" cy="16" r="16" fill="#F7931A" />
      <path
        fill="#fff"
        d="M22.5 14.1c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.6-.4-.7 2.6c-.4-.1-.9-.2-1.3-.3l.7-2.6-1.6-.4-.7 2.7c-.4-.1-.7-.2-1-.3l-2.2-.5-.4 1.7s1.2.3 1.2.3c.6.2.8.6.7 1l-.7 2.9c0 0 .1 0 .2.1h-.2l-1 4.1c-.1.2-.3.5-.7.4 0 0-1.2-.3-1.2-.3l-.8 1.8 2.1.5c.4.1.8.2 1.1.3l-.7 2.8 1.6.4.7-2.7c.4.1.9.2 1.3.3l-.7 2.7 1.6.4.7-2.8c2.9.5 5 .3 5.9-2.3.8-2.1 0-3.3-1.6-4.1 1.1-.3 2-1 2.2-2.4zm-4 5.5c-.5 2.2-4.2.9-5.4.7l1-3.8c1.2.3 4.9.9 4.4 3.1zm.5-5.6c-.5 2-3.5.9-4.5.7l.9-3.4c1 .2 4.1.7 3.6 2.7z"
      />
    </svg>
  );
}
