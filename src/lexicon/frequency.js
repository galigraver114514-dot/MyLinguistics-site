/* Frequency lists.
 *
 * The design prefers a self-built list derived from 青空文庫 over a JLPT list,
 * because novels and essays match the reading target. Any list is accepted
 * here: a word and a rank per line, in either order, separated by whitespace,
 * a comma or a tab. Rank 1 is the most common word.
 *
 * A list is used twice: to weight candidates toward the mid band, and as the
 * lexicon that upgrades segmentation from script runs to maximal matching.
 */

export function parseFrequencyList(text) {
  var rows = [];
  String(text == null ? '' : text).split(/\r?\n/).forEach(function (line) {
    var trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === '#') return;
    var parts = trimmed.split(/[\s,;\t]+/).filter(function (part) { return part.length > 0; });
    if (parts.length < 2) return;
    var first = parts[0];
    var second = parts[1];
    var rank = null;
    var lemma = null;
    if (/^\d+$/.test(first) && !/^\d+$/.test(second)) {
      rank = Number(first);
      lemma = second;
    } else if (/^\d+$/.test(second) && !/^\d+$/.test(first)) {
      rank = Number(second);
      lemma = first;
    } else {
      return;
    }
    if (!lemma || !rank || rank < 1) return;
    rows.push({ lemma: lemma.normalize('NFKC'), rank: rank });
  });

  var byLemma = new Map();
  rows.forEach(function (row) {
    var existing = byLemma.get(row.lemma);
    if (!existing || row.rank < existing.rank) byLemma.set(row.lemma, row);
  });
  return Array.from(byLemma.values()).sort(function (a, b) { return a.rank - b.rank; });
}
