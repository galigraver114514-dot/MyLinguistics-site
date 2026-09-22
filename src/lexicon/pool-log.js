/* The pool's activity log - 池の流れ.
 *
 * Presentation state, not learner data: it records what happened to the pool
 * recently so the column can show it. It therefore lives in localStorage next
 * to ml.theme and ml.uilang instead of taking a store of its own in the
 * lexicon database, and it is capped, because an uncapped log is a leak.
 *
 * Pure data in, pure data out. The storage is injectable so a test never
 * depends on the browser's.
 */

export const POOL_LOG_KEY = 'ml.poolLog';
export const POOL_LOG_LIMIT = 30;

/* The three entries the design draws. */
export const POOL_EVENT = Object.freeze({
  fromRiver: 'fromRiver',
  toBrick: 'toBrick',
  stayed: 'stayed'
});

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
  try { raw = store.getItem(POOL_LOG_KEY); } catch (err) { return []; }
  if (!raw) return [];
  var parsed = null;
  try { parsed = JSON.parse(raw); } catch (err) { return []; }
  return Array.isArray(parsed) ? parsed : [];
}

/* Newest first. A missing timestamp is stamped now so the column can still
 * order an entry written by an older build. */
export function push(entry, options) {
  var opts = options || {};
  var now = opts.now == null ? Date.now() : opts.now;
  var item = Object.assign({}, entry || {});
  if (!item.event) return list(options);
  if (!item.at) item.at = now;
  var next = [item].concat(list(options)).slice(0, opts.limit || POOL_LOG_LIMIT);
  var store = memory(options);
  if (store) {
    try {
      store.setItem(POOL_LOG_KEY, JSON.stringify(next));
    } catch (err) {
      /* Full or blocked: report what is actually stored, never what was
       * intended, so the column cannot show an entry that is not there. */
      return list(options);
    }
  }
  return next;
}

export function clear(options) {
  var store = memory(options);
  if (store) {
    try { store.removeItem(POOL_LOG_KEY); } catch (err) { /* nothing to do */ }
  }
  return [];
}
