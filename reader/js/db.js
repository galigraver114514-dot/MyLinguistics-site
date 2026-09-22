/**
 * The reader's own IndexedDB, and the single place its schema is declared.
 *
 * ml-reader is deliberately separate from the dictionary's ml-dict: an
 * annotation or a saved book is the reader's data, and a dictionary cleanup
 * must not be able to take it down. Annotations and the library share one
 * database, so they must also share one version - a second opener with a
 * different version would block, or upgrade behind the other's back. That is
 * the whole reason this file exists rather than each module opening its own.
 *
 * Upgrade path: v1 held only annotations. v2 added books (metadata) and
 * bookData (the EPUB bytes), separate so that listing the shelf never pulls a
 * 30 MB blob into memory. v3 adds bookmarks, its own store and not a flag on an
 * annotation, because a bookmark is a point in a book and listing the bookmarks
 * must not read a chapter's highlights.
 */

export const READER_DB = 'ml-reader';
export const READER_DB_VERSION = 3;

const ANNOTATIONS = 'annotations';
const BOOKS = 'books';
const BOOK_DATA = 'bookData';
const BOOKMARKS = 'bookmarks';

function upgrade(db, transaction) {
  if (!db.objectStoreNames.contains(ANNOTATIONS)) {
    const store = db.createObjectStore(ANNOTATIONS, { keyPath: 'id' });
    store.createIndex('byChapter', 'chapterKey', { unique: false });
  } else if (transaction) {
    // v1 databases already have the store but not necessarily the index.
    const store = transaction.objectStore(ANNOTATIONS);
    if (!store.indexNames.contains('byChapter')) {
      store.createIndex('byChapter', 'chapterKey', { unique: false });
    }
  }
  if (!db.objectStoreNames.contains(BOOKS)) {
    db.createObjectStore(BOOKS, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains(BOOK_DATA)) {
    db.createObjectStore(BOOK_DATA, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains(BOOKMARKS)) {
    const store = db.createObjectStore(BOOKMARKS, { keyPath: 'id' });
    store.createIndex('byBook', 'book', { unique: false });
  }
}

export function openReaderDb(options = {}) {
  const name = options.name || READER_DB;
  const version = options.version || READER_DB_VERSION;
  // An explicit null disables the store rather than silently falling back to the
  // global, which is what makes the no-IndexedDB path testable.
  const factory = options.indexedDB !== undefined
    ? options.indexedDB
    : (typeof indexedDB !== 'undefined' ? indexedDB : null);
  let dbPromise = null;

  function open() {
    if (!factory) return Promise.reject(new Error('this environment has no IndexedDB'));
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        const request = factory.open(name, version);
        request.onupgradeneeded = function () {
          upgrade(request.result, request.transaction);
        };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error || new Error('could not open ' + name)); };
        request.onblocked = function () { reject(new Error('another tab is blocking the upgrade of ' + name)); };
      });
    }
    return dbPromise;
  }

  function close() {
    if (!dbPromise) return;
    dbPromise.then(function (db) {
      try { db.close(); } catch (error) { /* already closed */ }
    }).catch(function () { /* never opened */ });
    dbPromise = null;
  }

  return {
    name: name,
    version: version,
    stores: { annotations: ANNOTATIONS, books: BOOKS, bookData: BOOK_DATA, bookmarks: BOOKMARKS },
    available: !!factory,
    open: open,
    close: close
  };
}

export default { openReaderDb: openReaderDb, READER_DB: READER_DB, READER_DB_VERSION: READER_DB_VERSION };
