/* Word bricks: ten words are the unit of learning and review.
 *
 * Pure. This module decides how captured words group into bricks and how a
 * brick's next due date follows from its cards; it never touches IndexedDB.
 * The store wires it to the pool, and the UI turns a group into a name.
 */

export const BRICK_SIZE = 10;
export const RETIRE_STABILITY = 21;
export const MAX_AGAIN = 3;
export const DAY_MS = 24 * 60 * 60 * 1000;

/* The two kinds the packing sheet offers, expanded to the card modes they
 * cover. A brick stores the flat list, so the session queue can filter on it
 * without knowing anything about the sheet. */
export const MODE_GROUPS = Object.freeze({
  recognize: ['recognize', 'reading', 'cloze'],
  produce: ['produce', 'fill']
});

/* null means "no restriction", which is what an unset brick keeps. */
export function modesForKinds(kinds) {
  if (!Array.isArray(kinds) || !kinds.length) return null;
  var out = [];
  kinds.forEach(function (kind) {
    var list = MODE_GROUPS[kind];
    if (!list) return;
    list.forEach(function (mode) { if (out.indexOf(mode) < 0) out.push(mode); });
  });
  return out.length ? out : null;
}

export function bandLabel(rank, band) {
  if (!rank) return 'unknown';
  var lo = (band && band.lo) || 12000;
  var hi = (band && band.hi) || 40000;
  if (rank < lo) return 'common';
  if (rank <= hi) return 'mid';
  return 'rare';
}

/* The group a candidate belongs to, in priority order. A source beats a band,
 * a band beats a part of speech, and anything left is mixed. */
export function groupFor(entry, band) {
  if (entry && entry.source) return { kind: 'source', value: String(entry.source) };
  if (entry && entry.rank) return { kind: 'band', value: bandLabel(entry.rank, band) };
  if (entry && entry.pos && entry.pos.length) return { kind: 'pos', value: String(entry.pos[0]) };
  return { kind: 'mixed', value: '' };
}

export function groupKey(group) {
  return group.kind + ':' + group.value;
}

function byRank(a, b) {
  var ra = a.rank == null ? Infinity : a.rank;
  var rb = b.rank == null ? Infinity : b.rank;
  if (ra !== rb) return ra - rb;
  return (a.firstSeen || 0) - (b.firstSeen || 0);
}

/* Greedy, in the order the redesign gives: the same source first, then the
 * same frequency band, then the same part of speech, then whatever is left.
 * Only full bricks are emitted unless partial is set, because a half brick is
 * not a session. */
export function formBricks(entries, options) {
  var opts = options || {};
  var size = opts.size || BRICK_SIZE;
  var pool = (entries || []);
  var order = ['source', 'band', 'pos'];
  var drafts = [];

  /* A hand-picked brick: the learner chose the words, so the packer does not
   * get to group them. The caller's order is kept, the size cap still applies,
   * and a selection that matches nothing produces no brick at all rather than
   * an empty one. */
  if (Array.isArray(opts.selected) && opts.selected.length) {
    var picked = [];
    var taken = {};
    for (var s = 0; s < opts.selected.length; s += 1) {
      var want = opts.selected[s];
      if (taken[want]) continue;
      taken[want] = true;
      for (var p = 0; p < pool.length; p += 1) {
        if (pool[p] && pool[p].wordKey === want) { picked.push(pool[p]); break; }
      }
    }
    if (!picked.length) return [];
    return [{
      group: opts.pos ? { kind: 'pos', value: String(opts.pos) } : groupFor(picked[0], opts.band),
      entries: picked.slice(0, size),
      partial: picked.length < size,
      name: opts.name || null,
      pos: opts.pos || null,
      modes: Array.isArray(opts.modes) ? opts.modes.slice() : null,
      firstDueDays: opts.firstDueDays == null ? null : Number(opts.firstDueDays)
    }];
  }

  var remaining = pool.slice();

  order.forEach(function (kind) {
    var buckets = new Map();
    remaining = remaining.filter(function (entry) {
      var group = groupFor(entry, opts.band);
      if (group.kind !== kind) return true;
      var key = groupKey(group);
      if (!buckets.has(key)) buckets.set(key, { group: group, list: [] });
      buckets.get(key).list.push(entry);
      return false;
    });
    buckets.forEach(function (bucket) {
      bucket.list.sort(byRank);
      while (bucket.list.length >= size) {
        drafts.push({ group: bucket.group, entries: bucket.list.splice(0, size), partial: false });
      }
      bucket.list.forEach(function (entry) { remaining.push(entry); });
    });
  });

  /* Whatever is left still fills full bricks, grouped as mixed. */
  remaining.sort(byRank);
  while (remaining.length >= size) {
    drafts.push({ group: { kind: 'mixed', value: '' }, entries: remaining.splice(0, size), partial: false });
  }

  /* A short tail keeps its own group rather than collapsing to mixed: a
   * two-word brick is still useful if both words came from the same book. */
  if (remaining.length && opts.partial) {
    var tail = new Map();
    remaining.forEach(function (entry) {
      var group = groupFor(entry, opts.band);
      var key = groupKey(group);
      if (!tail.has(key)) tail.set(key, { group: group, list: [] });
      tail.get(key).list.push(entry);
    });
    tail.forEach(function (bucket) {
      bucket.list.sort(byRank);
      drafts.push({ group: bucket.group, entries: bucket.list.slice(0, size), partial: true });
    });
  }
  return drafts;
}

export function medianDue(cards) {
  var dues = (cards || []).map(function (card) {
    return card && card.srs && card.srs.due ? card.srs.due : 0;
  }).filter(function (due) { return due > 0; }).sort(function (a, b) { return a - b; });
  if (!dues.length) return 0;
  return dues[Math.floor((dues.length - 1) / 2)];
}

/* The hybrid rule: every card keeps its own FSRS schedule, and the brick takes
 * the median of them as its pacing date. Three or more Again ratings pull the
 * whole brick back to tomorrow. */
export function nextBrickState(cards, options) {
  var opts = options || {};
  var now = opts.now || Date.now();
  var agains = opts.agains || 0;
  var all = (cards || []).filter(Boolean);
  var retired = all.length > 0 && all.every(function (card) {
    var stability = card.srs && card.srs.stability ? card.srs.stability : 0;
    return stability >= (opts.retireStability || RETIRE_STABILITY);
  });
  var due = medianDue(all) || now + DAY_MS;
  if (agains >= (opts.maxAgain || MAX_AGAIN)) due = Math.min(due, now + DAY_MS);
  var studied = all.length > 0 && all.every(function (card) {
    return card.srs && card.srs.phase !== 'new';
  });
  var phase = retired ? 'retired' : (studied ? 'review' : 'learning');
  return { due: due, phase: phase, agains: agains };
}
