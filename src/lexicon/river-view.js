/* The canvas half of the word river.
 *
 * river-field.js owns the words and their motion; this file owns the pixels,
 * the clock, and the finger. On a device it draws to a 2D canvas. Where there
 * is no 2D context - a headless test - it falls back to absolutely positioned
 * spans, so the same field can still be inspected and poked.
 */
import { createField } from './river-field.js';

var FONT_STACK = '-apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

export function createRiverView(canvas, options) {
  var opts = options || {};
  var fallback = opts.fallback || null;
  var ctx = null;
  try {
    ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  } catch (err) {
    ctx = null;
  }

  var fontSize = opts.fontSize || 22;
  var width = opts.width || 720;
  var height = opts.height || 440;
  var dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
  var reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var raf = (!reduced && typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function')
    ? window.requestAnimationFrame.bind(window) : null;
  var caf = (!reduced && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function')
    ? window.cancelAnimationFrame.bind(window) : null;

  var nodes = [];
  var running = false;
  var frameId = null;
  var last = 0;
  var net = null;

  function measure(term) {
    if (ctx) {
      ctx.font = '600 ' + fontSize + 'px ' + FONT_STACK;
      var metrics = ctx.measureText(String(term));
      return { width: Math.ceil(metrics.width) + 2, height: Math.ceil(fontSize * 1.5) };
    }
    return { width: Math.ceil(String(term).length * fontSize * 0.98) + 2, height: Math.ceil(fontSize * 1.5) };
  }

  var field = createField({
    lanes: opts.lanes,
    count: opts.count,
    baseSpeed: opts.baseSpeed,
    nextWord: opts.nextWord,
    measure: measure,
    width: width,
    height: height
  });

  function palette() {
    var text = '#000000';
    var tint = '#007aff';
    try {
      var styles = getComputedStyle(document.documentElement);
      text = (styles.getPropertyValue('--text') || text).trim() || text;
      tint = (styles.getPropertyValue('--tint') || tint).trim() || tint;
    } catch (err) { /* keep the defaults */ }
    return { text: text, tint: tint };
  }

  function syncFallback() {
    if (ctx || !fallback) return;
    var items = field.items();
    if (nodes.length !== items.length) {
      fallback.innerHTML = '';
      nodes = items.map(function () {
        var span = document.createElement('span');
        span.className = 'wb-river-word';
        fallback.appendChild(span);
        return span;
      });
    }
    items.forEach(function (item, index) {
      var node = nodes[index];
      if (!node) return;
      if (node.textContent !== item.term) node.textContent = item.term;
      node.style.transform = 'translate(' + Math.round(item.x) + 'px,' + Math.round(item.y) + 'px)';
      node.classList.toggle('is-caught', !!item.caught);
    });
  }

  function draw() {
    var colors = palette();
    if (!ctx) {
      syncFallback();
      return;
    }
    ctx.clearRect(0, 0, width, height);
    ctx.textBaseline = 'top';
    ctx.font = '600 ' + fontSize + 'px ' + FONT_STACK;
    var items = field.items();
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      ctx.fillStyle = item.caught ? colors.tint : colors.text;
      ctx.globalAlpha = item.caught ? 1 : 0.8;
      ctx.fillText(item.term, item.x, item.y);
    }
    ctx.globalAlpha = 1;
    if (net) {
      ctx.save();
      ctx.strokeStyle = colors.tint;
      ctx.lineWidth = 2;
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(net.x, net.y, net.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function resize() {
    var rect = canvas && typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
    width = Math.max(280, Math.round((rect && rect.width) || (canvas && canvas.clientWidth) || opts.width || 720));
    height = Math.max(220, Math.round((rect && rect.height) || (canvas && canvas.clientHeight) || opts.height || 440));
    if (canvas) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    if (ctx && typeof ctx.setTransform === 'function') ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    field.resize(width, height);
    field.fill(opts.count || 70);
    draw();
  }

  function advance(ts) {
    if (!running) return;
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
    last = ts;
    field.step(dt);
    draw();
    frameId = raf ? raf(advance) : null;
  }

  function start() {
    if (running) return;
    running = true;
    last = 0;
    if (raf) frameId = raf(advance);
    else draw();
  }

  function stop() {
    running = false;
    if (frameId != null && caf) caf(frameId);
    frameId = null;
  }

  function pointOf(event) {
    var rect = canvas && typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: (event.clientX || 0) - (rect.left || 0), y: (event.clientY || 0) - (rect.top || 0) };
  }

  function onDown(event) {
    var point = pointOf(event);
    net = { x: point.x, y: point.y, radius: opts.netRadius || 64 };
    field.catchNear(point.x, point.y, net.radius);
    draw();
    if (canvas.setPointerCapture && event.pointerId != null) {
      try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    }
  }

  function onMove(event) {
    if (!net) return;
    var point = pointOf(event);
    net.x = point.x;
    net.y = point.y;
    field.catchNear(point.x, point.y, net.radius);
    draw();
  }

  function onUp() {
    if (!net) return;
    net = null;
    var caught = field.caught();
    draw();
    if (caught.length && typeof opts.onCatch === 'function') opts.onCatch(caught.slice());
  }

  if (canvas && typeof canvas.addEventListener === 'function') {
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
  }

  return {
    field: field,
    resize: resize,
    start: start,
    stop: stop,
    draw: draw,
    release: function () {
      net = null;
      field.releaseCaught();
      draw();
    },
    hasCanvas: !!ctx
  };
}
