// Runs inside the chart iframe/WebView, so drawing coordinates use the chart's
// own price and time scales on both web and native.
export type ChartDrawing = {
  tool: 'horizontal' | 'vertical' | 'trend' | 'rectangle' | 'fib' | 'measure';
  points: { time: number; price: number }[];
  color?: string;
};

export const drawingToolsCss = `
  #chart{position:relative;}
  /* Drawings are painted here. While a tool is armed the layer also takes the taps that place points. */
  #draw-layer{position:absolute;left:0;top:0;z-index:6;pointer-events:none;overflow:hidden;}
  #draw-layer.active{pointer-events:auto;touch-action:none;cursor:crosshair;}
  #drawing-ui{position:absolute;left:10px;top:78px;z-index:8;color:#131722;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;}
  #drawing-ui button{font:inherit;color:inherit;cursor:pointer;border:1px solid #E0E3EB;border-radius:10px;background:#FFFFFF;display:flex;align-items:center;justify-content:center;gap:8px;padding:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
  #drawing-ui button:active{background:#F0F3FA;}
  #drawing-ui button:focus-visible{outline:2px solid #2962FF;outline-offset:2px;}
  #drawing-ui button[aria-pressed=true]{background:#E3ECFF;border-color:#2962FF;color:#2962FF;}
  #drawing-ui button:disabled{opacity:.35;cursor:default;}
  #drawing-ui svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;}
  /* The in-chart pencil: always there, so drawing never depends on the app's toolbar. */
  #tools-toggle{width:40px;height:40px;border-radius:20px!important;box-shadow:0 2px 8px rgba(19,23,34,.12);}
  #tools-toggle[aria-expanded=true],#tools-toggle.armed{background:#2962FF!important;border-color:#2962FF!important;color:#FFFFFF!important;}
  #drawing-menu{margin-top:8px;display:flex;flex-direction:column;gap:6px;padding:6px;width:max-content;background:rgba(255,255,255,.96);border:1px solid #E0E3EB;border-radius:14px;box-shadow:0 6px 20px rgba(19,23,34,.14);max-height:calc(100vh - 140px);overflow-y:auto;}
  #drawing-menu button{width:40px;height:40px;}
  .draw-divider{height:1px;background:#E0E3EB;margin:2px 4px;}
  #drawing-menu[hidden],#drawing-hint[hidden],#clear-confirm[hidden],#drawing-editor[hidden]{display:none!important;}
  .draw-section{font-size:11px;color:#787B86;margin:2px 0 8px;letter-spacing:.3px;}
  /* Popovers sit beside the column, never on top of it. */
  #drawing-hint,#clear-confirm,#drawing-editor{position:absolute;left:52px;top:0;background:#FFFFFF;border:1px solid #E0E3EB;border-radius:12px;box-shadow:0 6px 20px rgba(19,23,34,.14);}
  #drawing-hint{padding:10px 12px;width:max-content;max-width:min(230px,calc(100vw - 150px));line-height:1.4;}
  #drawing-hint strong{display:block;margin-bottom:2px;}
  #drawing-hint button,#clear-confirm button,#drawing-editor-done{margin-top:8px;min-height:36px;padding:0 12px!important;}
  #clear-confirm{padding:12px;width:max-content;max-width:min(230px,calc(100vw - 150px));line-height:1.4;}
  .draw-actions{display:flex;gap:6px;}
  .draw-actions button{flex:1;}
  #drawing-editor{padding:12px;width:min(240px,calc(100vw - 150px));}
  .drawing-editor-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;}
  .drawing-editor-heading #drawing-editor-done{margin-top:0;}
  .draw-colors{display:grid;grid-template-columns:repeat(6,1fr);gap:2px;}
  #drawing-ui .draw-color{min-width:0;height:40px;border-color:transparent;}
  #drawing-ui .draw-color[aria-pressed=true]{background:#F0F3FA;border-color:#2962FF;}
  .draw-color span{width:22px;height:22px;border-radius:50%;border:1px solid rgba(0,0,0,.08);}
  #drawing-ui #draw-delete{color:#F23645;width:100%;margin-top:10px;min-height:40px;background:#FFF1F3;border-color:#FECDD3;}
  #draw-status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);}
`;

