/**
 * Persistent highlights.
 *
 * Records live in the reader's own database (see db.js), keyed by id and
 * indexed by chapter, so opening a chapter reads only its own highlights. The
 * store is shared with the book library and must never be opened at a different
 * version here.
 *
 * Writes are awaited but never fatal: app.js paints the highlight in memory
 * first, so a refused or unavailable store costs persistence and nothing else.
 */
import { openReaderDb } from './db.js?v=14';

export function openAnnotations(options = {}) {
  const db = options.db || openReaderDb(options);
  const storeName = db.stores.annotations;

  function chapterKey(book, chapter) {
    return String(book) + '\u0000' + String(chapter);
  }

  async function put(record) {
    const dbHandle = await db.open();
    const value = Object.assign({}, record, { chapterKey: chapterKey(record.book, record.chapter) });
    if (!value.id) value.id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await new Promise(function (resolve, reject) {
      const transaction = dbHandle.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(value);
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () { reject(transaction.error); };
      transaction.onabort = function () { reject(transaction.error || new Error('write aborted')); };
    });
    return value;
  }

  async function list(book, chapter) {
    const dbHandle = await db.open();
    const key = chapterKey(book, chapter);
    return new Promise(function (resolve, reject) {
      const transaction = dbHandle.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).index('byChapter').getAll(key);
      request.onsuccess = function () {
        const rows = request.result || [];
        rows.sort(function (a, b) { return a.start - b.start; });
        resolve(rows);
      };
      request.onerror = function () { reject(request.error); };
    });
  }

  async function remove(id) {
    const dbHandle = await db.open();
    await new Promise(function (resolve, reject) {
      const transaction = dbHandle.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(id);
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () { reject(transaction.error); };
    });
  }

  return {
    available: db.available,
    put: put,
    list: list,
    remove: remove,
    close: db.close,
    chapterKey: chapterKey
  };
}

export default { openAnnotations: openAnnotations };
