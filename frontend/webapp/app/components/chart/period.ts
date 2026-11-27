import type { Period } from "klinecharts";
import type { Interval } from "../../lib/types";

/** UI interval → KLineChart period. Keys match the backend's candle timeframes. */
export const INTERVAL_PERIOD: Record<Interval, Period> = {
  "1m": { span: 1, type: "minute" },
  "5m": { span: 5, type: "minute" },
  "15m": { span: 15, type: "minute" },
  "30m": { span: 30, type: "minute" },
  "1h": { span: 1, type: "hour" },
  "4h": { span: 4, type: "hour" },
  "1d": { span: 1, type: "day" },
  "1w": { span: 1, type: "week" },
};

const MINUTE_MS = 60_000;

/**
 * Bar duration in ms, used to roll the forming candle over from ticker updates. Null for weekly
 * bars: Binance weeks start on Monday, which epoch-aligned buckets would miss.
 */
export function intervalMs(interval: Interval): number | null {
  const period = INTERVAL_PERIOD[interval];
  switch (period.type) {
    case "minute":
      return period.span * MINUTE_MS;
    case "hour":
      return period.span * 60 * MINUTE_MS;
    case "day":
      return period.span * 24 * 60 * MINUTE_MS;
    default:
      return null;
  }
}

/**
 * KLineChart hands the period (not our interval) to `getBars`, so map back.
 * Falls back to the default interval for anything we don't serve.
 */
export function periodToInterval(period: Period): Interval {
  const match = (Object.keys(INTERVAL_PERIOD) as Interval[]).find((key) => {
    const candidate = INTERVAL_PERIOD[key];
    return candidate.span === period.span && candidate.type === period.type;
  });
  return match ?? "1h";
}