const paths: Record<string, string> = {
  cursor: '<path d="M4 3l6 16 3-6 6-3z"/>',
  trend: '<path d="M4 18L20 6"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="6" r="2"/>',
  horizontal: '<path d="M3 12h18"/><circle cx="12" cy="12" r="2"/>',
  vertical: '<path d="M12 3v18"/><circle cx="12" cy="12" r="2"/>',
  rectangle: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
  fib: '<path d="M3 4h18M3 10h18M3 14h18M3 20h18M5 20L19 4"/>',
  measure: '<path d="M4 17L17 4l4 4L8 21zM9 12l3 3M13 8l3 3"/>',
  pencil: '<path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20z"/><path d="M14 7l3 3"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
};
const toolLabels = { cursor: 'Cursor', trend: 'Trend line', horizontal: 'Horizontal', vertical: 'Vertical', rectangle: 'Rectangle', fib: 'Fib retracement', measure: 'Measure' };
const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
const drawingColors = [
  { name: 'purple', value: '#8370ED' }, { name: 'blue', value: '#3B82F6' },
  { name: 'teal', value: '#0EA57A' }, { name: 'pink', value: '#E45D80' },
  { name: 'amber', value: '#B98428' }, { name: 'slate', value: '#414869' },
];
export const drawingToolsHtml = `
  <svg id="draw-layer" aria-hidden="true"></svg>
  <div id="drawing-ui">
    <button id="tools-toggle" aria-expanded="false" aria-controls="drawing-menu" aria-label="Drawing tools" title="Drawing tools">${icon('pencil')}</button>
    <div id="drawing-menu" role="toolbar" aria-orientation="vertical" aria-label="Drawing tools" hidden>
      ${Object.entries(toolLabels).map(([id, label]) => `<button data-draw-tool="${id}" aria-pressed="${id === 'cursor'}" aria-label="${label}" title="${label}">${icon(id)}</button>`).join('')}
      <div class="draw-divider"></div>
      <button id="draw-undo" aria-label="Undo" title="Undo" disabled>${icon('undo')}</button>
      <button id="draw-redo" aria-label="Redo" title="Redo" disabled>${icon('redo')}</button>
      <button id="draw-hide" aria-label="Hide drawings" title="Hide drawings" aria-pressed="false">${icon('eye')}</button>
      <button id="draw-clear" aria-label="Clear all drawings" title="Clear all drawings" disabled>${icon('trash')}</button>
    </div>
    <div id="clear-confirm" role="alertdialog" aria-label="Clear all drawings" hidden>Clear all drawings on this timeframe?<div class="draw-actions"><button id="clear-yes">Clear</button><button id="clear-no">Cancel</button></div></div>
    <div id="drawing-hint" role="status" hidden><strong id="hint-title"></strong><span id="hint-text"></span><button id="draw-cancel">Cancel</button></div>
    <div id="drawing-editor" role="group" aria-label="Selected drawing" hidden>
      <div class="drawing-editor-heading"><strong id="drawing-editor-title">Selected drawing</strong><button id="drawing-editor-done">Done</button></div>
      <p class="draw-section">COLOR</p>
      <div class="draw-colors">${drawingColors.map(color => `<button class="draw-color" id="draw-color-${color.name}" aria-label="${color.name}" title="${color.name}" aria-pressed="false"><span style="background:${color.value}"></span></button>`).join('')}</div>
      <button id="draw-delete">Delete drawing</button>
    </div>
    <span id="draw-status" role="status" aria-live="polite"></span>
  </div>
`;

