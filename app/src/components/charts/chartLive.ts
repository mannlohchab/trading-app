/** Runs inside the chart document; updates data without replacing the WebView/iframe. */
export const liveChartScript = `
  const LIVE_UP = typeof UP === 'string' ? UP : '#089981', LIVE_DOWN = typeof DOWN === 'string' ? DOWN : '#F23645';
  const LIVE_UP_VOL = typeof UP_VOL === 'string' ? UP_VOL : 'rgba(8,153,129,0.45)', LIVE_DOWN_VOL = typeof DOWN_VOL === 'string' ? DOWN_VOL : 'rgba(242,54,69,0.45)';
  window.updateCandles = function(next) {
    if (!Array.isArray(next) || !next.length) return;
    const range = chart.timeScale().getVisibleLogicalRange();
    const previousLast = candles.length - 1;
    const followingLiveCandle = range && previousLast >= 0 && range.to >= previousLast && range.to <= previousLast + 3;
    candles.splice(0, candles.length, ...next);
    series.setData(chartType === 'candle'
      ? candles.map(c => ({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close}))
      : candles.map(c => ({time:c.time,value:c.close})));
    const latest = candles[candles.length - 1];
    if (priceLine) priceLine.applyOptions({price:latest.close,color:latest.close >= latest.open ? LIVE_UP : LIVE_DOWN});
    if (volumeSeries) volumeSeries.setData(candles.map(c => ({time:c.time,value:c.volume,color:c.close>=c.open?LIVE_UP_VOL:LIVE_DOWN_VOL})));
    for (const indicator of indicatorSeries) indicator.series.setData(indicator.values());
    const added = candles.length - 1 - previousLast;
    if (range) chart.timeScale().setVisibleLogicalRange(followingLiveCandle && added ? {from: range.from + added, to: range.to + added} : range);
    if (typeof scheduleDrawings === 'function') scheduleDrawings();
    if (typeof window.renderLatestLegend === 'function') window.renderLatestLegend();
    if (typeof updateCountdown === 'function') updateCountdown();
  };
  function receiveCandles(event) {
    try { const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data && data.type === 'market-candles') window.updateCandles(data.candles);
    } catch (_) {}
  }
  window.addEventListener('message', receiveCandles);
  document.addEventListener('message', receiveCandles);
`;
