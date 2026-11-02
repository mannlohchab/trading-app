import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {liveChartScript} from '../src/components/charts/chartLive.ts';
test('live chart replaces bars without resetting visible range and updates overlays',()=>{
  const calls=[];const range={from:4,to:8};
  const context={window:{addEventListener:()=>{}},document:{addEventListener:()=>{}},candles:[{time:1,close:10}],chartType:'line',
    chart:{timeScale:()=>({getVisibleLogicalRange:()=>range,setVisibleLogicalRange:r=>calls.push(['range',r])})},
    series:{setData:d=>calls.push(['data',d])},priceLine:{applyOptions:o=>calls.push(['price',o.price])},
    volumeSeries:null,indicatorSeries:[{series:{setData:d=>calls.push(['indicator',d])},values:()=>[1]}]};
  vm.runInNewContext(liveChartScript,context);
  context.window.updateCandles([{time:1,open:10,close:11,high:12,low:10,volume:1},{time:2,open:11,close:12,high:12,low:11,volume:2}]);
  assert.equal(calls.find(c=>c[0]==='data')[1][1].value,12);
  assert.equal(calls.find(c=>c[0]==='range')[1],range);
  assert.equal(calls.find(c=>c[0]==='price')[1],12);
  assert.ok(calls.some(c=>c[0]==='indicator'));
});
test('a chart following the live candle keeps that candle in view when a new bar opens', () => {
  const calls = [];
  const context = { window: { addEventListener() {} }, document: { addEventListener() {} },
    candles: Array.from({ length: 10 }, (_, time) => ({ time, close: time })), chartType: 'candle',
    chart: { timeScale: () => ({ getVisibleLogicalRange: () => ({ from: 2, to: 9.8 }), setVisibleLogicalRange: range => calls.push(range) }) },
    series: { setData() {} }, priceLine: { applyOptions() {} }, volumeSeries: null, indicatorSeries: [] };
  vm.runInNewContext(liveChartScript, context);
  context.window.updateCandles(Array.from({ length: 11 }, (_, time) => ({ time, open: time, close: time, high: time, low: time, volume: 1 })));
  assert.equal(calls[0].from, 3);
  assert.equal(calls[0].to, 10.8);
});
