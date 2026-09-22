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
  /* The rod is drawn from an animated position, not from the pointer's: a rod
   * that snaps to the finger reads as a cursor, and the whole gesture is meant
   * to be a rod going into water. `rodTarget` is where the finger is, `rod` is
   * where the rod is, and the gap between them is eased away every frame. */
  var rod = null;
  var rodTarget = null;
  var rodUp = null;
  var hook = 0;
  var ripple = null;
  var ROD_EASE = 0.28;
  var ROD_UP_MS = 220;

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

  /* The two colours the canvas paints with, read once and kept. This used to
   * call getComputedStyle on every frame - two forced style recalcs sixty times
   * a second, which is the kind of thing an iPad feels and a desktop does not.
   * The theme is the only thing that changes them, so the theme is what this
   * watches. */
  var colors = null;
  function palette() {
    if (colors) return colors;
    var text = '#000000';
    var tint = '#007aff';
    try {
      var styles = getComputedStyle(document.documentElement);
      text = (styles.getPropertyValue('--text') || text).trim() || text;
      tint = (styles.getPropertyValue('--tint') || tint).trim() || tint;
    } catch (err) { /* keep the defaults */ }
    colors = { text: text, tint: tint };
    return colors;
  }
  if (typeof MutationObserver === 'function' && typeof document !== 'undefined' && document.documentElement) {
    new MutationObserver(function () { colors = null; }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
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
    var nowMs = clock();
    var bornMs = field.bornMs || 260;
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      /* A word that has just been placed at the top fades in: the river is
       * endless, so a word appearing from nothing is the one thing that gives
       * away that it is a loop. */
      var age = item.born ? (nowMs - item.born) / bornMs : 1;
      var appear = age >= 1 ? 1 : Math.max(0, age);
      ctx.fillStyle = item.caught ? colors.tint : colors.text;
      ctx.globalAlpha = (item.caught ? 1 : 0.82) * appear;
      var cx = item.x + item.width / 2;
      var cy = item.y;
      for (var c = 0; c < item.term.length; c += 1) {
        var ch = item.term.charAt(c);
        if (appear < 1) {
          ctx.save();
          ctx.translate(cx, cy + c * lineHeight + lineHeight / 2);
          ctx.scale(1, 0.86 + 0.14 * appear);
          ctx.fillText(ch, 0, 0);
          ctx.restore();
        } else {
          ctx.fillText(ch, cx, cy + c * lineHeight + lineHeight / 2);
        }
      }
    }
    ctx.globalAlpha = 1;

    var time = clock();
    if (hook > time) {
      var k = 1 - (hook - time) / 180;
      ctx.save();
      ctx.strokeStyle = colors.tint;
      ctx.globalAlpha = Math.max(0, 0.9 - k);
      ctx.lineWidth = 3;
      ctx.beginPath();
      var tipAt = tip();
      ctx.arc(tipAt.x, tipAt.y, 5 + k * 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
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

    var shown = rod || rodUp;
    if (shown) {
      ctx.save();
      ctx.strokeStyle = colors.tint;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2;
      /* The line bends as it comes down: a straight stick reads as a cursor. */
      ctx.beginPath();
      ctx.moveTo(shown.x, 0);
      ctx.quadraticCurveTo(shown.x + 14, shown.y * 0.55, shown.x, shown.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(shown.x, shown.y, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function tip() {
    var shown = rod || rodUp;
    if (shown) return { x: shown.x, y: shown.y };
    return rodTarget ? { x: rodTarget.x, y: rodTarget.y } : { x: 0, y: 0 };
  }

  /* The rod lags the finger by design (see ROD_EASE), and comes back out of the
   * water when the gesture ends instead of disappearing. */
  function easeRod(dt) {
    if (rod && rodTarget) {
      var k = 1 - Math.pow(1 - ROD_EASE, Math.max(dt, 0.001) * 60);
      rod.x += (rodTarget.x - rod.x) * k;
      rod.y += (rodTarget.y - rod.y) * k;
    }
    if (rodUp) {
      var left = rodUp.until - clock();
      if (left <= 0) {
        rodUp = null;
      } else {
        var t = 1 - left / ROD_UP_MS;
        var eased = 1 - Math.pow(1 - t, 2);
        rodUp.y = rodUp.fromY + (-24 - rodUp.fromY) * eased;
        rodUp.x = rodUp.fromX;
      }
    }
  }

  function animating() { return running || !!rod || !!rodUp; }

  function resize() {
    var rect = canvas && typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
    var nextW = Math.max(280, Math.round((rect && rect.width) || (canvas && canvas.clientWidth) || opts.width || 720));
    var nextH = Math.max(220, Math.round((rect && rect.height) || (canvas && canvas.clientHeight) || opts.height || 440));
    width = nextW;
    height = nextH;
    if (canvas && (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr))) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    if (ctx && typeof ctx.setTransform === 'function') ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* Same box and words still in the water: nothing to do but paint. The view
     * is reused when 川 is reopened, and refilling on every arrival is what
     * emptied the river for a moment and refetched the pool for nothing. */
    if (field.resize(width, height) || !field.items().length) field.fill(opts.count || 60);
    draw();
  }

  /* One loop for the words and the rod. The words only move while the river is
   * running, but the rod has to keep animating when it is not - pausing the
   * stream should not freeze the thing the finger is holding. */
  function advance(ts) {
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
    last = ts;
    if (running) field.step(dt);
    easeRod(dt);
    draw();
    frameId = animating() && raf ? raf(advance) : null;
  }

  function kick() {
    if (!raf || frameId != null) return;
    last = 0;
    frameId = raf(advance);
  }

  function start() {
    if (running) return;
    running = true;
    kick();
    if (!raf) draw();
  }

  function stop() {
    running = false;
    if (!animating() && frameId != null && caf) caf(frameId);
    if (!animating()) frameId = null;
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
    rodTarget = { x: point.x, y: point.y };
    var caught = field.catchAt(point.x, point.y);
    if (!caught) return false;
    hook = clock() + 180;
    ripple = { x: point.x, y: point.y, until: clock() + RIPPLE_MS };
    if (typeof opts.onCatch === 'function') opts.onCatch(caught);
    return true;
  }

  /* The rod goes in from above the field rather than appearing under the
   * finger: a 24px drop is enough for the gesture to read as lowering a rod
   * into water, and it is the first thing the hand sees after a tap. */
  function onDown(event) {
    var point = pointOf(event);
    rod = { x: point.x, y: -24 };
    rodTarget = { x: point.x, y: point.y };
    rodUp = null;
    castAt(point);
    kick();
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
    lift();
  }

  function lift() {
    if (rod) rodUp = { x: rod.x, y: rod.y, fromX: rod.x, fromY: rod.y, until: clock() + ROD_UP_MS };
    rod = null;
    rodTarget = null;
    field.releaseCaught();
    kick();
    if (!raf) draw();
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
      /* The catch is done: lift the rod out, and let the ripple finish. The
       * rod used to vanish on the same frame the word was hooked, which is the
       * one moment the gesture most wants to be animated. */
      rodUp = rod
        ? { x: rod.x, y: rod.y, fromX: rod.x, fromY: rod.y, until: clock() + ROD_UP_MS }
        : rodUp;
      rod = null;
      rodTarget = null;
      field.releaseCaught();
      kick();
      if (!raf) draw();
    },
    refill: function (count) {
      var wanted = count || opts.count || field.items().length || 60;
      field.fill(wanted);
      field.coverTop();
      draw();
      return field.items().length;
    },
    tip: tip,
    hasCanvas: !!ctx
  };
}
