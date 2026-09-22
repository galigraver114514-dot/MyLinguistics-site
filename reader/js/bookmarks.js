/**
 * Bookmarks: a named point in a book rather than a range.
 *
 * A bookmark is somewhere to come back to, so it is { chapter, offset } plus a
 * label taken from the text there. It gets its own store instead of riding on an
 * annotation, because a point and a range are different things and because
 * listing a book's bookmarks must not read a chapter's highlights.
 *
 * Machine-local by design: the position store already remembers where reading
 * stopped, and this is the deliberate version of the same idea.
 */
import { openReaderDb } from './db.js?v=12';

export function bookmarkLabel(text, limit) {
  const value = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  const slice = value.slice(0, limit || 34);
  return slice || 'しおり';
}

export function sortBookmarks(bookmarks) {
  const list = (bookmarks || []).slice();
  list.sort(function (a, b) {
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    return a.offset - b.offset;
  });
  return list;
}

/** A bookmark already within tolerance of this position, or null. */
export function findBookmark(bookmarks, chapter, offset, tolerance) {
  const limit = tolerance == null ? 8 : tolerance;
  const list = bookmarks || [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].chapter === chapter && Math.abs(list[i].offset - offset) <= limit) return list[i];
  }
  return null;
}

function write(db, store, work) {
  return new Promise(function (resolve, reject) {
    const transaction = db.transaction(store, 'readwrite');
    transaction.oncomplete = function () { resolve(); };
    transaction.onerror = function () { reject(transaction.error); };
    transaction.onabort = function () { reject(transaction.error || new Error('transaction aborted')); };
    try {
      work(transaction);
    } catch (error) {
      try { transaction.abort(); } catch (inner) { /* already aborting */ }
      reject(error);
    }
  });
}

export function createBookmarks(options = {}) {
  const db = options.db || openReaderDb(options);
  const storeName = db.stores.bookmarks;

  async function put(record) {
    const handle = await db.open();
    const value = Object.assign({}, record);
    if (!value.id) value.id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    if (!value.createdAt) value.createdAt = new Date().toISOString();
    await write(handle, storeName, function (transaction) {
      transaction.objectStore(storeName).put(value);
    });
    return value;
  }

  async function list(book) {
    const handle = await db.open();
    const rows = await new Promise(function (resolve, reject) {
      const request = handle.transaction(storeName, 'readonly')
        .objectStore(storeName).index('byBook').getAll(book);
      request.onsuccess = function () { resolve(request.result || []); };
      request.onerror = function () { reject(request.error); };
    });
    return sortBookmarks(rows);
  }

  async function remove(id) {
    const handle = await db.open();
    await write(handle, storeName, function (transaction) {
      transaction.objectStore(storeName).delete(id);
    });
  }

  return {
    available: db.available,
    put: put,
    list: list,
    remove: remove,
    close: db.close
  };
}

export default {
  bookmarkLabel: bookmarkLabel,
  sortBookmarks: sortBookmarks,
  findBookmark: findBookmark,
  createBookmarks: createBookmarks
};
