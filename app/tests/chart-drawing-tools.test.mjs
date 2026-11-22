import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as drawingModule from '../src/components/charts/chartDrawingTools.ts';
import * as indicatorModule from '../src/components/charts/chartIndicators.ts';
import * as liveModule from '../src/components/charts/chartLive.ts';
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
  const window = { parent: { postMessage: data => messages.push(JSON.parse(data)) } };
  // Programmatic .click() on the menu's buttons runs their click handler, as in a browser.
  for (const id of ['draw-undo', 'draw-redo', 'draw-hide']) get(id).click = function () { if (!this.disabled) this.fire('click'); };
  runInNewContext(drawingToolsScript, {
    document,
    window,
    chart: { timeScale: () => timeScale, applyOptions: value => options.push(value), subscribeCrosshairMove() {}, subscribeClick: callback => { chartClicked = callback; } },
    series: { coordinateToPrice: y => 200 - y / transform.y, priceToCoordinate: price => (200 - price) * transform.y },
    candles: [{ time: 1000 }, { time: 1060 }, { time: 1120 }, { time: 4600 }],
    initialDrawings, drawingKey: 'BINANCE:BTCUSDT:5m',
    requestAnimationFrame: callback => frames.push(callback), ResizeObserver: class { observe() {} },
  });
  const flush = () => { while (frames.length) frames.shift()(); };
  flush();
  return {
    get, transform, options, messages, flush,
    click: (x, y) => chartClicked?.({ point: { x, y } }),
    select: tool => buttons.find(button => button.dataset.drawTool === tool).fire('click'),
    // Taps reach the drawing code through the chart library's click event (mouse and touch alike).
    tap: (x, y) => chartClicked?.({ point: { x, y } }),
    redraw: () => { rangeChanged(); flush(); },
    drawings: () => messages.filter(m => m.type === 'chart-drawings').at(-1).drawings,
    state: () => messages.filter(m => m.type === 'chart-drawings').at(-1),
    acks: () => messages.filter(m => m.type === 'chart-command-ack'),
    command: command => window.chartDrawingCommand(command),
  };
}

test('app commands arm a tool, report it back, and ignore a repeated command id', () => {
  const ui = setup();
  assert.equal(ui.state().activeTool, 'cursor');
  assert.equal(ui.command({ id: 1, type: 'set-drawing-tool', tool: 'trend' }), true);
  assert.equal(ui.state().activeTool, 'trend');
  assert.equal(ui.get('drawing-menu').hidden, true);
  // The same command delivered twice (message + injected call) must not act twice.
  assert.equal(ui.command({ id: 1, type: 'set-drawing-tool', tool: 'trend' }), false);
  ui.tap(10, 100); ui.tap(30, 50);
  assert.equal(ui.drawings().length, 1);
  assert.equal(ui.state().activeTool, 'cursor');
  assert.equal(ui.state().canUndo, true);
  assert.equal(ui.command({ id: 2, type: 'set-drawing-tool', tool: 'not-a-tool' }), false);
  // Each accepted command is acknowledged once, so the app can log what the page actually did.
  assert.deepEqual(ui.acks().map(a => [a.id, a.command, a.activeTool]), [[1, 'set-drawing-tool', 'trend']]);
});

test('the in-chart pencil opens the toolbar, shows the armed tool, and needs no app messages', () => {
  const ui = setup();
  ui.get('tools-toggle').fire('click');
  assert.equal(ui.get('drawing-menu').hidden, false);
  ui.select('rectangle');
  assert.equal(ui.get('drawing-hint').hidden, false);
  assert.equal(ui.get('hint-title').textContent, 'Rectangle');
  ui.tap(10, 100); ui.tap(30, 50);
  assert.deepEqual(ui.drawings()[0].tool, 'rectangle');
  assert.equal(ui.get('drawing-hint').hidden, true);
});

