/* FSRS-6 core, default parameters.
 *
 * Source of the formulas and the default weights:
 *   https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
 *
 * Memory state is Stability (S) and Difficulty (D). Retrievability R(t, S)
 * uses the FSRS-6 trainable decay w[20]. The scheduler returns a new srs
 * object; it never mutates the card.
 *
 * Short-term policy (not part of FSRS): a lapse returns in ten minutes, and a
 * new card rated again enters relearning. FSRS models the memory; the app
 * owns the within-session steps.
 */

export const DEFAULT_PARAMS = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133,
  0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483,
  0.6014, 1.8729, 0.5425, 0.0912, 0.0658,
  0.1542
]);

export const RATINGS = Object.freeze({ again: 1, hard: 2, good: 3, easy: 4 });

export const DAY_MS = 24 * 60 * 60 * 1000;
export const RELEARN_MS = 10 * 60 * 1000;

export function clamp(value, lo, hi) {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

export function ratingValue(rating) {
  if (typeof rating === 'number') return rating;
  return RATINGS[rating] || 3;
}

export function retrievability(elapsedDays, stability, params) {
  var w = params || DEFAULT_PARAMS;
  var decay = w[20];
  var factor = Math.pow(0.9, -1 / decay) - 1;
  var s = Math.max(stability, 0.1);
  var t = Math.max(0, elapsedDays);
  return Math.pow(1 + factor * t / s, -decay);
}

export function initialStability(grade, params) {
  var w = params || DEFAULT_PARAMS;
  return clamp(w[grade - 1], 0.1, 100);
}

export function initialDifficulty(grade, params) {
  var w = params || DEFAULT_PARAMS;
  return clamp(w[4] - Math.exp(w[5] * (grade - 1)) + 1, 1, 10);
}

export function nextDifficulty(difficulty, grade, params) {
  var w = params || DEFAULT_PARAMS;
  var delta = -w[6] * (grade - 3);
  var damped = difficulty + delta * (10 - difficulty) / 9;
  var target = initialDifficulty(4, w);
  return clamp(w[7] * target + (1 - w[7]) * damped, 1, 10);
}

export function recallStability(stability, difficulty, r, grade, params) {
  var w = params || DEFAULT_PARAMS;
  var hard = grade === 2 ? w[15] : 1;
  var easy = grade === 4 ? w[16] : 1;
  var increase = Math.exp(w[8]) * (11 - difficulty) * Math.pow(stability, -w[9])
    * (Math.exp(w[10] * (1 - r)) - 1) * hard * easy;
  return stability * (1 + increase);
}

export function forgetStability(stability, difficulty, r, params) {
  var w = params || DEFAULT_PARAMS;
  return w[11] * Math.pow(difficulty, -w[12]) * (Math.pow(stability + 1, w[13]) - 1)
    * Math.exp(w[14] * (1 - r));
}

export function shortTermStability(stability, grade, params) {
  var w = params || DEFAULT_PARAMS;
  var next = stability * Math.exp(w[17] * (grade - 3 + w[18])) * Math.pow(Math.max(stability, 0.1), -w[19]);
  if (grade >= 2 && next < stability) next = stability;
  return next;
}

export function intervalDays(stability, retention, params) {
  var w = params || DEFAULT_PARAMS;
  var decay = w[20];
  var factor = Math.pow(0.9, -1 / decay) - 1;
  var r = clamp(retention || 0.9, 0.7, 0.99);
  var t = stability / factor * (Math.pow(r, -1 / decay) - 1);
  return Math.max(1, Math.round(t));
}

export function schedule(srs, rating, now, options) {
  var w = (options && options.params) || DEFAULT_PARAMS;
  var retention = (options && options.retention) || 0.9;
  var time = now || Date.now();
  var grade = ratingValue(rating);
  var current = srs || { phase: 'new', stability: 0, difficulty: 0, due: 0, last: 0, reps: 0, lapses: 0 };
  var next = {
    phase: current.phase || 'new',
    stability: current.stability || 0,
    difficulty: current.difficulty || 0,
    due: current.due || 0,
    last: current.last || 0,
    reps: (current.reps || 0) + 1,
    lapses: current.lapses || 0
  };

  if (next.phase === 'new' || !next.stability) {
    next.stability = initialStability(grade, w);
    next.difficulty = initialDifficulty(grade, w);
    if (grade === 1) {
      next.phase = 'relearning';
      next.due = time + RELEARN_MS;
    } else {
      next.phase = 'review';
      next.due = time + intervalDays(next.stability, retention, w) * DAY_MS;
    }
    next.last = time;
    return next;
  }

  var elapsed = (time - (current.last || time)) / DAY_MS;
  var r = retrievability(elapsed, current.stability, w);
  next.difficulty = nextDifficulty(current.difficulty, grade, w);

  if (grade === 1) {
    next.lapses += 1;
    next.stability = forgetStability(current.stability, next.difficulty, r, w);
    next.phase = 'relearning';
    next.due = time + RELEARN_MS;
  } else if (elapsed < 1) {
    next.stability = shortTermStability(current.stability, grade, w);
    next.phase = 'review';
    next.due = time + intervalDays(next.stability, retention, w) * DAY_MS;
  } else {
    next.stability = recallStability(current.stability, next.difficulty, r, grade, w);
    next.phase = 'review';
    next.due = time + intervalDays(next.stability, retention, w) * DAY_MS;
  }
  next.last = time;
  return next;
}

