import { dispose, init } from "klinecharts";
import type {
  CandleType,
  Chart,
  Crosshair,
  KLineData,
  Overlay,
  OverlayCreate,
  OverlayEvent,
} from "klinecharts";
import { useCallback, useEffect, useRef, useState } from "react";
import { EXCHANGE, fetchCandles } from "../../lib/api/market";
import { subscribeCandles } from "../../lib/api/socket";
import { useTradingStore } from "../../lib/trading-store";
import type { Candle } from "../../lib/types";
import { ChartLegend, type OhlcSnapshot } from "./ChartLegend";
import { ChartToolbar } from "./ChartToolbar";
import {
  DrawingObjectBar,
  barAnchor,
  drawingFromOverlay,
  overlayStylePatch,
  type DrawingObjectState,
} from "./DrawingObjectBar";
import { DrawingToolbar } from "./DrawingToolbar";
import {
  CHART_THEME,
  DRAWING_LABEL_STYLES,
  chartStyles,
} from "./chart-theme";
import { registerCustomOverlays } from "./drawing-tools";
import { DEFAULT_INDICATORS, isMainIndicator } from "./indicator-catalog";
import { INTERVAL_PERIOD, intervalMs, periodToInterval } from "./period";

const CANDLE_LIMIT = 500;
const MAIN_PANE_ID = "candle_pane";

/** Overlay groups so orders, fills and user drawings can be cleared apart. */
const ORDER_GROUP = "open-orders";
const FILL_GROUP = "fills";
const DRAWING_GROUP = "drawings";

/** Backend candles and KLineChart both use millisecond open times. */
function toKLineData(candle: Candle): KLineData {
  return {
    timestamp: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  };
}

function toOhlc(bar: KLineData): OhlcSnapshot {
  return {
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume ?? 0,
  };
}

