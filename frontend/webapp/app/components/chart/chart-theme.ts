import type { DeepPartial, Styles } from "klinecharts";

/** Dark chart palette — keep in sync with app.css chart tokens. */
export const CHART_THEME = {
  bg: "#000000",
  panel: "#000000",
  grid: "#1e222d",
  border: "#1e222d",
  text: "#787b86",
  crosshair: "#787b86",
  labelBg: "#1e222d",
  up: "#089981",
  down: "#f23645",
  volumeUp: "rgba(8, 153, 129, 0.22)",
  volumeDown: "rgba(242, 54, 69, 0.22)",
  separator: "#1e222d",
  separatorHover: "rgba(41, 98, 255, 0.25)",
  drawing: "#2962ff",
  drawingFill: "rgba(41, 98, 255, 0.18)",
} as const;

const FONT_FAMILY = "'Söhne', 'Sohne', sans-serif";

/**
 * Axis / price tags for drawings — white on solid drawing blue (same contrast
 * as the last-price mark). Passed both globally and on each createOverlay so
 * selected-tool labels never fall back to blue-on-blue.
 */
export const DRAWING_LABEL_STYLES = {
  style: "fill" as const,
  color: "#ffffff",
  backgroundColor: CHART_THEME.drawing,
  borderColor: CHART_THEME.drawing,
  borderSize: 1,
  borderRadius: 2,
  size: 12,
  family: FONT_FAMILY,
  weight: "500",
  paddingLeft: 4,
  paddingRight: 4,
  paddingTop: 3,
  paddingBottom: 3,
};

/**
 * KLineChart style overrides.
 *
 * The candle tooltip is off because `ChartLegend` already renders OHLC in the
 * top-left; indicator tooltips stay on so MA/BOLL/MACD values are readable.
 */
export function chartStyles(): DeepPartial<Styles> {
  return {
    grid: {
      show: true,
      horizontal: { color: CHART_THEME.grid, style: "solid", size: 1 },
      vertical: { color: CHART_THEME.grid, style: "solid", size: 1 },
    },
    candle: {
      type: "candle_solid",
      bar: {
        upColor: CHART_THEME.up,
        downColor: CHART_THEME.down,
        noChangeColor: CHART_THEME.text,
        upBorderColor: CHART_THEME.up,
        downBorderColor: CHART_THEME.down,
        noChangeBorderColor: CHART_THEME.text,
        upWickColor: CHART_THEME.up,
        downWickColor: CHART_THEME.down,
        noChangeWickColor: CHART_THEME.text,
      },
      priceMark: {
        high: { color: CHART_THEME.text, textSize: 10, textFamily: FONT_FAMILY },
        low: { color: CHART_THEME.text, textSize: 10, textFamily: FONT_FAMILY },
        last: {
          upColor: CHART_THEME.up,
          downColor: CHART_THEME.down,
          noChangeColor: CHART_THEME.text,
          line: { style: "dashed", size: 1 },
          text: { size: 11, family: FONT_FAMILY, color: "#ffffff" },
        },
      },
      // Hidden, but the candle pane still starts its indicator tooltips from
      // these offsets — push them clear of the floating ChartLegend.
      tooltip: { showRule: "none", offsetLeft: 8, offsetTop: 96 },
    },
    indicator: {
      lastValueMark: { show: false },
      tooltip: {
        showRule: "always",
        showType: "standard",
        offsetLeft: 8,
        offsetTop: 6,
        title: { show: true, color: CHART_THEME.text, size: 11, family: FONT_FAMILY },
        legend: { color: CHART_THEME.text, size: 11, family: FONT_FAMILY },
      },
    },
    xAxis: {
      axisLine: { color: CHART_THEME.border },
      tickLine: { color: CHART_THEME.border },
      tickText: { color: CHART_THEME.text, size: 11, family: FONT_FAMILY },
    },
    yAxis: {
      axisLine: { color: CHART_THEME.border },
      tickLine: { color: CHART_THEME.border },
      tickText: { color: CHART_THEME.text, size: 11, family: FONT_FAMILY },
    },
    separator: {
      size: 1,
      color: CHART_THEME.separator,
      activeBackgroundColor: CHART_THEME.separatorHover,
    },
    crosshair: {
      horizontal: {
        line: { style: "dashed", color: CHART_THEME.crosshair },
        text: { backgroundColor: CHART_THEME.labelBg, size: 11, family: FONT_FAMILY },
      },
      vertical: {
        line: { style: "dashed", color: CHART_THEME.crosshair },
        text: { backgroundColor: CHART_THEME.labelBg, size: 11, family: FONT_FAMILY },
      },
    },
    overlay: {
      point: {
        color: CHART_THEME.drawing,
        borderColor: CHART_THEME.drawingFill,
        activeColor: CHART_THEME.drawing,
        activeBorderColor: CHART_THEME.drawingFill,
      },
      line: { color: CHART_THEME.drawing, size: 1 },
      rect: {
        style: "stroke_fill",
        color: CHART_THEME.drawingFill,
        borderColor: CHART_THEME.drawing,
      },
      polygon: {
        style: "stroke_fill",
        color: CHART_THEME.drawingFill,
        borderColor: CHART_THEME.drawing,
      },
      circle: {
        style: "stroke_fill",
        color: CHART_THEME.drawingFill,
        borderColor: CHART_THEME.drawing,
      },
      text: { ...DRAWING_LABEL_STYLES },
    },
  };
}
