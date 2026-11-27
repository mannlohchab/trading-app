export interface IndicatorDef {
  /** KLineChart built-in indicator name (see `getSupportedIndicators()`). */
  name: string;
  label: string;
}

/** Overlaid on the candle pane. */
export const MAIN_INDICATORS: IndicatorDef[] = [
  { name: "MA", label: "Moving Average" },
  { name: "EMA", label: "Exponential MA" },
  { name: "SMA", label: "Smoothed MA" },
  { name: "BOLL", label: "Bollinger Bands" },
  { name: "BBI", label: "Bull & Bear Index" },
  { name: "SAR", label: "Parabolic SAR" },
];

/**
 * Each gets its own pane below the candles.
 *
 * AVP and EMV are built in but omitted: they need `turnover` per bar, which
 * `GET /api/v1/market/candles` does not return.
 */
export const SUB_INDICATORS: IndicatorDef[] = [
  { name: "VOL", label: "Volume" },
  { name: "MACD", label: "MACD" },
  { name: "RSI", label: "Relative Strength" },
  { name: "KDJ", label: "KDJ Stochastic" },
  { name: "WR", label: "Williams %R" },
  { name: "CCI", label: "Commodity Channel" },
  { name: "DMI", label: "Directional Movement" },
  { name: "OBV", label: "On Balance Volume" },
  { name: "TRIX", label: "TRIX" },
  { name: "ROC", label: "Rate of Change" },
  { name: "MTM", label: "Momentum" },
  { name: "BIAS", label: "Bias" },
  { name: "PSY", label: "Psychological Line" },
  { name: "BRAR", label: "BRAR" },
  { name: "CR", label: "CR" },
  { name: "DMA", label: "Different of MA" },
  { name: "VR", label: "Volume Ratio" },
  { name: "PVT", label: "Price Volume Trend" },
  { name: "AO", label: "Awesome Oscillator" },
];

export const DEFAULT_INDICATORS = ["VOL"];

export function isMainIndicator(name: string): boolean {
  return MAIN_INDICATORS.some((indicator) => indicator.name === name);
}
