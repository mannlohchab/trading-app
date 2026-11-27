import type { CandleType } from "klinecharts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Interval } from "../../lib/types";
import { MAIN_INDICATORS, SUB_INDICATORS } from "./indicator-catalog";

const INTERVALS: Interval[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"];

const CHART_TYPES: { id: CandleType; label: string }[] = [
  { id: "candle_solid", label: "Candles" },
  { id: "candle_stroke", label: "Hollow candles" },
  { id: "candle_up_stroke", label: "Hollow up candles" },
  { id: "candle_down_stroke", label: "Hollow down candles" },
  { id: "ohlc", label: "Bars (OHLC)" },
  { id: "area", label: "Area" },
];

type MenuId = "type" | "indicators";

interface ChartToolbarProps {
  interval: Interval;
  onIntervalChange: (interval: Interval) => void;
  chartType: CandleType;
  onChartTypeChange: (type: CandleType) => void;
  activeIndicators: string[];
  onToggleIndicator: (name: string) => void;
  onSnapshot: () => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export function ChartToolbar({
  interval,
  onIntervalChange,
  chartType,
  onChartTypeChange,
  activeIndicators,
  onToggleIndicator,
  onSnapshot,
  fullscreen = false,
  onToggleFullscreen,
}: ChartToolbarProps) {
  const [menu, setMenu] = useState<MenuId | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (menu === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menu]);

  const toggleMenu = (id: MenuId) =>
    setMenu((current) => (current === id ? null : id));

  return (
    <div
      ref={barRef}
      className="relative z-20 flex h-9 shrink-0 items-center gap-0.5 border-b border-chart-border bg-chart-panel px-2 text-xs text-chart-text"
    >
      <div className="flex items-center">
        {INTERVALS.map((iv) => (
          <button
            key={iv}
            type="button"
            onClick={() => onIntervalChange(iv)}
            className={`px-2 py-1 font-medium transition-colors ${
              interval === iv
                ? "text-ex-buy"
                : "text-chart-muted hover:text-chart-text"
            }`}
          >
            {iv}
          </button>
        ))}
      </div>

      <Sep />

      <div className="relative">
        <IconBtn
          label="Chart type"
          active={menu === "type"}
          onClick={() => toggleMenu("type")}
        >
          <CandlesIcon />
        </IconBtn>
        {menu === "type" && (
          <Menu>
            {CHART_TYPES.map((type) => (
              <MenuRow
                key={type.id}
                label={type.label}
                checked={chartType === type.id}
                onClick={() => {
                  onChartTypeChange(type.id);
                  setMenu(null);
                }}
              />
            ))}
          </Menu>
        )}
      </div>

      <Sep />

      <div className="relative">
        <button
          type="button"
          onClick={() => toggleMenu("indicators")}
          className={`flex items-center gap-1.5 rounded px-2 py-1 ${
            menu === "indicators"
              ? "bg-ex-panel-2 text-chart-text"
              : "text-chart-muted hover:bg-ex-panel-2 hover:text-chart-text"
          }`}
        >
          <IndicatorsIcon />
          <span className="font-medium">Indicators</span>
          {activeIndicators.length > 0 && (
            <span className="rounded bg-ex-panel-2 px-1 text-[10px] font-semibold text-chart-text">
              {activeIndicators.length}
            </span>
          )}
        </button>
        {menu === "indicators" && (
          <Menu className="max-h-[420px] w-64 overflow-y-auto">
            <MenuTitle>On the price chart</MenuTitle>
            {MAIN_INDICATORS.map((indicator) => (
              <MenuRow
                key={indicator.name}
                label={indicator.label}
                hint={indicator.name}
                checked={activeIndicators.includes(indicator.name)}
                onClick={() => onToggleIndicator(indicator.name)}
              />
            ))}
            <MenuTitle>In a separate pane</MenuTitle>
            {SUB_INDICATORS.map((indicator) => (
              <MenuRow
                key={indicator.name}
                label={indicator.label}
                hint={indicator.name}
                checked={activeIndicators.includes(indicator.name)}
                onClick={() => onToggleIndicator(indicator.name)}
              />
            ))}
          </Menu>
        )}
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <IconBtn
          label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          active={fullscreen}
          onClick={onToggleFullscreen}
        >
          {fullscreen ? (
            <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
          ) : (
            <path d="M8 3H4v4M16 3h4v4M8 21H4v-4M16 21h4v-4" />
          )}
        </IconBtn>
        <IconBtn label="Snapshot" onClick={onSnapshot}>
          <path d="M4 8h3l2-2h6l2 2h3v11H4V8z" />
          <circle cx="12" cy="13" r="3.5" />
        </IconBtn>
      </div>
    </div>
  );
}

function Menu({
  className = "w-56",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`absolute left-0 top-full z-30 mt-1 overflow-hidden rounded border border-chart-border bg-chart-panel py-1 shadow-lg ${className}`}
    >
      {children}
    </div>
  );
}

function MenuTitle({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-chart-muted">
      {children}
    </div>
  );
}

function MenuRow({
  label,
  hint,
  checked,
  onClick,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
        checked
          ? "bg-ex-panel-2 text-chart-text"
          : "text-chart-muted hover:bg-ex-panel-2 hover:text-chart-text"
      }`}
    >
      <span className="w-3 shrink-0 text-ex-buy">{checked ? "✓" : ""}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="font-mono text-[10px] opacity-60">{hint}</span>}
    </button>
  );
}

function Sep() {
  return <div className="mx-1.5 h-4 w-px bg-chart-border" />;
}

function IconBtn({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded ${
        active
          ? "bg-ex-panel-2 text-chart-text"
          : "text-chart-muted hover:bg-ex-panel-2 hover:text-chart-text"
      }`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}

function CandlesIcon() {
  return (
    <>
      <rect x="5" y="7" width="4" height="10" rx="0.5" fill="currentColor" stroke="none" />
      <path d="M7 4v3M7 17v3" />
      <rect x="15" y="5" width="4" height="10" rx="0.5" fill="currentColor" stroke="none" />
      <path d="M17 3v2M17 15v5" />
    </>
  );
}

function IndicatorsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 16l4-8 3 5 3-3 4 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
