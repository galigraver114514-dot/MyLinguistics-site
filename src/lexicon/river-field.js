/* A vertical field of words.
 *
 * Tategaki: words fall from the top in columns, one character under the last.
 * Several columns drift down, each at its own speed, words tiled and recycled
 * behind their column so the stream never ends. Pure arithmetic: no canvas, no
 * DOM, no clock. The view draws it; the rod hooks one word through catchAt().
 *
 * A word's box is a whole number of character cells, so two words in one
 * column can only touch if the layout puts them there - and it never does.
 */

export const DEFAULT_COLUMNS = 6;
/* The board's river is a dense stream, not a ladder: words sit close enough
 * that a column reads as one flow of text. 18px of gap between words of
 * different lengths left holes the eye reads as the stream running out. */
export const DEFAULT_GAP = 12;
export const DEFAULT_FONT = 24;
/* How long a word takes to arrive after it is placed at the top. The view
 * draws it fading in, which is what makes a recycle read as the river
 * refreshing rather than as a word teleporting. */
export const BORN_MS = 260;

export function createField(options) {
  var opts = options || {};
  var gap = opts.gap == null ? DEFAULT_GAP : opts.gap;
  var random = opts.random || Math.random;
  var fontSize = opts.fontSize || DEFAULT_FONT;
  var lineHeight = opts.lineHeight || Math.round(fontSize * 1.18);
  var nextWord = opts.nextWord || function () { return null; };
  var width = opts.width || 720;
  var height = opts.height || 440;
  var items = [];
  var columns = [];
  var clock = opts.clock || (typeof performance !== 'undefined' && performance.now
    ? function () { return performance.now(); }
    : function () { return Date.now(); });
  function now() { return clock(); }

  /* How many columns: a fixed count when asked for, otherwise as many as fit
   * at the target width, so a wide iPad is densely packed and a phone is not. */
  function columnCountFor() {
    if (opts.columns) return Math.max(1, opts.columns);
    if (opts.columnWidth) return Math.max(3, Math.min(14, Math.round(width / opts.columnWidth)));
    return DEFAULT_COLUMNS;
  }

  function buildColumns() {
    columns = [];
    var count = columnCountFor();
    var slot = width / count;
    /* The chip is the word's box plus its padding, so the box is a little
     * narrower than the column: 5 columns in 394px comes out at the board's
     * own proportions - a 46px chip on a 79px pitch. */
    var cell = Math.max(12, Math.min(slot - 14, fontSize * 1.3));
    for (var i = 0; i < count; i += 1) {
      var speed = (opts.baseSpeed || 34) * (0.72 + 0.16 * (i % 4)) * (0.9 + random() * 0.2);
      columns.push({ index: i, x: slot * (i + 0.5) - cell / 2, cell: cell, speed: speed });
    }
  }

  function heightOf(term) {
    return Math.max(lineHeight, String(term).length * lineHeight);
  }

  function clearCaught() {
    items.forEach(function (item) { item.caught = false; });
  }

  function place(column, y) {
    var word = nextWord();
    if (!word || !word.term) return null;
    var term = String(word.term);
    var item = {
      term: term,
      reading: word.reading || '',
      column: column.index,
      x: column.x,
      y: y,
      width: column.cell,
      height: heightOf(term),
      speed: column.speed,
      caught: false,
      born: now()
    };
    items.push(item);
    return item;
  }

  /* Placing a word *above* the column: the same as place(), but the height is
   * known before the position is, because the position depends on it. */
  function prepend(column) {
    var word = nextWord();
    if (!word || !word.term) return null;
    var term = String(word.term);
    var height = heightOf(term);
    var top = columnTop(column.index, null);
    var item = {
      term: term,
      reading: word.reading || '',
      column: column.index,
      x: column.x,
      y: (top === Infinity ? 0 : top) - height - gap,
      width: column.cell,
      height: height,
      speed: column.speed,
      caught: false,
      born: now()
    };
    items.push(item);
    return item;
  }

  function columnTop(columnIndex, except) {
    var min = Infinity;
    for (var i = 0; i < items.length; i += 1) {
      if (items[i] === except || items[i].column !== columnIndex) continue;
      if (items[i].y < min) min = items[i].y;
    }
    return min;
  }

  /* Returns whether anything actually moved. A resize that changes nothing
   * keeps the words: the view is reused whenever 川 is reopened. */
  function resize(w, h) {
    var nextW = Math.max(1, w || width);
    var nextH = Math.max(1, h || height);
    if (nextW === width && nextH === height && items.length) return false;
    width = nextW;
    height = nextH;
    buildColumns();
    items = [];
    return true;
  }

  /* Deep enough to reach past the bottom edge by the tallest word in the column.
   * That reserve below the view is what feeds the top while the river flows
   * (feedTops()); a column that stops at the bottom edge has nothing to feed it
   * with and shows a blank strip above its words. */
  function fill(count) {
    if (!columns.length) buildColumns();
    items = [];
    var perColumn = Math.max(1, Math.ceil((count || opts.count || 60) / Math.max(1, columns.length)));
    for (var c = 0; c < columns.length; c += 1) {
      var y = -gap * (c % 2);
      var tallest = lineHeight;
      for (var k = 0; k < perColumn * 3; k += 1) {
        var item = place(columns[c], y);
        if (!item) break;
        if (item.height > tallest) tallest = item.height;
        y += item.height + gap;
        if (y > height + tallest + gap) break;
      }
    }
    coverTop();
    return items.length;
  }

  /* Every column keeps a word at or above the top edge. A column whose topmost
   * word has fallen into view leaves a blank band above it, and a blank band at
   * the top of the river is the one thing that reads as the stream having run
   * out - which is what "the top refreshes slowly" looks like. */
  function coverTop() {
    for (var c = 0; c < columns.length; c += 1) {
      for (var guard = 0; guard < 10; guard += 1) {
        var top = columnTop(columns[c].index, null);
        if (top !== Infinity && top <= -lineHeight) break;
        if (!prepend(columns[c])) break;
      }
    }
    return items.length;
  }

  /* Move first, then wrap.
   *
   * Recycling inside the same loop that moves the words reads a half-updated
   * column: an item later in the array has not taken its step yet, so
   * columnTop() hands back a stale neighbour and the wrapped word is placed
   * exactly one step's travel too high. The hole that opens never closes again,
   * and every wrap can widen it - which is what an occasional gap drifting down
   * a column is. Both passes are O(n) and the second one only touches the words
   * that actually left the bottom. */
  /* Every column keeps a word across its top edge while the river flows, and the
   * words keep changing while it does.
   *
   * The feed runs on the top's schedule, not the bottom's: recycling only when a
   * word left the bottom lifted the top by *that* word's height while the column had
   * drifted by the word above it - two different numbers - so the top wandered below
   * the edge (the blank strip 川 showed while it flowed).
   *
   * The word that fills the top is a *fresh* one from the pool, taken from a slot
   * below the view where nothing visible depends on it. Fresh matters: feeding each
   * column its own word back looks alive while showing the same handful forever.
   *
   * What bounds the field is the reservoir, not the word's identity. A column may
   * keep a few words below the view (RESERVE); when that runs out it is given one,
   * and the surplus is dropped - so the count settles instead of growing for as long
   * as 川 is left open, and nothing on screen moves for either. */
  var RESERVE = 3;

  /* Give a slot a fresh word from the pool. The height comes with the word, so the
   * caller places the slot after this. */
  function refill(item) {
    var word = nextWord();
    if (word && word.term) {
      item.term = String(word.term);
      item.reading = word.reading || '';
      item.height = heightOf(item.term);
    }
    item.caught = false;
    return item;
  }

  function columnItems(index) {
    var out = [];
    for (var i = 0; i < items.length; i += 1) {
      if (items[i].column === index) out.push(items[i]);
    }
    return out;
  }

  function deepestOf(list) {
    var deep = null;
    for (var i = 0; i < list.length; i += 1) {
      if (!deep || list[i].y > deep.y) deep = list[i];
    }
    return deep;
  }

  function feedTops() {
    for (var c = 0; c < columns.length; c += 1) {
      var index = columns[c].index;
      var mine = columnItems(index);
      if (!mine.length) continue;

      var top = mine.reduce(function (a, b) { return a.y <= b.y ? a : b; });
      if (top.y > 0) {
        /* The top edge is no longer crossed: bring a word up from below the view. */
        var below = mine.filter(function (item) { return item.y > height && item.term; });
        if (below.length) {
          var source = deepestOf(below);
          refill(source);
          source.y = top.y - source.height - gap;
        } else {
          prepend(columns[c]);   // the column has run short: it needs one more
        }
        mine = columnItems(index);
      }

      /* Keep the reserve small. Deepest first: those are the ones the feed will not
       * need for the longest time. Dropping is free - they are below the view. */
      var reserve = mine.filter(function (item) { return item.y > height; });
      while (reserve.length > RESERVE) {
        var dead = deepestOf(reserve);
        items.splice(items.indexOf(dead), 1);
        reserve.splice(reserve.indexOf(dead), 1);
      }
    }
  }

  function step(dt) {
    if (!dt || dt <= 0) return;
    for (var i = 0; i < items.length; i += 1) items[i].y += items[i].speed * dt;
    feedTops();
  }

  /* The slot a word was lifted from stays empty.
   *
   * It used to be given a new word on the same frame so the column never showed a
   * hole. The human's rule is the opposite: the hole is what taking a word leaves,
   * and filling it only repeats a word that is already in the water (the pool is a
   * cycle). The box stays, so the column's spacing is untouched - the hole is
   * exactly the size of the word that was there. */
  function empty(item) {
    if (!item) return null;
    item.term = '';
    item.reading = '';
    item.caught = false;
    return item;
  }

  /* The word goes back into the river: into its own slot while that is still there,
   * otherwise in at the top of its column - a slot that has scrolled past the bottom
   * is dropped, and the word is still water. */
  function restore(item, word) {
    if (!word || !word.term) return null;
    if (item && items.indexOf(item) >= 0) {
      item.term = String(word.term);
      item.reading = word.reading || '';
      item.height = heightOf(item.term);
      item.caught = false;
      return item;
    }
    var column = columns[0];
    for (var c = 0; c < columns.length; c += 1) {
      if (item && columns[c].index === item.column) column = columns[c];
    }
    var fresh = prepend(column);
    if (!fresh) return null;
    fresh.term = String(word.term);
    fresh.reading = word.reading || '';
    fresh.height = heightOf(fresh.term);
    var top = columnTop(column.index, fresh);
    fresh.y = (top === Infinity ? 0 : top) - fresh.height - gap;
    return fresh;
  }

  /* Which word is under a point, without marking anything: the view asks, the
   * field answers. `catchAt` is the same query from the rod's days and still
   * marks the word it finds. */
  function itemAt(x, y) {
    var found = null;
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      if (!item.term) continue;          // an empty slot holds nothing to take
      if (x < item.x || x > item.x + item.width) continue;
      if (y < item.y || y > item.y + item.height) continue;
      if (!found || item.y > found.y) found = item;
    }
    return found;
  }

  function catchAt(x, y) {
    var found = null;
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      if (x < item.x || x > item.x + item.width) continue;
      if (y < item.y || y > item.y + item.height) continue;
      if (!found || item.y > found.y) found = item;
    }
    if (!found) return null;
    found.caught = true;
    return found;
  }

  /* Any two words in one column that share a pixel. Always empty; kept as a
   * guard for the tests, because overlap is the one thing this must not do. */
  function conflicts() {
    var out = [];
    for (var i = 0; i < items.length; i += 1) {
      for (var j = i + 1; j < items.length; j += 1) {
        if (items[i].column !== items[j].column) continue;
        if (items[i].y < items[j].y + items[j].height && items[j].y < items[i].y + items[i].height) {
          out.push([items[i].term, items[j].term]);
        }
      }
    }
    return out;
  }

  return {
    resize: resize,
    fill: fill,
    coverTop: coverTop,
    bornMs: BORN_MS,
    step: step,
    items: function () { return items; },
    columns: function () { return columns.slice(); },
    catchAt: catchAt,
    itemAt: itemAt,
    empty: empty,
    restore: restore,
    caught: function () { return items.filter(function (item) { return item.caught; }); },
    releaseCaught: function () { clearCaught(); return items.length; },
    conflicts: conflicts,
    lineHeight: function () { return lineHeight; },
    fontSize: function () { return fontSize; },
    width: function () { return width; },
    height: function () { return height; }
  };
}
