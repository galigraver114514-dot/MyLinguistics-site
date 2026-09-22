/* 調べた語 - the words looked up in 辞書, newest first.
 *
 * The dictionary's own storage holds entries, never queries. This is the
 * query trail the 辞書 column shows, so it is UI history and lives in
 * localStorage with the other two ml.* presentation keys.
 */

export const LOOKUP_LOG_KEY = 'ml.lookupLog';
export const LOOKUP_LOG_LIMIT = 50;

function memory(options) {
  var store = (options && options.storage) || null;
  if (store) return store;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch (err) { /* Safari in private mode throws on access */ }
  return null;
}

export function list(options) {
  var store = memory(options);
  if (!store) return [];
  var raw = null;
  try { raw = store.getItem(LOOKUP_LOG_KEY); } catch (err) { return []; }
  if (!raw) return [];
  var parsed = null;
  try { parsed = JSON.parse(raw); } catch (err) { return []; }
  return Array.isArray(parsed) ? parsed : [];
}

/* Looking the same word up again moves it to the top rather than adding a
 * second row: the column is a trail of words, not of keystrokes. */
export function record(item, options) {
  var opts = options || {};
  var now = opts.now == null ? Date.now() : opts.now;
  var term = item && item.term ? String(item.term).trim() : '';
  if (!term) return list(options);
  var row = {
    term: term,
    reading: item.reading || null,
    gloss: item.gloss || null,
    pos: item.pos || null,
    at: now
  };
  var rest = list(options).filter(function (old) { return old && old.term !== term; });
  var next = [row].concat(rest).slice(0, opts.limit || LOOKUP_LOG_LIMIT);
  var store = memory(options);
  if (store) {
    try {
      store.setItem(LOOKUP_LOG_KEY, JSON.stringify(next));
    } catch (err) {
      return list(options);
    }
  }
  return next;
}

export function clear(options) {
  var store = memory(options);
  if (store) {
    try { store.removeItem(LOOKUP_LOG_KEY); } catch (err) { /* nothing to do */ }
  }
  return [];
}
