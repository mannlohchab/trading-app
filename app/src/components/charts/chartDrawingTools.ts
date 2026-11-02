// Runs inside the chart iframe/WebView, so drawing coordinates use the chart's
// own price and time scales on both web and native.
export type ChartDrawing = {
  tool: 'horizontal' | 'vertical' | 'trend' | 'rectangle' | 'fib' | 'measure';
  points: { time: number; price: number }[];
  color?: string;
};

export const drawingToolsCss = `
  #chart{position:relative;}
  #draw-layer{position:absolute;left:0;top:0;z-index:6;pointer-events:none;overflow:hidden;}
  #draw-layer.active{pointer-events:auto;touch-action:none;cursor:crosshair;}
  #drawing-ui{position:absolute;left:10px;top:10px;z-index:8;color:#514363;font-size:12px;}
  #drawing-ui button{font:inherit;color:inherit;cursor:pointer;min-height:42px;border:1px solid #EAE5F2;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 10px;}
  #drawing-ui button:hover{background:#F8F6FC;}
  #drawing-ui button:focus-visible{outline:2px solid #8370ED;outline-offset:2px;}
  #drawing-ui button[aria-pressed=true]{background:#F1ECFC;border-color:#CBB9EE;color:#6E579C;}
  #drawing-ui button:disabled{opacity:.4;cursor:default;}
  #drawing-ui svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;}
  #tools-toggle{box-shadow:0 2px 10px rgba(83,62,125,.08);font-weight:600!important;}
  #drawing-menu{margin-top:6px;padding:10px;background:#fff;border:1px solid #E4DAF2;border-radius:14px;box-shadow:0 4px 24px rgba(83,62,125,.12);width:min(260px,calc(100vw - 44px));max-height:calc(100vh - 85px);overflow:auto;}
  #drawing-menu[hidden],#drawing-hint[hidden],#clear-confirm[hidden],#drawing-editor[hidden]{display:none;}
  .draw-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;}
  #drawing-menu .draw-grid button{justify-content:flex-start;}
  .draw-section{font-size:11px;color:#787184;margin:2px 0 8px;}
  .draw-actions{display:flex;gap:6px;border-top:1px solid #F0ECF5;margin-top:10px;padding-top:10px;flex-wrap:wrap;}
  .draw-actions button{flex:1;}
  #drawing-hint{margin-top:6px;background:#F8F6FC;border:1px solid #E4DAF2;padding:8px 10px;border-radius:10px;max-width:220px;line-height:1.4;}
  #drawing-hint button{margin-top:6px;min-height:32px;}
  #clear-confirm{padding-top:10px;line-height:1.5;}
  #drawing-editor{margin-top:6px;padding:12px;background:#fff;border:1px solid #E4DAF2;border-radius:14px;box-shadow:0 4px 24px rgba(83,62,125,.12);width:min(260px,calc(100vw - 44px));max-height:calc(100vh - 85px);overflow:auto;}
  .drawing-editor-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;}
  .draw-colors{display:grid;grid-template-columns:repeat(6,1fr);gap:2px;}
  #drawing-ui .draw-color{min-width:0;min-height:44px;padding:4px;}
  .draw-color span{width:22px;height:22px;border-radius:50%;border:1px solid rgba(0,0,0,.08);}
  #drawing-ui #draw-delete{color:#C93455;width:100%;margin-top:10px;background:#FFF5F7;border-color:#F4DAE1;}
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
};
const toolLabels = { cursor: 'Cursor', trend: 'Trend line', horizontal: 'Horizontal', vertical: 'Vertical', rectangle: 'Rectangle', fib: 'Fib retracement', measure: 'Measure' };
const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
const drawingColors = [
  { name: 'purple', value: '#8370ED' }, { name: 'blue', value: '#3B82F6' },
  { name: 'teal', value: '#0EA57A' }, { name: 'pink', value: '#E45D80' },
  { name: 'amber', value: '#B98428' }, { name: 'slate', value: '#514363' },
];
export const drawingToolsHtml = `
  <svg id="draw-layer" aria-label="Chart drawing surface"></svg>
  <div id="drawing-ui">
    <button id="tools-toggle" aria-expanded="false" aria-controls="drawing-menu">${icon('trend')}Tools</button>
    <div id="drawing-menu" hidden>
      <p class="draw-section">DRAWING TOOLS</p>
      <div class="draw-grid">${Object.entries(toolLabels).map(([id, label]) => `<button data-draw-tool="${id}" aria-pressed="${id === 'cursor'}">${icon(id)}${label}</button>`).join('')}</div>
      <div class="draw-actions"><button id="draw-undo" disabled>Undo</button><button id="draw-redo" disabled>Redo</button></div>
      <div class="draw-actions"><button id="draw-hide" aria-pressed="false">Hide drawings</button><button id="draw-clear" disabled>Clear all</button></div>
      <div id="clear-confirm" hidden>Clear all drawings on this timeframe?<div class="draw-actions"><button id="clear-yes">Clear</button><button id="clear-no">Cancel</button></div></div>
      <p class="draw-section" style="margin-top:10px;margin-bottom:0">Drawings stay while this chart page is open.</p>
    </div>
    <div id="drawing-hint" hidden><span id="hint-text"></span><button id="draw-cancel">Cancel drawing</button></div>
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
    drawingMenu.hidden = !open;
    document.getElementById('tools-toggle').setAttribute('aria-expanded', String(open));
  }
  function announce(message) { document.getElementById('draw-status').textContent = message; }
  function persistDrawings() {
    const message = JSON.stringify({ type: 'chart-drawings', key: drawingKey, drawings });
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(message);
    else window.parent.postMessage(message, '*');
    document.getElementById('draw-undo').disabled = !undoHistory.length;
    document.getElementById('draw-redo').disabled = !redoHistory.length;
    document.getElementById('draw-clear').disabled = !drawings.length;
  }
  function rememberChange() {
    undoHistory.push(JSON.parse(JSON.stringify(drawings)));
    redoHistory = [];
  }
  function drawingColor(drawing) {
    return /^#[0-9a-f]{6}$/i.test(drawing.color || '') ? drawing.color : '#8370ED';
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
    chart.applyOptions({ handleScroll: tool === 'cursor', handleScale: tool === 'cursor' });
    drawingHint.hidden = tool === 'cursor';
    if (tool !== 'cursor') {
      drawingsHidden = false;
      document.getElementById('draw-hide').textContent = 'Hide drawings';
      document.getElementById('draw-hide').setAttribute('aria-pressed', 'false');
      document.getElementById('hint-text').textContent = tool === 'horizontal' || tool === 'vertical'
        ? 'Tap the chart to place your line.' : 'Tap a start point, then an end point.';
      tip.style.display = 'none';
    }
    renderDrawings();
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
  function line(x1, y1, x2, y2, dashed = false, color = '#8370ED', strokeWidth = 1.6) {
    svg('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': strokeWidth, 'stroke-dasharray': dashed ? '5 4' : 'none' });
  }
  function label(x, y, text, color = '#6E579C') {
    svg('text', { x: Math.max(4, Math.min(chart.timeScale().width() - 130, x)), y: Math.max(14, y), fill: color, 'font-size': 11, 'font-family': 'system-ui', stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke' }, text);
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
      if (p) svg('circle', { cx: p.x, cy: p.y, r: selected ? 5 : 3, fill: '#fff', stroke: color, 'stroke-width': 1.5 });
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
  chart.subscribeClick(param => {
    if (activeTool !== 'cursor') return;
    let hit = -1;
    if (!drawingsHidden && param.point && param.point.x >= 0 && param.point.x <= chart.timeScale().width()
        && param.point.y >= 0 && param.point.y <= chartHost.clientHeight - chart.timeScale().height()) {
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
  drawingLayer.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); });
  drawingLayer.addEventListener('pointerup', event => {
    if (event.isPrimary === false) return;
    event.preventDefault(); event.stopPropagation();
    const rect = drawingLayer.getBoundingClientRect();
    finishDrawing(toAnchor(event.clientX - rect.left, event.clientY - rect.top));
  });
  drawingLayer.addEventListener('pointermove', event => {
    if (!anchor) return;
    const rect = drawingLayer.getBoundingClientRect();
    preview = toAnchor(event.clientX - rect.left, event.clientY - rect.top);
    scheduleDrawings();
  });
  document.getElementById('tools-toggle').addEventListener('click', () => setMenu(drawingMenu.hidden));
  toolButtons.forEach(button => button.addEventListener('click', () => { setTool(button.dataset.drawTool); setMenu(false); }));
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
  document.getElementById('draw-hide').addEventListener('click', event => {
    setTool('cursor'); drawingsHidden = !drawingsHidden;
    event.currentTarget.textContent = drawingsHidden ? 'Show drawings' : 'Hide drawings';
    event.currentTarget.setAttribute('aria-pressed', String(drawingsHidden));
    renderDrawings();
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
  ['pointermove', 'pointerup', 'wheel', 'touchmove'].forEach(name => chartHost.addEventListener(name, scheduleDrawings, { passive: true }));
  new ResizeObserver(scheduleDrawings).observe(chartHost);
  persistDrawings();
  scheduleDrawings();
`;