export const drawingToolsScript = `
  const drawingLayer = document.getElementById('draw-layer');
  const drawingEditor = document.getElementById('drawing-editor');
  const drawingColors = ${JSON.stringify(drawingColors)};
  const drawingNames = ${JSON.stringify(toolLabels)};
  const drawingMenu = document.getElementById('drawing-menu');
  const drawingHint = document.getElementById('drawing-hint');
  const toolButtons = Array.from(document.querySelectorAll('[data-draw-tool]'));
  const ns = 'http://www.w3.org/2000/svg';
  let drawings = initialDrawings;
  let undoHistory = [];
  let redoHistory = [];
  let selectedDrawing = -1;
  let activeTool = 'cursor';
  let anchor = null;
  let preview = null;
  let drawingsHidden = false;
  let scheduled = false;
  const chartHost = document.getElementById('chart');
  chartHost.appendChild(drawingLayer);

  function setMenu(open) {
    if (open) selectDrawing(-1);
    else document.getElementById('clear-confirm').hidden = true;
    drawingMenu.hidden = !open;
    document.getElementById('tools-toggle').setAttribute('aria-expanded', String(open));
  }
  function announce(message) { document.getElementById('draw-status').textContent = message; }
  function persistDrawings() {
    // The app's toolbar mirrors this state: undo/redo availability, the armed tool, hidden drawings.
    const message = JSON.stringify({ type: 'chart-drawings', key: drawingKey, drawings, canUndo: undoHistory.length > 0, canRedo: redoHistory.length > 0, activeTool, hidden: drawingsHidden });
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(message);
    else window.parent.postMessage(message, '*');
    document.getElementById('draw-undo').disabled = !undoHistory.length;
    document.getElementById('draw-redo').disabled = !redoHistory.length;
    document.getElementById('draw-clear').disabled = !drawings.length;
  }
  function setHideButton() {
    const button = document.getElementById('draw-hide');
    const label = drawingsHidden ? 'Show drawings' : 'Hide drawings';
    button.setAttribute('aria-pressed', String(drawingsHidden));
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  }
  function rememberChange() {
    undoHistory.push(JSON.parse(JSON.stringify(drawings)));
    redoHistory = [];
  }
  function drawingColor(drawing) {
    return /^#[0-9a-f]{6}$/i.test(drawing.color || '') ? drawing.color : '#0066FF';
  }
  function selectDrawing(index) {
    selectedDrawing = index;
    drawingEditor.hidden = index < 0;
    if (index >= 0) {
      setMenu(false);
      document.getElementById('drawing-editor-title').textContent = drawingNames[drawings[index].tool];
      drawingColors.forEach(color => document.getElementById('draw-color-' + color.name)
        .setAttribute('aria-pressed', String(drawingColor(drawings[index]) === color.value)));
      announce('Drawing selected. Choose a color or delete it.');
    }
    renderDrawings();
  }
  function setTool(tool) {
    selectedDrawing = -1;
    drawingEditor.hidden = true;
    activeTool = tool;
    anchor = null;
    preview = null;
    drawingLayer.classList.toggle('active', tool !== 'cursor');
    toolButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.drawTool === tool)));
    // The in-chart pencil turns blue while a tool waits for taps.
    document.getElementById('tools-toggle').classList.toggle('armed', tool !== 'cursor');
    chart.applyOptions({ handleScroll: tool === 'cursor', handleScale: tool === 'cursor' });
    drawingHint.hidden = tool === 'cursor';
    if (tool !== 'cursor') {
      drawingsHidden = false;
      setHideButton();
      document.getElementById('hint-title').textContent = drawingNames[tool];
      document.getElementById('hint-text').textContent = tool === 'horizontal' || tool === 'vertical'
        ? 'Tap the chart to place it.' : 'Tap a start point, then an end point.';
    }
    renderDrawings();
    persistDrawings();
  }
  // Preserve market coordinates rather than screen pixels, including gaps between sessions.
  function timeAt(logical) {
    const left = Math.max(0, Math.min(candles.length - 2, Math.floor(logical)));
    const a = candles[left], b = candles[left + 1] || a;
    return a.time + (logical - left) * (b.time - a.time || 60);
  }
  function logicalAt(time) {
    let low = 0, high = candles.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (candles[mid].time < time) low = mid + 1; else high = mid;
    }
    const left = Math.max(0, Math.min(candles.length - 2, low - 1));
    const a = candles[left], b = candles[left + 1] || a;
    return left + (time - a.time) / (b.time - a.time || 60);
  }
  function toAnchor(x, y) {
    const logical = chart.timeScale().coordinateToLogical(x);
    const price = series.coordinateToPrice(y);
    if (logical === null || price === null || !Number.isFinite(price)) return null;
    return { time: timeAt(logical), price };
  }
  function toScreen(point) {
    const x = chart.timeScale().logicalToCoordinate(logicalAt(point.time));
    const y = series.priceToCoordinate(point.price);
    return x === null || y === null ? null : { x, y };
  }
  function svg(tag, attributes, text) {
    const element = document.createElementNS(ns, tag);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    if (text !== undefined) element.textContent = text;
    drawingLayer.appendChild(element);
    return element;
  }
  function line(x1, y1, x2, y2, dashed = false, color = '#0066FF', strokeWidth = 1.6) {
    svg('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': strokeWidth, 'stroke-dasharray': dashed ? '5 4' : 'none' });
  }
  function label(x, y, text, color = '#0052D6') {
    svg('text', { x: Math.max(4, Math.min(chart.timeScale().width() - 130, x)), y: Math.max(14, y), fill: color, 'font-size': 11, 'font-family': '-apple-system, Segoe UI, Roboto, Arial, sans-serif', stroke: '#FFFFFF', 'stroke-width': 3, 'paint-order': 'stroke' }, text);
  }
  function renderDrawing(drawing, width, height) {
    const color = drawingColor(drawing);
    const selected = selectedDrawing >= 0 && drawings[selectedDrawing] === drawing;
    const strokeWidth = selected ? 2.8 : 1.6;
    const a = toScreen(drawing.points[0]);
    const b = drawing.points[1] ? toScreen(drawing.points[1]) : a;
    if (!a || !b) return;
    if (drawing.tool === 'horizontal') {
      line(0, a.y, width, a.y, false, color, strokeWidth);
      label(8, a.y - 6, drawing.points[0].price.toFixed(typeof pricePrecision === 'number' ? pricePrecision : 2), color);
    } else if (drawing.tool === 'vertical') {
      line(a.x, 0, a.x, height, true, color, strokeWidth);
    } else if (drawing.tool === 'trend') {
      line(a.x, a.y, b.x, b.y, false, color, strokeWidth);
    } else if (drawing.tool === 'rectangle' || drawing.tool === 'measure') {
      svg('rect', { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y), fill: color + '1A', stroke: color, 'stroke-width': strokeWidth });
      if (drawing.tool === 'measure' && drawing.points[1]) {
        const delta = drawing.points[1].price - drawing.points[0].price;
        const percent = drawing.points[0].price === 0 ? 0 : delta / drawing.points[0].price * 100;
        const bars = Math.round(Math.abs(logicalAt(drawing.points[1].time) - logicalAt(drawing.points[0].time)));
        label(Math.min(a.x, b.x) + 4, Math.min(a.y, b.y) - 8, (delta >= 0 ? '+' : '') + delta.toFixed(typeof pricePrecision === 'number' ? pricePrecision : 2) + ' (' + percent.toFixed(2) + '%) · ' + bars + ' bars', color);
      }
    } else if (drawing.tool === 'fib') {
      [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].forEach(level => {
        const y = b.y + (a.y - b.y) * level;
        const price = drawing.points[1].price + (drawing.points[0].price - drawing.points[1].price) * level;
        line(Math.min(a.x, b.x), y, Math.max(a.x, b.x), y, level !== 0 && level !== 1, color, strokeWidth);
        label(Math.min(a.x, b.x) + 4, y - 4, level.toString() + ' · ' + price.toFixed(typeof pricePrecision === 'number' ? pricePrecision : 2), color);
      });
    }
    drawing.points.forEach(point => {
      const p = toScreen(point);
      if (p) svg('circle', { cx: p.x, cy: p.y, r: selected ? 5 : 3, fill: '#FFFFFF', stroke: color, 'stroke-width': 1.5 });
    });
  }
  function renderDrawings() {
    const width = chart.timeScale().width();
    const height = chartHost.clientHeight - chart.timeScale().height();
    drawingLayer.setAttribute('width', String(width));
    drawingLayer.setAttribute('height', String(Math.max(0, height)));
    drawingLayer.replaceChildren();
    if (drawingsHidden) return;
    drawings.forEach(drawing => renderDrawing(drawing, width, height));
    if (anchor) renderDrawing({ tool: activeTool, points: [anchor, preview || anchor] }, width, height);
  }
  function scheduleDrawings() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; renderDrawings(); });
  }
  function finishDrawing(point) {
    if (!point || activeTool === 'cursor') return;
    if (activeTool === 'horizontal' || activeTool === 'vertical') {
      rememberChange();
      drawings.push({ tool: activeTool, points: [point] });
    } else if (!anchor) {
      anchor = point;
      document.getElementById('hint-text').textContent = 'Tap the end point to finish.';
      renderDrawings();
      return;
    } else {
      rememberChange();
      drawings.push({ tool: activeTool, points: [anchor, point] });
    }
    persistDrawings();
    setTool('cursor');
    announce('Drawing added.');
  }
  // Hit testing stays in chart coordinates, leaving normal pan/zoom gestures untouched.
  function segmentDistance(point, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
    return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
  }
  function hitDrawing(point, drawing) {
    const a = toScreen(drawing.points[0]);
    const b = drawing.points[1] ? toScreen(drawing.points[1]) : a;
    if (!a || !b) return false;
    const tolerance = 10;
    if (drawing.tool === 'horizontal') return Math.abs(point.y - a.y) <= tolerance;
    if (drawing.tool === 'vertical') return Math.abs(point.x - a.x) <= tolerance;
    if (drawing.tool === 'trend') return segmentDistance(point, a, b) <= tolerance;
    if (drawing.tool === 'fib') return [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].some(level => {
      const y = b.y + (a.y - b.y) * level;
      return segmentDistance(point, { x: a.x, y }, { x: b.x, y }) <= tolerance;
    });
    return point.x >= Math.min(a.x, b.x) - tolerance && point.x <= Math.max(a.x, b.x) + tolerance
      && point.y >= Math.min(a.y, b.y) - tolerance && point.y <= Math.max(a.y, b.y) + tolerance;
  }
  function inPlot(point) {
    return !!point && point.x >= 0 && point.x <= chart.timeScale().width()
      && point.y >= 0 && point.y <= chartHost.clientHeight - chart.timeScale().height();
  }
  // Placing points. WebViews differ in which events a tap produces (pointer, touch, click), so all
  // three are handled and the same tap reported twice is counted once. The chart library's own click
  // is not the main input: on touch it swallows a second tap within ~500 ms as a double-tap, which
  // broke two-tap tools whenever the start and end points were tapped quickly.
  let lastTap = null;
  function placeAt(x, y) {
    if (activeTool === 'cursor') return;
    const now = Date.now();
    if (lastTap && now - lastTap.at < 250 && Math.hypot(x - lastTap.x, y - lastTap.y) < 12) return;
    lastTap = { at: now, x, y };
    finishDrawing(toAnchor(x, y));
  }
  function layerPoint(clientX, clientY) {
    const rect = drawingLayer.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }
  drawingLayer.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); });
  drawingLayer.addEventListener('pointerup', event => {
    if (event.isPrimary === false) return;
    event.preventDefault(); event.stopPropagation();
    const p = layerPoint(event.clientX, event.clientY); placeAt(p.x, p.y);
  });
  drawingLayer.addEventListener('touchend', event => {
    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch) return;
    event.preventDefault();
    const p = layerPoint(touch.clientX, touch.clientY); placeAt(p.x, p.y);
  }, { passive: false });
  drawingLayer.addEventListener('click', event => { const p = layerPoint(event.clientX, event.clientY); placeAt(p.x, p.y); });
  function previewAt(clientX, clientY) {
    if (!anchor) return;
    const p = layerPoint(clientX, clientY);
    preview = toAnchor(p.x, p.y);
    scheduleDrawings();
  }
  drawingLayer.addEventListener('pointermove', event => previewAt(event.clientX, event.clientY));
  drawingLayer.addEventListener('touchmove', event => {
    const touch = event.touches && event.touches[0];
    if (touch) { event.preventDefault(); previewAt(touch.clientX, touch.clientY); }
  }, { passive: false });
  // With no tool armed, taps on the chart select a drawing. If the layer ever misses a tap while a tool
  // is armed, the chart's click still places the point (deduplicated like the rest).
  chart.subscribeClick(param => {
    if (activeTool !== 'cursor') {
      if (inPlot(param.point)) placeAt(param.point.x, param.point.y);
      return;
    }
    let hit = -1;
    if (!drawingsHidden && inPlot(param.point)) {
      for (let i = drawings.length - 1; i >= 0; i--) {
        if (hitDrawing(param.point, drawings[i])) { hit = i; break; }
      }
    }
    selectDrawing(hit);
  });
  drawingColors.forEach(color => {
    document.getElementById('draw-color-' + color.name).addEventListener('click', () => {
      if (selectedDrawing < 0 || drawingColor(drawings[selectedDrawing]) === color.value) return;
      rememberChange();
      drawings[selectedDrawing] = { ...drawings[selectedDrawing], color: color.value };
      persistDrawings(); selectDrawing(selectedDrawing);
      announce('Drawing color changed to ' + color.name + '.');
    });
  });
  document.getElementById('drawing-editor-done').addEventListener('click', () => selectDrawing(-1));
  document.getElementById('draw-delete').addEventListener('click', () => {
    if (selectedDrawing < 0) return;
    rememberChange(); drawings.splice(selectedDrawing, 1);
    selectDrawing(-1); persistDrawings(); announce('Drawing deleted. Use Undo to restore it.');
  });
  document.getElementById('tools-toggle').addEventListener('click', () => setMenu(drawingMenu.hidden));
  // Close the menu first so it can never be left covering the chart.
  toolButtons.forEach(button => button.addEventListener('click', () => { setMenu(false); setTool(button.dataset.drawTool); }));
  document.getElementById('draw-cancel').addEventListener('click', () => setTool('cursor'));
  document.getElementById('draw-undo').addEventListener('click', () => {
    if (undoHistory.length) {
      redoHistory.push(JSON.parse(JSON.stringify(drawings)));
      drawings = undoHistory.pop();
    }
    setTool('cursor'); persistDrawings(); announce('Drawing undone.');
  });
  document.getElementById('draw-redo').addEventListener('click', () => {
    if (redoHistory.length) {
      undoHistory.push(JSON.parse(JSON.stringify(drawings)));
      drawings = redoHistory.pop();
    }
    setTool('cursor'); persistDrawings(); announce('Drawing restored.');
  });
  document.getElementById('draw-hide').addEventListener('click', () => {
    setTool('cursor'); drawingsHidden = !drawingsHidden;
    setHideButton();
    renderDrawings();
    persistDrawings();
  });
  document.getElementById('draw-clear').addEventListener('click', () => { document.getElementById('clear-confirm').hidden = false; });
  document.getElementById('clear-no').addEventListener('click', () => { document.getElementById('clear-confirm').hidden = true; });
  document.getElementById('clear-yes').addEventListener('click', () => {
    rememberChange(); drawings = []; setTool('cursor'); persistDrawings();
    document.getElementById('clear-confirm').hidden = true; announce('Drawings cleared.');
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { setTool('cursor'); setMenu(false); }
  });
  chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleDrawings);
  chart.subscribeCrosshairMove(scheduleDrawings);
  ['pointermove', 'pointerup', 'wheel', 'touchmove', 'touchend'].forEach(name => chartHost.addEventListener(name, scheduleDrawings, { passive: true }));
  new ResizeObserver(scheduleDrawings).observe(chartHost);
  // Commands from the app's native toolbar and drawing sheet. Each carries an id, and a repeated id is
  // ignored, so a message delivered twice can't toggle something back.
  let lastCommandId = null;
  function acknowledge(command, ok) {
    const message = JSON.stringify({ type: 'chart-command-ack', id: command.id, command: command.type, ok, activeTool });
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(message);
    else window.parent.postMessage(message, '*');
  }
  window.chartDrawingCommand = function(command) {
    const ok = runDrawingCommand(command);
    if (ok && command) acknowledge(command, ok);
    return ok;
  };
  function runDrawingCommand(command) {
    if (!command || typeof command.type !== 'string') return false;
    if (command.id !== undefined) { if (command.id === lastCommandId) return false; lastCommandId = command.id; }
    if (command.type === 'set-drawing-tool' && toolButtons.some(button => button.dataset.drawTool === command.tool)) { setMenu(false); setTool(command.tool); return true; }
    if (command.type === 'drawing-undo') { document.getElementById('draw-undo').click(); return true; }
    if (command.type === 'drawing-redo') { document.getElementById('draw-redo').click(); return true; }
    if (command.type === 'drawing-hidden') {
      if (drawingsHidden !== Boolean(command.hidden)) document.getElementById('draw-hide').click();
      return true;
    }
    if (command.type === 'drawing-clear') {
      if (drawings.length) { rememberChange(); drawings = []; }
      setTool('cursor'); persistDrawings(); announce('Drawings cleared.');
      return true;
    }
    if (command.type === 'open-drawing-tools') { setMenu(true); return true; }
    if (command.type === 'toggle-drawing-tools') {
      if (activeTool !== 'cursor') { setTool('cursor'); setMenu(true); } else setMenu(drawingMenu.hidden);
      return true;
    }
    return false;
  }
  persistDrawings();
  scheduleDrawings();
`;
