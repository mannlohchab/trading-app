import { createElement, useCallback, useEffect, useMemo, useRef } from 'react';
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
};

export type { ChartCandle };

export function TradingChart({ candles, chartType, indicators, height = 360, symbol = '', pricePrecision = 2, currency = 'INR', drawingKey, drawingStore }: Props) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const webview = useRef<WebView<{}>>(null);
  const initialCandles = useRef(candles);
  const latestCandles = useRef(candles);
  latestCandles.current = candles;
  const sendCandles = useCallback(() => {
    const data = JSON.stringify({type:'market-candles',candles:latestCandles.current});
    iframe.current?.contentWindow?.postMessage(data, '*');
    webview.current?.postMessage(data);
  }, []);
  useEffect(() => { sendCandles(); }, [candles, sendCandles]);
  const saveDrawings = useCallback((data: unknown) => {
    if (typeof data !== 'string') return;
    try {
      const message = JSON.parse(data);
      if (message.type === 'chart-drawings' && message.key === drawingKey && Array.isArray(message.drawings)) {
        drawingStore.current[drawingKey] = message.drawings;
      }
    } catch { /* Ignore messages unrelated to chart drawings. */ }
  }, [drawingKey, drawingStore]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const receive = (event: MessageEvent) => {
      if (event.source === iframe.current?.contentWindow) saveDrawings(event.data);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [saveDrawings]);

  const html = useMemo(
    () => buildChartHtml(initialCandles.current, chartType, indicators, symbol, drawingStore.current[drawingKey] ?? [], drawingKey, pricePrecision, currency),
    [chartType, indicators, symbol, drawingKey, drawingStore, pricePrecision, currency],
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
          onLoad: sendCandles,
          style: { width: '100%', height: '100%', border: 'none', background: '#fff' },
          sandbox: 'allow-scripts',
        })}
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView<{}>
        ref={webview}
        onLoadEnd={sendCandles}
        onMessage={event => saveDrawings(event.nativeEvent.data)}
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
  wrap: { backgroundColor: '#fff', overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: '#fff' },
});