export function TradingChart() {
  const {
    interval,
    setInterval,
    ticker,
    setOrderSideFocus,
    fills,
    openOrders,
    stopOrders,
    symbol,
    pricePrecision,
  } = useTradingStore();

  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  /** Live-bar sink handed to us by KLineChart's data loader. */
  const pushBarRef = useRef<((bar: KLineData) => void) | null>(null);
  /** The bar currently being shaped by the ticker poll. */
  const formingRef = useRef<KLineData | null>(null);
  const drawnIdsRef = useRef<string[]>([]);
  const appliedIntervalRef = useRef(interval);
  /** Symbol and precision the chart was last given, so unchanged values don't reload bars. */
  const appliedSymbolRef = useRef({ ticker: symbol, pricePrecision });

  const [ohlc, setOhlc] = useState<OhlcSnapshot | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [chartType, setChartType] = useState<CandleType>("candle_solid");
  const [seriesVisible, setSeriesVisible] = useState(true);
  const [indicators, setIndicators] = useState<string[]>(DEFAULT_INDICATORS);
  const [tool, setTool] = useState<string | null>(null);
  const [magnet, setMagnet] = useState(false);
  const [selectedDrawing, setSelectedDrawing] =
    useState<DrawingObjectState | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const barHoverRef = useRef(false);

  useEffect(() => {
    const onFsChange = () => {
      setFullscreen(document.fullscreenElement === panelRef.current);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    const el = panelRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
        await el.requestFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch (err) {
      console.warn("fullscreen failed", err);
    }
  };

  // Create the chart once; data arrives through the loader below.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    registerCustomOverlays();
    const chart = init(el, { styles: chartStyles() });
    if (!chart) return;
    chartRef.current = chart;
    // Re-assert drawing label contrast after init — HMR can leave a chart
    // instance with stale overlay.text from an earlier theme merge.
    chart.setStyles({
      overlay: { text: { ...DRAWING_LABEL_STYLES } },
    });

    chart.setSymbol({ ...appliedSymbolRef.current, volumePrecision: 4 });
    chart.setPeriod(INTERVAL_PERIOD[appliedIntervalRef.current]);
    chart.setDataLoader({
      // KLineChart's `forward` means older data (prepended; `timestamp` is the first bar) and
      // `backward` newer data (appended). `init` loads the latest bars, `forward` pages into history
      // with `endTime` just before the oldest bar, and newer bars only ever arrive live.
      getBars: async ({ type, timestamp, symbol: info, period, callback }) => {
        if (type !== "init" && type !== "forward") {
          callback([], false);
          return;
        }
        const endTime = type === "forward" && timestamp !== null ? timestamp - 1 : undefined;
        try {
          const { candles } = await fetchCandles(info.ticker, periodToInterval(period), CANDLE_LIMIT, endTime);
          const bars = candles.map(toKLineData);
          if (type === "init") {
            const last = bars.at(-1);
            formingRef.current = last ? { ...last } : null;
            if (last) setOhlc(toOhlc(last));
          }
          callback(bars, { forward: bars.length >= CANDLE_LIMIT, backward: false });
        } catch (err) {
          console.warn("candles fetch failed", err);
          callback([], false);
        }
      },
      subscribeBar: ({ callback }) => {
        pushBarRef.current = callback;
      },
      unsubscribeBar: () => {
        pushBarRef.current = null;
        formingRef.current = null;
      },
    });

    for (const name of DEFAULT_INDICATORS) {
      chart.createIndicator(name);
    }

    const onCrosshair = (data?: unknown) => {
      const bar =
        (data as Crosshair | undefined)?.kLineData ?? chart.getDataList().at(-1);
      setOhlc(bar ? toOhlc(bar) : null);
    };
    chart.subscribeAction("onCrosshairChange", onCrosshair);

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);

    return () => {
      observer.disconnect();
      chart.unsubscribeAction("onCrosshairChange", onCrosshair);
      dispose(chart);
      chartRef.current = null;
      pushBarRef.current = null;
      formingRef.current = null;
      drawnIdsRef.current = [];
    };
  }, []);

  // Interval change reloads bars through the data loader.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || appliedIntervalRef.current === interval) return;
    appliedIntervalRef.current = interval;
    formingRef.current = null;
    chart.setPeriod(INTERVAL_PERIOD[interval]);
  }, [interval]);

  useEffect(() => {
    const chart = chartRef.current;
    const applied = appliedSymbolRef.current;
    if (!chart || (applied.ticker === symbol && applied.pricePrecision === pricePrecision)) return;
    appliedSymbolRef.current = { ticker: symbol, pricePrecision };
    formingRef.current = null;
    chart.setSymbol({ ticker: symbol, pricePrecision, volumePrecision: 4 });
  }, [symbol, pricePrecision]);

  // The forming candle (with real volume) from the market stream.
  useEffect(() => {
    return subscribeCandles([`${EXCHANGE}:${symbol}:${interval}`], (event) => {
      const push = pushBarRef.current;
      if (!push || event.symbol !== symbol || event.timeframe !== interval) return;
      const bar = toKLineData(event.candle);
      const current = formingRef.current;
      if (current && bar.timestamp < current.timestamp) return; // Late update for an older bar.
      formingRef.current = bar;
      push(bar);
      setOhlc((prev) => (prev === null || prev.close !== bar.close ? toOhlc(bar) : prev));
    });
  }, [symbol, interval]);

  useEffect(() => {
    chartRef.current?.setStyles({ candle: { type: chartType } });
  }, [chartType]);

  useEffect(() => {
    const color = (shown: string) => (seriesVisible ? shown : "rgba(0,0,0,0)");
    chartRef.current?.setStyles({
      candle: {
        bar: {
          upColor: color(CHART_THEME.up),
          downColor: color(CHART_THEME.down),
          noChangeColor: color(CHART_THEME.text),
          upBorderColor: color(CHART_THEME.up),
          downBorderColor: color(CHART_THEME.down),
          noChangeBorderColor: color(CHART_THEME.text),
          upWickColor: color(CHART_THEME.up),
          downWickColor: color(CHART_THEME.down),
          noChangeWickColor: color(CHART_THEME.text),
        },
      },
    });
  }, [seriesVisible]);

  // Between candle updates, move the forming bar with the streamed last price, rolling over at
  // each period boundary. Volume comes from the candle stream; the ticker carries no size.
  useEffect(() => {
    const push = pushBarRef.current;
    const last = ticker.last;
    if (!push || !(last > 0) || ticker.symbol !== symbol) return;

    const span = intervalMs(interval);
    const current = formingRef.current;
    const bucket = span === null ? (current?.timestamp ?? 0) : Math.floor(Date.now() / span) * span;
    if (current === null && span === null) return;
    const next: KLineData =
      current === null || bucket > current.timestamp
        ? {
            timestamp: bucket,
            open: last,
            high: last,
            low: last,
            close: last,
            volume: 0,
          }
        : {
            ...current,
            close: last,
            high: Math.max(current.high, last),
            low: Math.min(current.low, last),
          };

    formingRef.current = next;
    push(next);
  }, [ticker.last, ticker.symbol, symbol, interval]);

  // Resting limit orders as full-width price lines.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    chart.removeOverlay({ groupId: ORDER_GROUP });
    const creates: OverlayCreate[] = [...openOrders, ...stopOrders]
      .filter(
        (order) =>
          order.symbol === symbol && order.price !== null && order.price > 0,
      )
      .map((order) => {
        const color = order.side === "buy" ? CHART_THEME.up : CHART_THEME.down;
        return {
          name: "priceLine",
          groupId: ORDER_GROUP,
          lock: true,
          points: [{ value: order.price as number }],
          styles: {
            line: { color, style: "dashed" as const },
            text: { color: "#ffffff", backgroundColor: color },
          },
        };
      });
    if (creates.length > 0) chart.createOverlay(creates);
  }, [openOrders, stopOrders, symbol]);

  // The user's own trades, annotated on the bar they landed in.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    chart.removeOverlay({ groupId: FILL_GROUP });
    const creates: OverlayCreate[] = fills
      .filter((fill) => fill.symbol === symbol && fill.price > 0)
      .map((fill) => {
        const buy = fill.side === "buy";
        const color = buy ? CHART_THEME.up : CHART_THEME.down;
        return {
          name: "simpleAnnotation",
          groupId: FILL_GROUP,
          lock: true,
          points: [{ timestamp: fill.time, value: fill.price }],
          extendData: `${buy ? "B" : "S"} ${fill.size}`,
          styles: {
            line: { color },
            polygon: { color, borderColor: color },
            text: { color: "#ffffff", backgroundColor: color },
          },
        };
      });
    if (creates.length > 0) chart.createOverlay(creates);
  }, [fills, symbol]);

  const showDrawingBar = useCallback((overlay: Overlay) => {
    if (overlay.groupId !== DRAWING_GROUP) return;
    const chart = chartRef.current;
    const box = containerRef.current;
    if (!chart || !box) return;
    const { x, y } = barAnchor(chart, overlay, box);
    selectedIdRef.current = overlay.id;
    setSelectedDrawing({ ...drawingFromOverlay(overlay), x, y });
  }, []);

  const hideDrawingBar = useCallback((id?: string) => {
    if (id && selectedIdRef.current !== id) return;
    selectedIdRef.current = null;
    setSelectedDrawing(null);
  }, []);

  const drawingHandlers = useCallback(
    () => ({
      onDrawEnd: (event: OverlayEvent<unknown>) => {
        setTool(null);
        showDrawingBar(event.overlay);
      },
      onSelected: (event: OverlayEvent<unknown>) => {
        showDrawingBar(event.overlay);
      },
      onDeselected: (event: OverlayEvent<unknown>) => {
        window.setTimeout(() => {
          if (barHoverRef.current) return;
          hideDrawingBar(event.overlay.id);
        }, 0);
      },
      onRemoved: (event: OverlayEvent<unknown>) => {
        hideDrawingBar(event.overlay.id);
      },
      onPressedMoveEnd: (event: OverlayEvent<unknown>) => {
        if (selectedIdRef.current === event.overlay.id) {
          showDrawingBar(event.overlay);
        }
      },
    }),
    [hideDrawingBar, showDrawingBar],
  );

  const selectTool = useCallback(
    (name: string) => {
      const chart = chartRef.current;
      if (!chart) return;
      setTool(name);
      hideDrawingBar();
      const id = chart.createOverlay({
        name,
        groupId: DRAWING_GROUP,
        mode: magnet ? "weak_magnet" : "normal",
        styles: {
          line: { color: CHART_THEME.drawing },
          text: { ...DRAWING_LABEL_STYLES },
        },
        ...drawingHandlers(),
      });
      if (typeof id === "string") drawnIdsRef.current.push(id);
    },
    [drawingHandlers, hideDrawingBar, magnet],
  );

  const selectCursor = useCallback(() => {
    const chart = chartRef.current;
    const pending = drawnIdsRef.current.at(-1);
    // Drop the overlay that was armed but never finished.
    if (chart && pending !== undefined) {
      const [overlay] = chart.getOverlays({ id: pending });
      if (overlay && overlay.currentStep !== -1) {
        chart.removeOverlay({ id: pending });
        drawnIdsRef.current.pop();
      }
    }
    setTool(null);
  }, []);

  const undoDrawing = useCallback(() => {
    const id = drawnIdsRef.current.pop();
    if (id !== undefined) {
      hideDrawingBar(id);
      chartRef.current?.removeOverlay({ id });
    }
    setTool(null);
  }, [hideDrawingBar]);

  const clearDrawings = useCallback(() => {
    chartRef.current?.removeOverlay({ groupId: DRAWING_GROUP });
    drawnIdsRef.current = [];
    hideDrawingBar();
    setTool(null);
  }, [hideDrawingBar]);

  const applyDrawing = useCallback((next: DrawingObjectState) => {
    chartRef.current?.overrideOverlay({
      id: next.id,
      styles: overlayStylePatch(next),
    });
    setSelectedDrawing(next);
  }, []);

  const lockDrawing = useCallback(() => {
    const current = selectedDrawing;
    if (!current) return;
    const locked = !current.locked;
    chartRef.current?.overrideOverlay({ id: current.id, lock: locked });
    setSelectedDrawing({ ...current, locked });
  }, [selectedDrawing]);

  const deleteDrawing = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    chartRef.current?.removeOverlay({ id });
    drawnIdsRef.current = drawnIdsRef.current.filter((item) => item !== id);
    hideDrawingBar(id);
  }, [hideDrawingBar]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || selectedDrawing === null) return;
    const tick = () => {
      const id = selectedIdRef.current;
      const box = containerRef.current;
      if (!id || !box) return;
      const [overlay] = chart.getOverlays({ id });
      if (!overlay) return;
      const { x, y } = barAnchor(chart, overlay, box);
      setSelectedDrawing((prev) =>
        prev && prev.id === id ? { ...prev, x, y } : prev,
      );
    };
    chart.subscribeAction("onScroll", tick);
    chart.subscribeAction("onZoom", tick);
    chart.subscribeAction("onVisibleRangeChange", tick);
    return () => {
      chart.unsubscribeAction("onScroll", tick);
      chart.unsubscribeAction("onZoom", tick);
      chart.unsubscribeAction("onVisibleRangeChange", tick);
    };
  }, [selectedDrawing?.id]);

  useEffect(() => {
    if (selectedDrawing === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if ((event.target as HTMLElement | null)?.closest("input")) return;
      event.preventDefault();
      deleteDrawing();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteDrawing, selectedDrawing]);

  const toggleIndicator = useCallback(
    (name: string) => {
      const chart = chartRef.current;
      if (!chart) return;
      if (indicators.includes(name)) {
        chart.removeIndicator({ name });
        setIndicators((active) => active.filter((item) => item !== name));
        return;
      }
      if (isMainIndicator(name)) {
        chart.createIndicator({ name, paneId: MAIN_PANE_ID }, true);
      } else {
        chart.createIndicator(name);
      }
      setIndicators((active) => [...active, name]);
    },
    [indicators],
  );

  const snapshot = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const url = chart.getConvertPictureUrl(true, "png", CHART_THEME.panel);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${symbol}-${interval}.png`;
    link.click();
  }, [interval, symbol]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden border-r border-ex-border bg-chart-bg">
      <DrawingToolbar
        activeTool={tool}
        onSelectTool={selectTool}
        onCursor={selectCursor}
        magnet={magnet}
        onMagnetChange={setMagnet}
        onUndo={undoDrawing}
        onClear={clearDrawings}
      />
      <div
        ref={panelRef}
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-chart-panel"
      >
        <ChartToolbar
          interval={interval}
          onIntervalChange={setInterval}
          chartType={chartType}
          onChartTypeChange={setChartType}
          activeIndicators={indicators}
          onToggleIndicator={toggleIndicator}
          onSnapshot={snapshot}
          fullscreen={fullscreen}
          onToggleFullscreen={() => void toggleFullscreen()}
        />
        <div className="relative min-h-0 flex-1 bg-chart-panel">
          <ChartLegend
            symbol={ticker.symbol}
            interval={interval}
            ohlc={ohlc}
            bid={ticker.bid}
            ask={ticker.ask}
            precision={pricePrecision}
            seriesVisible={seriesVisible}
            onToggleSeries={() => setSeriesVisible((v) => !v)}
            onTradeClick={setOrderSideFocus}
          />
          <div ref={containerRef} className="absolute inset-0 bg-chart-panel" />
          {selectedDrawing && (
            <DrawingObjectBar
              drawing={selectedDrawing}
              onChange={applyDrawing}
              onLock={lockDrawing}
              onDelete={deleteDrawing}
              onPointerEnter={() => {
                barHoverRef.current = true;
              }}
              onPointerLeave={() => {
                barHoverRef.current = false;
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
