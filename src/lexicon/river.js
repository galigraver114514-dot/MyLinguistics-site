/* Shuffling for the word river's pool.
 *
 * The field in river-field.js owns the motion and recycles its own words, so
 * the only thing left here is the one pure helper the pool needs: a shuffle
 * that never mutates its input and takes an injectable random, so it can be
 * tested without a seed.
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
