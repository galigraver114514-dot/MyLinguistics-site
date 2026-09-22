/* The canvas half of the word river.
 *
 * river-field.js owns the words and their motion; this file owns the pixels,
 * the clock, and the gesture. Every word is drawn as a chip - a rounded rect
 * with a border and a surface inside it, the character stack running down the
 * middle - which is what the board draws and what makes a column read as a
 * stream of words rather than as loose text.
 *
 * The gesture is press-and-hold, then drag: the word lifts out of the water and
 * follows the finger, and letting go over the bucket puts it there. There is no
 * rod. On a device this is a 2D canvas; where there is no 2D context - a
 * headless test - the same field renders as absolutely positioned spans so the
 * gesture can still be made and the pool wiring tested.
 */
import { createField } from './river-field.js';

var FONT_STACK = '-apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
var LONG_PRESS_MS = 300;
var LIFT_MS = 150;
var CHIP_PAD = 4;
var CHIP_RADIUS = 9;

export function createRiverView(canvas, options) {
  var opts = options || {};
  var fallback = opts.fallback || null;
  var dropEl = opts.dropTarget || null;
  var ctx = null;
  try {
    ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  } catch (err) {
    ctx = null;
  }

  var fontSize = opts.fontSize || 24;
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
  var heldNode = null;
  var running = false;
  var frameId = null;
  var last = 0;
  /* A press that has not matured yet, the word that has been picked up, and the
   * slot it came from - which is where it goes back to if it is dropped
   * anywhere but the bucket. */
  var press = null;
  var pressTimer = null;
  var held = null;
  var overDrop = false;

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

  /* The colours the canvas paints with, read once and kept. This used to call
   * getComputedStyle on every frame - two forced style recalcs sixty times a
   * second, which is the kind of thing an iPad feels and a desktop does not.
   * The theme is the only thing that changes them, so the theme is what this
   * watches. */
  var colors = null;
  function palette() {
    if (colors) return colors;
    var out = {
      text: '#000000', tint: '#007aff', ink: '#ffffff',
      surface: '#ffffff', border: 'rgba(0,0,0,0.12)'
    };
    try {
      var styles = getComputedStyle(document.documentElement);
      var read = function (name, fallbackValue) {
        return (styles.getPropertyValue(name) || '').trim() || fallbackValue;
      };
      out.text = read('--text', out.text);
      out.tint = read('--tint', out.tint);
      out.ink = read('--tint-contrast', out.ink);
      out.surface = read('--surface', out.surface);
      out.border = read('--border', out.border);
    } catch (err) { /* keep the defaults */ }
    colors = out;
    return colors;
  }
  if (typeof MutationObserver === 'function' && typeof document !== 'undefined' && document.documentElement) {
    new MutationObserver(function () { colors = null; }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function roundRect(x, y, w, h, r) {
    var rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /* One chip, at an offset from the word's own box (which is what the field
   * moves and hit-tests against). */
  function chip(item, dx, dy, scale, raised) {
    var colorsHere = palette();
    var lineHeight = field.lineHeight();
    var w = (item.width + CHIP_PAD * 2) * scale;
    var h = (item.height + CHIP_PAD * 2) * scale;
    var cx = item.x + item.width / 2 + dx;
    var cy = item.y + item.height / 2 + dy;
    var x = cx - w / 2;
    var y = cy - h / 2;
    ctx.save();
    if (raised) {
      ctx.shadowColor = 'rgba(0,0,0,0.22)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
    }
    roundRect(x, y, w, h, CHIP_RADIUS * scale);
    ctx.fillStyle = raised ? colorsHere.tint : colorsHere.surface;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = raised ? colorsHere.tint : colorsHere.border;
    ctx.stroke();
    ctx.fillStyle = raised ? colorsHere.ink : colorsHere.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 ' + (fontSize * scale) + 'px ' + FONT_STACK;
    for (var c = 0; c < item.term.length; c += 1) {
      ctx.fillText(item.term.charAt(c), cx - 1, y + CHIP_PAD * scale + c * lineHeight * scale + (lineHeight * scale) / 2);
    }
    ctx.restore();
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
    });
    /* The held word has no slot, so the fallback gives it a node of its own. */
    if (held && !heldNode) {
      heldNode = document.createElement('span');
      heldNode.className = 'wb-river-word is-held';
      fallback.appendChild(heldNode);
    }
    if (!held && heldNode) {
      heldNode.remove();
      heldNode = null;
    }
    if (held && heldNode) {
      heldNode.textContent = held.term;
      heldNode.style.transform = 'translate(' + Math.round(held.x - 14) + 'px,' + Math.round(held.y - 14) + 'px)';
    }
  }

  function draw() {
    if (!ctx) {
      syncFallback();
      return;
    }
    var colorsHere = palette();
    ctx.clearRect(0, 0, width, height);

    var items = field.items();
    var nowMs = clock();
    var bornMs = field.bornMs || 260;
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      /* A word that has been placed at the top fades in: the river is endless,
       * so a word appearing from nothing is the one thing that gives away that
       * it is a loop. */
      var age = item.born ? (nowMs - item.born) / bornMs : 1;
      var appear = age >= 1 ? 1 : Math.max(0, age);
      var pressScale = press && press.item === item ? 1 + 0.06 * press.amount : 1;
      ctx.globalAlpha = appear;
      chip(item, 0, 0, pressScale, false);
      if (press && press.item === item && press.amount > 0) {
        /* The word swells while it is being held down, so the long press says
         * something before it fires - otherwise the first feedback a finger
         * gets is the word already in the air. */
        ctx.save();
        ctx.globalAlpha = appear * (1 - press.amount) * 0.5;
        ctx.strokeStyle = colorsHere.tint;
        ctx.lineWidth = 2;
        roundRect(item.x - CHIP_PAD - 3, item.y - CHIP_PAD - 3,
          item.width + CHIP_PAD * 2 + 6, item.height + CHIP_PAD * 2 + 6, CHIP_RADIUS + 3);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;

    if (held) {
      var lifted = {
        term: held.term,
        height: held.height,
        width: held.width,
        x: held.x - held.width / 2,
        y: held.y - held.height / 2
      };
      chip(lifted, 0, 0, 1 + 0.06 * held.lift, true);
    }
  }

  function animating() { return running || !!press || !!held; }

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
    if (field.resize(width, height) || !field.items().length) {
      dropHeld(false);
      field.fill(opts.count || 60);
    }
    draw();
  }

  /* One loop for the words, the press and the held word. */
  function advance(ts) {
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
    last = ts;
    if (running) field.step(dt);
    if (press) press.amount = Math.min(1, (clock() - press.at) / LONG_PRESS_MS);
    if (held && held.lift < 1) held.lift = Math.min(1, held.lift + dt * (1000 / LIFT_MS));
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

  function overDropZone(clientX, clientY) {
    if (!dropEl || typeof dropEl.getBoundingClientRect !== 'function') return false;
    var r = dropEl.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function markDropZone(on) {
    if (on === overDrop) return;
    overDrop = on;
    if (dropEl && dropEl.classList) dropEl.classList.toggle('is-over', on);
  }

  /* Picking a word up takes it out of its column and puts another one in its
   * place on the same frame: the slot never stays empty, and the column keeps
   * behaving like a stream instead of a hole. */
  function lift() {
    pressTimer = null;
    var item = press && press.item;
    if (!item || item.term !== press.term) { press = null; return false; }
    held = {
      term: item.term,
      reading: item.reading || '',
      width: item.width,
      height: item.height,
      x: press.x,
      y: press.y,
      lift: 0,
      slot: item
    };
    field.replaceAt(item);
    press = null;
    kick();
    return true;
  }

  function dropHeld(landedInBucket) {
    if (!held) return null;
    var taken = { term: held.term, reading: held.reading };
    if (!landedInBucket && held.slot) {
      /* Let go anywhere but the bucket and the word goes back where it came
       * from - it is the same river, and nothing was decided. */
      field.replaceAt(held.slot, { term: taken.term, reading: taken.reading });
    }
    held = null;
    markDropZone(false);
    kick();
    if (!raf) draw();
    return taken;
  }

  /* The press matures on a timer rather than on a frame: a page without
   * requestAnimationFrame still has to be able to pick a word up, which is
   * exactly the situation in a headless test. The frames only paint it. */
  function onDown(event) {
    var point = pointOf(event);
    var item = field.itemAt(point.x, point.y);
    clearTimeout(pressTimer);
    press = item
      ? { item: item, term: item.term, x: point.x, y: point.y, at: clock(), amount: 0 }
      : null;
    if (press) {
      pressTimer = setTimeout(lift, LONG_PRESS_MS);
      kick();
      if (canvas.setPointerCapture && event.pointerId != null) {
        try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
      }
    }
  }

  function onMove(event) {
    var point = pointOf(event);
    if (held) {
      held.x = point.x;
      held.y = point.y;
      markDropZone(overDropZone(event.clientX, event.clientY));
      kick();
      return;
    }
    if (!press) return;
    /* A finger that travels before the press matures was not holding anything
     * still, and the press is abandoned. */
    if (Math.abs(point.x - press.x) > 12 || Math.abs(point.y - press.y) > 12) {
      clearTimeout(pressTimer);
      pressTimer = null;
      press = null;
    }
  }

  function onUp(event) {
    if (held) {
      var inBucket = overDropZone(event.clientX, event.clientY);
      var taken = dropHeld(inBucket);
      if (inBucket && taken && typeof opts.onDrop === 'function') opts.onDrop(taken);
      return;
    }
    clearTimeout(pressTimer);
    pressTimer = null;
    press = null;
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
    /* Held only while a word is in the air, so a destination change drops it. */
    release: function () {
      dropHeld(false);
      clearTimeout(pressTimer);
      pressTimer = null;
      press = null;
      draw();
    },
    refill: function (count) {
      var wanted = count || opts.count || field.items().length || 60;
      dropHeld(false);
      field.fill(wanted);
      field.coverTop();
      draw();
      return field.items().length;
    },
    /* What the finger is holding, for the interaction check. */
    holding: function () { return held ? { term: held.term, x: held.x, y: held.y } : null; },
    hasCanvas: !!ctx
  };
}
