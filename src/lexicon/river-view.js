/* The canvas half of the word river.
 *
 * river-field.js owns the words and their motion; this file owns the pixels,
 * the clock, and the rod. Words are drawn tategaki: one character under the
 * last. On a device this is a 2D canvas; where there is no 2D context - a
 * headless test - the same field renders as absolutely positioned spans, so the
 * rod can still be used and the pool wiring tested.
 */
import { createField } from './river-field.js';

var FONT_STACK = '-apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
var RIPPLE_MS = 420;

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
  var clock = function () {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  };

  var nodes = [];
  var running = false;
  var frameId = null;
  var last = 0;
  var rod = null;
  var ripple = null;

  var field = createField({
    columns: opts.columns,
    columnWidth: opts.columnWidth || 46,
    count: opts.count,
    baseSpeed: opts.baseSpeed,
    nextWord: opts.nextWord,
    fontSize: fontSize,
    lineHeight: opts.lineHeight,
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
    var lineHeight = field.lineHeight();
    ctx.clearRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 ' + fontSize + 'px ' + FONT_STACK;

    var items = field.items();
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      ctx.fillStyle = item.caught ? colors.tint : colors.text;
      ctx.globalAlpha = item.caught ? 1 : 0.82;
      var cx = item.x + item.width / 2;
      for (var c = 0; c < item.term.length; c += 1) {
        ctx.fillText(item.term.charAt(c), cx, item.y + c * lineHeight + lineHeight / 2);
      }
    }
    ctx.globalAlpha = 1;

    var time = clock();
    if (ripple && ripple.until > time) {
      var progress = 1 - (ripple.until - time) / RIPPLE_MS;
      ctx.save();
      ctx.strokeStyle = colors.tint;
      ctx.globalAlpha = Math.max(0, 1 - progress);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, 8 + progress * 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (rod) {
      ctx.save();
      ctx.strokeStyle = colors.tint;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rod.x, 0);
      ctx.lineTo(rod.x, rod.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rod.x, rod.y, 5, 0, Math.PI * 2);
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
    field.fill(opts.count || 60);
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

  /* One cast, one word: the rod is dropped at the pointer and hooks the first
   * word it touches. The hook is always lifted, whether it caught or not, so
   * the same word is reachable again next cast. */
  function castAt(point) {
    if (!point) return false;
    rod = { x: point.x, y: point.y };
    var caught = field.catchAt(point.x, point.y);
    if (!caught) {
      draw();
      return false;
    }
    rod = null;
    ripple = { x: point.x, y: point.y, until: clock() + RIPPLE_MS };
    draw();
    if (typeof opts.onCatch === 'function') opts.onCatch(caught);
    return true;
  }

  function onDown(event) {
    castAt(pointOf(event));
    if (canvas.setPointerCapture && event.pointerId != null) {
      try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    }
  }

  function onMove(event) {
    if (!rod) return;
    castAt(pointOf(event));
  }

  function onUp() {
    if (!rod) return;
    rod = null;
    draw();
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
      rod = null;
      ripple = null;
      field.releaseCaught();
      draw();
    },
    hasCanvas: !!ctx
  };
}
