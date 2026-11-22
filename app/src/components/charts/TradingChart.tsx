import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { buildChartHtml, type ChartCandle } from '@/components/charts/chartHtml';
import type { ChartDrawing } from '@/components/charts/chartDrawingTools';
import { Palette } from '@/constants/theme';

type Props = {
  candles: ChartCandle[];
  chartType: 'candle' | 'line' | 'area';
  indicators: string[];
  height?: number;
  symbol?: string;
  pricePrecision?: number;
  currency?: string;
  drawingKey: string;
  drawingStore: { current: Record<string, ChartDrawing[]> };
  exchange?: string;
  timeframe?: string;
  /** A drawing command for the chart; send a new `id` each time. */
  drawingCommand?: DrawingCommand;
  /** Called whenever the chart's drawing state changes (armed tool, undo/redo, hidden). */
  onDrawingState?: (state: DrawingState) => void;
  /** Pair name shown at the top-left of the chart. */
  title?: string;
  /** Filled paper buys and sells to mark on the chart. Updates arrive without reloading the page. */
  trades?: { time: number; price: number; side: 'BUY' | 'SELL' }[];
};

export type { ChartCandle };

/** Development-only trace of the app ↔ chart-page bridge (Metro log, prefix "[chart]"). */
const trace = (...args: unknown[]) => { if (__DEV__) console.log('[chart]', ...args); };

export type DrawingTool = ChartDrawing['tool'];
export type DrawingAction =
  | { type: 'set-drawing-tool'; tool: DrawingTool | 'cursor' }
  | { type: 'drawing-undo' | 'drawing-redo' | 'drawing-clear' | 'toggle-drawing-tools' }
  | { type: 'drawing-hidden'; hidden: boolean };
export type DrawingCommand = DrawingAction & { id: number };
export type DrawingState = { activeTool: DrawingTool | 'cursor'; canUndo: boolean; canRedo: boolean; hidden: boolean; count: number };

export function TradingChart({ candles, chartType, indicators, height = 360, symbol = '', pricePrecision = 2, currency = 'USD', drawingKey, drawingStore, exchange, timeframe, drawingCommand, onDrawingState, title, trades = [] }: Props) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const webview = useRef<WebView<{}>>(null);
  const initialCandles = useRef(candles);
  // Fixed for this chart's lifetime: a change would rebuild the page, reloading the WebView and
  // closing the drawing menu mid-drawing. A new pair or timeframe remounts the chart anyway.
  const [precision] = useState(pricePrecision);
  const latestCandles = useRef(candles);
  latestCandles.current = candles;
  const latestTrades = useRef(trades);
  latestTrades.current = trades;
  const sendCandles = useCallback(() => {
    const data = JSON.stringify({type:'market-candles',candles:latestCandles.current});
    iframe.current?.contentWindow?.postMessage(data, '*');
    webview.current?.postMessage(data);
  }, []);
  const sendTrades = useCallback(() => {
    const next = latestTrades.current;
    const data = JSON.stringify({ type: 'chart-trades', trades: next });
    iframe.current?.contentWindow?.postMessage(data, '*');
    webview.current?.postMessage(data);
    webview.current?.injectJavaScript(`window.updateTrades && window.updateTrades(${JSON.stringify(next)}); true;`);
  }, []);
  useEffect(() => { sendCandles(); }, [candles, sendCandles]);
  useEffect(() => { sendTrades(); }, [trades, sendTrades]);
  useEffect(() => {
    if (!drawingCommand) return;
    const data = JSON.stringify(drawingCommand);
    trace(`sending command ${drawingCommand.id}: ${drawingCommand.type}${'tool' in drawingCommand ? ` ${drawingCommand.tool}` : ''}`,
      Platform.OS === 'web' ? `(iframe ${iframe.current ? 'ready' : 'MISSING'})` : `(webview ${webview.current ? 'ready' : 'MISSING'})`);
    iframe.current?.contentWindow?.postMessage(data, '*');
    // On phones, also call the page directly: it doesn't depend on the WebView's message event,
    // and the command id makes the page ignore whichever copy arrives second.
    webview.current?.injectJavaScript(`window.chartDrawingCommand && window.chartDrawingCommand(${data}); true;`);
    webview.current?.postMessage(data);
  }, [drawingCommand]);
  const saveDrawings = useCallback((data: unknown) => {
    if (typeof data !== 'string') return;
    try {
      const message = JSON.parse(data);
      if (message.type === 'chart-drawings' && message.key === drawingKey && Array.isArray(message.drawings)) {
        trace(`page state: tool=${message.activeTool} drawings=${message.drawings.length} undo=${message.canUndo}`);
        drawingStore.current[drawingKey] = message.drawings;
        onDrawingState?.({
          activeTool: typeof message.activeTool === 'string' ? message.activeTool : 'cursor',
          canUndo: message.canUndo === true, canRedo: message.canRedo === true, hidden: message.hidden === true,
          count: message.drawings.length,
        });
      } else if (message.type === 'chart-drawings') {
        trace(`ignored page state for "${message.key}" (this chart is "${drawingKey}")`);
      } else if (message.type === 'chart-command-ack') {
        trace(`page ran command ${message.id}: ${message.command} → tool=${message.activeTool}`);
      } else if (message.type === 'chart-error') {
        console.warn('[chart] script error:', message.message);
      }
    } catch { /* Ignore messages unrelated to chart drawings. */ }
  }, [drawingKey, drawingStore, onDrawingState]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const receive = (event: MessageEvent) => {
      if (event.source === iframe.current?.contentWindow) saveDrawings(event.data);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [saveDrawings]);

  const html = useMemo(
    () => buildChartHtml(initialCandles.current, chartType, indicators, symbol, drawingStore.current[drawingKey] ?? [], drawingKey, precision, currency, { exchange, timeframe, title, trades: latestTrades.current }),
    [chartType, indicators, symbol, drawingKey, drawingStore, precision, currency, exchange, timeframe, title],
  );

  if (!candles.length) {
    return (
      <View style={[styles.wrap, { height }]}>
        <ActivityIndicator color={Palette.accent} />
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.wrap, { height }]}>
        {createElement('iframe', {
          title: 'Trading chart',
          ref: iframe,
          srcDoc: html,
          onLoad: () => { sendCandles(); sendTrades(); },
          style: { width: '100%', height: '100%', border: 'none', background: '#FFFFFF', display: 'block' },
          sandbox: 'allow-scripts',
        })}
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView<{}>
        ref={webview}
        onLoadEnd={() => { trace('page loaded'); sendCandles(); sendTrades(); }}
        onMessage={event => saveDrawings(event.nativeEvent.data)}
        onError={event => trace('webview error:', event.nativeEvent.description)}
        originWhitelist={['*']}
        source={{ html }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        setSupportMultipleWindows={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#FFFFFF', overflow: 'hidden', justifyContent: 'center' },
  webview: { flex: 1, backgroundColor: '#FFFFFF' },
});