test('a tap reported as pointer, touch and click events places one point, and quick second taps still count', () => {
  const ui = setup();
  ui.select('trend');
  const layer = ui.get('draw-layer');
  // One physical tap, as some WebViews report it: pointerup + touchend + click at the same spot.
  layer.fire('pointerup', { clientX: 10, clientY: 100 });
  layer.fire('touchend', { changedTouches: [{ clientX: 10, clientY: 100 }] });
  layer.fire('click', { clientX: 10, clientY: 100 });
  assert.equal(ui.drawings().length, 0, 'the first tap only sets the start point');
  // The end point arrives right away (a fast second tap) via touch only.
  layer.fire('touchend', { changedTouches: [{ clientX: 30, clientY: 50 }] });
  assert.equal(ui.drawings().length, 1);
  assert.deepEqual(ui.drawings()[0].points.map(p => p.price), [100, 150]);
});

test('the app pencil toggles the in-chart toolbar, and cancels an armed tool', () => {
  const ui = setup();
  ui.command({ id: 1, type: 'toggle-drawing-tools' });
  assert.equal(ui.get('drawing-menu').hidden, false);
  ui.command({ id: 2, type: 'toggle-drawing-tools' });
  assert.equal(ui.get('drawing-menu').hidden, true);
  ui.command({ id: 3, type: 'set-drawing-tool', tool: 'trend' });
  ui.command({ id: 4, type: 'toggle-drawing-tools' });
  assert.equal(ui.state().activeTool, 'cursor');
  assert.equal(ui.get('drawing-menu').hidden, false);
});

test('hiding drawings keeps the button icon and updates its label', () => {
  const ui = setup([{ tool: 'horizontal', points: [{ time: 1060, price: 120 }] }]);
  ui.get('draw-hide').fire('click');
  assert.equal(ui.get('draw-hide').attributes['aria-label'], 'Show drawings');
  assert.equal(ui.get('draw-hide').textContent, undefined);
});

test('app commands hide, undo and clear drawings', () => {
  const ui = setup([{ tool: 'horizontal', points: [{ time: 1060, price: 120 }] }]);
  ui.command({ id: 1, type: 'drawing-hidden', hidden: true });
  assert.equal(ui.state().hidden, true);
  ui.command({ id: 2, type: 'drawing-hidden', hidden: false });
  assert.equal(ui.state().hidden, false);
  ui.command({ id: 3, type: 'drawing-clear' });
  assert.equal(ui.drawings().length, 0);
  ui.command({ id: 4, type: 'drawing-undo' });
  assert.equal(ui.drawings().length, 1);
});

test('picking a tool closes the menu so it never covers the chart', () => {
  const ui = setup();
  ui.get('tools-toggle').fire('click');
  assert.equal(ui.get('drawing-menu').hidden, false);
  for (const tool of ['trend', 'horizontal', 'vertical', 'rectangle', 'fib', 'measure']) {
    ui.get('drawing-menu').hidden = false;
    ui.select(tool);
    assert.equal(ui.get('drawing-menu').hidden, true, tool);
    assert.equal(ui.get('drawing-hint').hidden, false, tool);
  }
});

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
  const loadChartModule = (request) => {
    const name = String(request);
    if (name.includes('chartIndicators')) return indicatorModule;
    if (name.includes('chartLive')) return liveModule;
    if (name.includes('chartDrawingTools')) return drawingModule;
    throw new Error('unexpected module ' + name);
  };
  runInNewContext(compiled, { exports, require: loadChartModule });
  for (const type of ['candle', 'line', 'area']) {
    for (const indicators of [[], ['MA', 'EMA', 'BB', 'VOL'], ['RSI', 'MACD', 'ATR', 'ST', 'SESSION']]) {
      const html = exports.buildChartHtml([{ time: 1000, open: 100, high: 105, low: 99, close: 103, volume: 500 }], type, indicators, 'BTCUSDT');
      const scripts = [...html.matchAll(/<script>\s*([\s\S]*?)<\/script>/g)].map(match => match[1]);
      assert.ok(scripts.some(script => script.includes('chartDrawingCommand')));
      assert.ok(html.includes('setMarkers') && html.includes('chart-trades') && html.includes('applyTradeMarks'));
      assert.equal(html.includes('[bytecode]'), false);
      for (const script of scripts) assert.doesNotThrow(() => new Script(script));
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
