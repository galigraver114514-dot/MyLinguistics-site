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

  /* A word that leaves the bottom comes back above its own column's topmost
   * word, so the spacing inside a column can never close up. */
  function recycle(item) {
    var word = nextWord();
    if (word && word.term) {
      item.term = String(word.term);
      item.reading = word.reading || '';
      item.height = heightOf(item.term);
    }
    var min = columnTop(item.column, item);
    item.y = min === Infinity ? -item.height - gap : min - item.height - gap;
    item.caught = false;
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

  function fill(count) {
    if (!columns.length) buildColumns();
    items = [];
    var wanted = Math.max(1, Math.ceil((count || opts.count || 60) / Math.max(1, columns.length)));
    for (var c = 0; c < columns.length; c += 1) {
      var y = -gap * (c % 2);
      for (var k = 0; k < wanted; k += 1) {
        var item = place(columns[c], y);
        if (!item) break;
        y += item.height + gap;
        if (y > height) break;
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
  function step(dt) {
    if (!dt || dt <= 0) return;
    var wrapped = [];
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      item.y += item.speed * dt;
      if (item.y > height) wrapped.push(item);
    }
    for (var w = 0; w < wrapped.length; w += 1) recycle(wrapped[w]);
  }

  /* Put a different word in a slot that already exists, keeping where it is.
   * A taken word leaves no hole in its column: another word is already on its
   * way down that slot, which is what an endless river should do.
   *
   * `fade` (default on) is for a word arriving out of sight above the top edge,
   * where fading in is what makes a recycle read as the river refreshing rather
   * than as a word teleporting. The two replacements that happen *in view* - the
   * slot a word was just lifted from, and the slot a word is put back into - must
   * pass `fade: false`, or the new word is drawn from alpha 0 and the column
   * shows a blank exactly where the finger is until the fade finishes. */
  function replaceAt(item, word, options) {
    if (!item) return null;
    var next = word || nextWord();
    if (next && next.term) {
      item.term = String(next.term);
      item.reading = next.reading || '';
      item.height = heightOf(item.term);
      if (!options || options.fade !== false) item.born = now();
    }
    return item;
  }

  /* Which word is under a point, without marking anything: the view asks, the
   * field answers. `catchAt` is the same query from the rod's days and still
   * marks the word it finds. */
  function itemAt(x, y) {
    var found = null;
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
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
    replaceAt: replaceAt,
    caught: function () { return items.filter(function (item) { return item.caught; }); },
    releaseCaught: function () { clearCaught(); return items.length; },
    conflicts: conflicts,
    lineHeight: function () { return lineHeight; },
    fontSize: function () { return fontSize; },
    width: function () { return width; },
    height: function () { return height; }
  };
}
