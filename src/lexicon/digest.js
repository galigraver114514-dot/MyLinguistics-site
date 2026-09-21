/* Passive accumulation.
 *
 * Recognition state is a decaying familiarity score in [0, 1], grown by
 * exposure events and never by FSRS grades. FSRS models graded recall; mixing
 * look-only data into it would bias the parameter fit, so the two tracks stay
 * separate and meet only in the mastery display.
 */

export const HALF_LIFE_DAYS = 14;
export const MAX_FAMILIARITY = 1;

/* Above this familiarity a word is treated as known and leaves the passive
 * digest. It stays in the lexicon and in the browse view. */
export const KNOWN_THRESHOLD = 0.95;

export const CHANNEL_WEIGHT = Object.freeze({
  lookup: 1,
  lookonly: 0.6,
  digest: 0.5,
  river: 0.25,
  reading: 0.35,
  ambient: 0.2
});

export function clamp01(value) {
  if (!value || value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function decayFamiliarity(value, elapsedDays) {
  var v = clamp01(value);
  if (!elapsedDays || elapsedDays <= 0) return v;
  return v * Math.pow(0.5, elapsedDays / HALF_LIFE_DAYS);
}

export function bumpFamiliarity(value, channel) {
  var weight = CHANNEL_WEIGHT[channel] == null ? 0.3 : CHANNEL_WEIGHT[channel];
  var v = clamp01(value);
  var alpha = 0.3 * weight;
  return clamp01(v + (1 - v) * alpha);
}

export function currentFamiliarity(recognition, now) {
  if (!recognition) return 0;
  var time = now || Date.now();
  var elapsed = (time - (recognition.familiarityAt || time)) / 86400000;
  return decayFamiliarity(recognition.familiarity || 0, elapsed);
}

/* Prefer the mid frequency band: common enough to recur, rare enough to be
 * worth learning. rank is a 1-based frequency rank, lower is more common. */
export function frequencyBandWeight(rank, band) {
  if (!rank) return 0.5;
  var lo = (band && band.lo) || 12000;
  var hi = (band && band.hi) || 40000;
  if (rank >= lo && rank <= hi) return 1;
  if (rank < lo) return 0.35;
  var over = rank - hi;
  return Math.max(0.1, 1 - over / 60000);
}

export function digestScore(item, now, band) {
  var familiarity = item.familiarity == null ? 0 : item.familiarity;
  var unfamiliarity = 1 - clamp01(familiarity);
  var recurrence = Math.min(1, (item.recurrence || 1) / 3);
  var rank = item.word && item.word.frequency ? item.word.frequency.rank : null;
  var bandWeight = frequencyBandWeight(rank, band);
  var dueBoost = item.dueSoon ? 1.2 : 1;
  return bandWeight * unfamiliarity * recurrence * dueBoost;
}

export function buildDigest(items, options) {
  var now = (options && options.now) || Date.now();
  var limit = (options && options.limit) || 20;
  var band = options && options.band;
  return items
    .map(function (item) {
      var familiarity = currentFamiliarity(item.sense && item.sense.recognition, now);
      var scored = {
        sense: item.sense,
        word: item.word,
        recurrence: item.recurrence,
        familiarity: familiarity,
        source: item.source || null
      };
      scored.score = digestScore(scored, now, band);
      return scored;
    })
    .filter(function (item) { return item.familiarity < KNOWN_THRESHOLD; })
    .sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      var la = (a.word && a.word.lemma) || '';
      var lb = (b.word && b.word.lemma) || '';
      return la < lb ? -1 : (la > lb ? 1 : 0);
    })
    .slice(0, limit);
}
