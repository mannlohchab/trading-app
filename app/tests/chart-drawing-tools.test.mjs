import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as drawingModule from '../src/components/charts/chartDrawingTools.ts';
import { Script, runInNewContext } from 'node:vm';
import { drawingToolsScript } from '../src/components/charts/chartDrawingTools.ts';

function setup(initialDrawings = []) {
  const nodes = new Map();
  class Element {
    constructor() { this.attributes = {}; this.events = {}; this.children = []; this.hidden = true; this.clientHeight = 400; this.classList = { toggle() {} }; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, callback) { this.events[name] = callback; }
    appendChild(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    getBoundingClientRect() { return { left: 0, top: 0 }; }
    fire(name, values = {}) { this.events[name]?.({ currentTarget: this, preventDefault() {}, stopPropagation() {}, ...values }); }
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const buttons = ['cursor', 'trend', 'horizontal', 'vertical', 'rectangle', 'fib', 'measure'].map(tool => {
    const element = new Element(); element.dataset = { drawTool: tool }; return element;
  });
  const messages = [], frames = [], options = [];
  const transform = { x: 1, y: 1, offset: 0 };
  let rangeChanged, chartClicked;
  const timeScale = {
    coordinateToLogical: x => (x - transform.offset) / (10 * transform.x),
    logicalToCoordinate: logical => logical * 10 * transform.x + transform.offset,
    width: () => 300, height: () => 25,
    subscribeVisibleLogicalRangeChange: callback => { rangeChanged = callback; },
  };
  const document = { getElementById: get, querySelectorAll: () => buttons, createElementNS: () => new Element(), addEventListener() {} };
  runInNewContext(drawingToolsScript, {
    document,
    window: { parent: { postMessage: data => messages.push(JSON.parse(data)) } },
    chart: { timeScale: () => timeScale, applyOptions: value => options.push(value), subscribeCrosshairMove() {}, subscribeClick: callback => { chartClicked = callback; } },
    series: { coordinateToPrice: y => 200 - y / transform.y, priceToCoordinate: price => (200 - price) * transform.y },
    candles: [{ time: 1000 }, { time: 1060 }, { time: 1120 }, { time: 4600 }],
    initialDrawings, drawingKey: 'BINANCE:BTCUSDT:5m', tip: { style: {} },
    requestAnimationFrame: callback => frames.push(callback), ResizeObserver: class { observe() {} },
  });
  const flush = () => { while (frames.length) frames.shift()(); };
  flush();
  return {
    get, transform, options, messages, flush,
    click: (x, y) => chartClicked?.({ point: { x, y } }),
    select: tool => buttons.find(button => button.dataset.drawTool === tool).fire('click'),
    tap: (x, y) => get('draw-layer').fire('pointerup', { clientX: x, clientY: y }),
    redraw: () => { rangeChanged(); flush(); },
    drawings: () => messages.at(-1).drawings,
  };
}

test('horizontal and vertical tools place market-anchored lines and restore chart navigation', () => {
  const ui = setup();
  ui.select('horizontal');
  assert.equal(ui.options.at(-1).handleScroll, false);
  ui.tap(10, 80);
  assert.deepEqual(ui.drawings()[0], { tool: 'horizontal', points: [{ time: 1060, price: 120 }] });
  assert.equal(ui.options.at(-1).handleScroll, true);
  ui.select('vertical'); ui.tap(20, 60);
  assert.equal(ui.drawings()[1].points[0].time, 1120);
});

test('two-point tools complete only on second tap; cancellation leaves no drawing', () => {
  for (const tool of ['trend', 'rectangle', 'fib', 'measure']) {
    const ui = setup(); ui.select(tool); ui.tap(5, 100);
    assert.equal(ui.drawings().length, 0);
    ui.tap(25, 50);
    assert.deepEqual(ui.drawings()[0], { tool, points: [{ time: 1030, price: 100 }, { time: 2860, price: 150 }] });
    if (tool === 'fib') assert.equal(ui.get('draw-layer').children.filter(child => child.attributes.x1 !== undefined).length, 7);
    if (tool === 'measure') assert.ok(ui.get('draw-layer').children.some(child => child.textContent === '+50.00 (50.00%) · 2 bars'));
    ui.select(tool); ui.tap(10, 20); ui.get('draw-cancel').fire('click');
    assert.equal(ui.drawings().length, 1);
  }
});

test('drawings retain price/time alignment after zoom, pan and scale changes', () => {
  const ui = setup(); ui.select('trend'); ui.tap(10, 100); ui.tap(25, 50);
  ui.transform.x = 2; ui.transform.y = 1.5; ui.transform.offset = -5; ui.redraw();
  const line = ui.get('draw-layer').children[0];
  assert.equal(line.attributes.x1, '15'); assert.equal(line.attributes.x2, '45');
  assert.equal(line.attributes.y1, '150'); assert.equal(line.attributes.y2, '75');
});

test('undo, redo, hide, clear confirmation, and restored drawings work', () => {
  const ui = setup(); ui.select('horizontal'); ui.tap(10, 100);
  ui.get('draw-undo').fire('click'); assert.equal(ui.drawings().length, 0);
  ui.get('draw-redo').fire('click'); assert.equal(ui.drawings().length, 1);
  ui.get('draw-hide').fire('click'); assert.equal(ui.get('draw-layer').children.length, 0);
  ui.get('draw-hide').fire('click'); assert.ok(ui.get('draw-layer').children.length > 0);
  const restored = setup(ui.drawings()); assert.ok(restored.get('draw-layer').children.length > 0);
  ui.get('draw-clear').fire('click'); assert.equal(ui.drawings().length, 1);
  ui.get('clear-no').fire('click'); assert.equal(ui.drawings().length, 1);
  ui.get('draw-clear').fire('click'); ui.get('clear-yes').fire('click');
  assert.equal(ui.drawings().length, 0); assert.equal(ui.get('draw-layer').children.length, 0);
  assert.equal(ui.get('draw-undo').disabled, false);
  ui.get('draw-undo').fire('click'); assert.equal(ui.drawings().length, 1);
});


test('generated chart embeds valid drawing code for every chart type and indicator layout', () => {
  const source = readFileSync(new URL('../src/components/charts/chartHtml.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: () => drawingModule });
  for (const type of ['candle', 'line', 'area']) {
    for (const indicators of [[], ['MA', 'EMA', 'BB', 'VOL']]) {
      const html = exports.buildChartHtml([{ time: 1000, open: 100, high: 105, low: 99, close: 103, volume: 500 }], type, indicators, 'BTCUSDT');
      const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
      assert.doesNotThrow(() => new Script(script));
      assert.ok(html.includes('id="tools-toggle"'));
    }
  }
});


test('clicking each drawing selects it, and deleting removes only that drawing with undo support', () => {
  for (const tool of ['horizontal', 'vertical', 'trend', 'rectangle', 'fib', 'measure']) {
    const ui = setup();
    ui.select('horizontal'); ui.tap(10, 300);
    ui.select(tool); ui.tap(10, 100);
    if (!['horizontal', 'vertical'].includes(tool)) ui.tap(30, 50);
    ui.click(tool === 'vertical' ? 10 : 20, tool === 'horizontal' ? 100 : 75);
    assert.equal(ui.get('drawing-editor').hidden, false, tool);
    ui.get('draw-delete').fire('click');
    assert.equal(ui.drawings().length, 1);
    assert.equal(ui.drawings()[0].points[0].price, -100);
    assert.equal(ui.get('drawing-editor').hidden, true);
    ui.get('draw-undo').fire('click'); assert.equal(ui.drawings().length, 2);
    ui.get('draw-redo').fire('click'); assert.equal(ui.drawings().length, 1);
  }
});

test('selected drawing color changes persist, render, and support undo without recoloring other drawings', () => {
  const ui = setup();
  ui.select('horizontal'); ui.tap(10, 100);
  ui.select('rectangle'); ui.tap(10, 200); ui.tap(30, 150);
  ui.click(20, 175);
  ui.get('draw-color-teal').fire('click');
  assert.equal(ui.drawings()[1].color, '#0EA57A');
  assert.equal(ui.drawings()[0].color, undefined);
  assert.ok(ui.get('draw-layer').children.some(child => child.attributes.fill === '#0EA57A1A'));
  const restored = setup(ui.drawings());
  assert.ok(restored.get('draw-layer').children.some(child => child.attributes.stroke === '#0EA57A'));
  ui.get('draw-undo').fire('click'); assert.equal(ui.drawings()[1].color, undefined);
  ui.get('draw-redo').fire('click'); assert.equal(ui.drawings()[1].color, '#0EA57A');
});

test('selection follows zoom, chooses topmost overlaps, ignores hidden drawings and clears on blank taps', () => {
  const ui = setup();
  ui.select('trend'); ui.tap(10, 100); ui.tap(30, 50);
  ui.select('trend'); ui.tap(10, 100); ui.tap(30, 50);
  ui.transform.x = 2; ui.transform.y = 2; ui.redraw();
  ui.click(40, 150); ui.get('draw-color-teal').fire('click');
  assert.equal(ui.drawings()[1].color, '#0EA57A');
  assert.equal(ui.drawings()[0].color, undefined);
  ui.click(200, 300); assert.equal(ui.get('drawing-editor').hidden, true);
  ui.click(40, 150); ui.get('draw-hide').fire('click');
  assert.equal(ui.get('drawing-editor').hidden, true);
  ui.click(40, 150); assert.equal(ui.get('drawing-editor').hidden, true);
});
