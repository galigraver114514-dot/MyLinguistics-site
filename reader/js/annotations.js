/**
 * Persistent highlights.
 *
 * The reader gets its own IndexedDB database, deliberately not the dictionary's
 * store: an annotation is the one irreplaceable thing here, so it must not be
 * dropped by a dictionary cleanup, and a dictionary bug must not be able to
 * take annotations with it. Records are keyed by id and indexed by chapter, so
 * opening a chapter reads only its own highlights.
 *
 * Writes are awaited but never fatal: app.js paints the highlight in memory
 * first, so a refused or unavailable store costs persistence and nothing else.
 */

const DB_NAME = 'ml-reader';
const DB_VERSION = 1;
const STORE = 'annotations';

export function openAnnotations(options = {}) {
  const name = options.name || DB_NAME;
  // An explicit null disables the store rather than silently falling back to the
  // global, which is what makes the no-IndexedDB path testable at all.
  const factory = options.indexedDB !== undefined
    ? options.indexedDB
    : (typeof indexedDB !== 'undefined' ? indexedDB : null);
  let dbPromise = null;

  function chapterKey(book, chapter) {
    return String(book) + '\u0000' + String(chapter);
  }

  function open() {
    if (!factory) return Promise.reject(new Error('this environment has no IndexedDB'));
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        const request = factory.open(name, DB_VERSION);
        request.onupgradeneeded = function () {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: 'id' });
            store.createIndex('byChapter', 'chapterKey', { unique: false });
          }
        };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error || new Error('could not open ' + name)); };
      });
    }
    return dbPromise;
  }

  async function put(record) {
    const db = await open();
    const value = Object.assign({}, record, { chapterKey: chapterKey(record.book, record.chapter) });
    if (!value.id) value.id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('write aborted')); };
    });
    return value;
  }

  async function list(book, chapter) {
    const db = await open();
    const key = chapterKey(book, chapter);
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).index('byChapter').getAll(key);
      request.onsuccess = function () {
        const rows = request.result || [];
        rows.sort(function (a, b) { return a.start - b.start; });
        resolve(rows);
      };
      request.onerror = function () { reject(request.error); };
    });
  }

  async function remove(id) {
    const db = await open();
    await new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function close() {
    if (!dbPromise) return;
    dbPromise.then(function (db) {
      try { db.close(); } catch (error) { /* already closed */ }
    }).catch(function () { /* never opened */ });
    dbPromise = null;
  }

  return {
    available: !!factory,
    put: put,
    list: list,
    remove: remove,
    close: close,
    chapterKey: chapterKey
  };
}

export default { openAnnotations: openAnnotations };
