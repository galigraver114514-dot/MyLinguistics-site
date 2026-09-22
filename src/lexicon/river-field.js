/* A flowing field of words.
 *
 * Several lanes, each with its own speed and direction; words are tiled along
 * them and wrapped so the stream never ends. Pure arithmetic: no canvas, no
 * DOM, no clock. The view steps it with a delta and draws it; a finger casts
 * the net through catchNear().
 */

export const DEFAULT_LANES = 6;
export const DEFAULT_GAP = 30;

export function createField(options) {
  var opts = options || {};
  var laneCount = Math.max(1, opts.lanes || DEFAULT_LANES);
  var gap = opts.gap == null ? DEFAULT_GAP : opts.gap;
  var random = opts.random || Math.random;
  var measure = opts.measure || function (term) {
    var size = opts.fontSize || 22;
    return { width: Math.ceil(String(term).length * size), height: Math.ceil(size * 1.4) };
  };
  var nextWord = opts.nextWord || function () { return null; };
  var width = opts.width || 800;
  var height = opts.height || 460;
  var items = [];
  var lanes = [];

  function buildLanes() {
    lanes = [];
    for (var i = 0; i < laneCount; i += 1) {
      var dir = i % 2 === 0 ? 1 : -1;
      var speed = (opts.baseSpeed || 30) * (0.55 + 0.2 * (i % 3)) * (0.9 + random() * 0.2);
      lanes.push({ index: i, dir: dir, speed: dir * speed });
    }
  }

  function band(index) {
    var laneHeight = height / laneCount;
    return { top: index * laneHeight, height: laneHeight };
  }

  function place(laneIndex, x) {
    var word = nextWord();
    if (!word || !word.term) return null;
    var size = measure(word.term);
    var area = band(laneIndex);
    return {
      term: String(word.term),
      reading: word.reading || '',
      lane: laneIndex,
      x: x,
      y: area.top + Math.max(0, (area.height - size.height) / 2),
      width: size.width,
      height: size.height,
      speed: lanes[laneIndex].speed,
      caught: false
    };
  }

  function laneMinX(laneIndex, except) {
    var min = Infinity;
    for (var i = 0; i < items.length; i += 1) {
      if (items[i] === except || items[i].lane !== laneIndex) continue;
      if (items[i].x < min) min = items[i].x;
    }
    return min;
  }

  function laneMaxRight(laneIndex, except) {
    var max = -Infinity;
    for (var i = 0; i < items.length; i += 1) {
      if (items[i] === except || items[i].lane !== laneIndex) continue;
      var right = items[i].x + items[i].width;
      if (right > max) max = right;
    }
    return max;
  }

  /* A word that leaves the field comes back on the other side, behind the
   * last word of its lane, so the lanes never clump. */
  function recycle(item) {
    var lane = lanes[item.lane];
    var word = nextWord();
    if (word && word.term) {
      item.term = String(word.term);
      item.reading = word.reading || '';
      var size = measure(item.term);
      item.width = size.width;
      item.height = size.height;
      var area = band(item.lane);
      item.y = area.top + Math.max(0, (area.height - size.height) / 2);
    }
    if (lane.dir > 0) {
      var min = laneMinX(item.lane, item);
      item.x = min === Infinity ? -item.width - gap : min - item.width - gap;
    } else {
      var max = laneMaxRight(item.lane, item);
      item.x = max === -Infinity ? width + gap : max + gap;
    }
    item.caught = false;
  }

  function resize(w, h) {
    width = Math.max(1, w || width);
    height = Math.max(1, h || height);
    if (!lanes.length) buildLanes();
    var area = height / laneCount;
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      item.y = band(item.lane).top + Math.max(0, (area - item.height) / 2);
      item.speed = lanes[item.lane].speed;
    }
  }

  function fill(count) {
    if (!lanes.length) buildLanes();
    items = [];
    var wanted = Math.max(1, Math.floor((count || opts.count || 60) / laneCount));
    for (var l = 0; l < laneCount; l += 1) {
      var dir = lanes[l].dir;
      var x = dir > 0 ? 0 : width;
      for (var k = 0; k < wanted; k += 1) {
        var item = place(l, x);
        if (!item) break;
        items.push(item);
        if (dir > 0) {
          x += item.width + gap;
          if (x > width) break;
        } else {
          x -= item.width + gap;
          if (x < -item.width) break;
        }
      }
    }
    return items.length;
  }

  function step(dt) {
    if (!dt || dt <= 0) return;
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      item.x += item.speed * dt;
      var lane = lanes[item.lane];
      if (lane.dir > 0 && item.x > width) recycle(item);
      else if (lane.dir < 0 && item.x + item.width < 0) recycle(item);
    }
  }

  function distanceTo(item, px, py) {
    var cx = Math.max(item.x, Math.min(px, item.x + item.width));
    var cy = Math.max(item.y, Math.min(py, item.y + item.height));
    var dx = px - cx;
    var dy = py - cy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function catchNear(x, y, radius) {
    var caught = [];
    for (var i = 0; i < items.length; i += 1) {
      if (items[i].caught) continue;
      if (distanceTo(items[i], x, y) <= radius) {
        items[i].caught = true;
        caught.push(items[i]);
      }
    }
    return caught;
  }

  return {
    resize: resize,
    fill: fill,
    step: step,
    items: function () { return items; },
    lanes: function () { return lanes.slice(); },
    catchNear: catchNear,
    caught: function () {
      return items.filter(function (item) { return item.caught; });
    },
    releaseCaught: function () {
      items.forEach(function (item) { item.caught = false; });
      return items.length;
    },
    catchAll: function () {
      items.forEach(function (item) { item.caught = true; });
      return items.slice();
    },
    width: function () { return width; },
    height: function () { return height; }
  };
}
