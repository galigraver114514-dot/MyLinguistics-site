/* The word river: a random, context-free stream over a fixed pool.
 *
 * It is deliberately dumb. No context, no ranking, no grading: it shuffles the
 * pool, hands out one word at a time, and reshuffles when it runs out. The
 * caller records an exposure for the word on screen. Keeping the shuffling pure
 * and injectable is what makes it testable and what lets the pool grow to a
 * dictionary later without touching this file.
 */

export function shuffle(list, random) {
  var rand = random || Math.random;
  var copy = list.slice();
  for (var i = copy.length - 1; i > 0; i -= 1) {
    var j = Math.floor(rand() * (i + 1));
    var swap = copy[i];
    copy[i] = copy[j];
    copy[j] = swap;
  }
  return copy;
}

export function createRiver(items, options) {
  var pool = Array.isArray(items) ? items : [];
  var opts = options || {};
  var random = opts.random || Math.random;
  var order = [];
  var cursor = 0;

  function refill() {
    order = shuffle(pool, random);
    cursor = 0;
  }
  refill();

  return {
    next: function () {
      if (!pool.length) return null;
      if (cursor >= order.length) refill();
      var item = order[cursor];
      cursor += 1;
      return item;
    },
    refill: refill,
    size: function () { return pool.length; }
  };
}
