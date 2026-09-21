/* The candidate funnel.
 *
 * Vocabulary is never "whatever appeared". A candidate has to pass a filter
 * and is then ranked, because the cost of a card grows with how much the
 * learner has to do with it. This module is pure: it takes token surfaces and
 * a few lookup functions and returns ranked candidates. The frequency band,
 * recurrence rule and caps are the ones in 17.2 of the design.
 */

import { frequencyBandWeight } from './digest.js';

/* Below this rank a word is common enough that an N1+ reader almost certainly
 * knows it; it never reaches the inbox. Only applied when a frequency list has
 * actually been imported, because making it up would be worse than skipping it. */
export var ALREADY_KNOWN_RANK = 3000;

export function selectCandidates(tokens, options) {
  var opts = options || {};
  var list = tokens || [];

  var counts = new Map();
  var firstSeen = new Map();
  list.forEach(function (token, index) {
    var lemma = String(token == null ? '' : token);
    if (!lemma) return;
    counts.set(lemma, (counts.get(lemma) || 0) + 1);
    if (!firstSeen.has(lemma)) firstSeen.set(lemma, index);
  });

  var known = opts.known;
  var ignore = opts.ignore;
  function excluded(set, lemma) {
    if (!set) return false;
    if (typeof set === 'function') return !!set(lemma);
    if (typeof set.has === 'function') return set.has(lemma);
    return false;
  }

  var rankOf = typeof opts.rankOf === 'function' ? opts.rankOf : function () { return null; };
  var sentencesFor = typeof opts.sentencesFor === 'function' ? opts.sentencesFor : function () { return []; };
  var minRecurrence = opts.minRecurrence == null ? 2 : opts.minRecurrence;
  var cap = opts.cap == null ? 200 : opts.cap;
  var floor = opts.knownRankFloor == null ? ALREADY_KNOWN_RANK : opts.knownRankFloor;
  var band = opts.band;

  var candidates = [];
  counts.forEach(function (count, lemma) {
    if (count < minRecurrence) return;
    if (excluded(known, lemma)) return;
    if (excluded(ignore, lemma)) return;
    var rank = rankOf(lemma) || null;
    if (rank && rank < floor) return;
    var weight = frequencyBandWeight(rank, band);
    var recurrence = Math.min(1, count / 3);
    candidates.push({
      lemma: lemma,
      count: count,
      rank: rank,
      bandWeight: weight,
      score: weight * recurrence,
      sentences: sentencesFor(lemma)
    });
  });

  candidates.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if (b.count !== a.count) return b.count - a.count;
    if (a.rank && b.rank && a.rank !== b.rank) return a.rank - b.rank;
    return (firstSeen.get(a.lemma) || 0) - (firstSeen.get(b.lemma) || 0);
  });
  return candidates.slice(0, cap);
}

/* Distinct sentences a token appears in, up to a few, for card context. */
export function sentenceMap(sentences, tokenize) {
  var map = {};
  (sentences || []).forEach(function (sentence) {
    var text = typeof sentence === 'string' ? sentence : sentence.text;
    var tokens = tokenize(text);
    var seen = new Set();
    tokens.forEach(function (token) {
      if (seen.has(token)) return;
      seen.add(token);
      if (!map[token]) map[token] = [];
      if (map[token].length < 3) map[token].push(text);
    });
  });
  return map;
}
