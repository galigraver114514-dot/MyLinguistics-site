/**
 * Saved books, so the reader is actually usable offline.
 *
 * An EPUB is stored once, under the key the reader already derives from the
 * package identifier and the file size, so reopening a book overwrites rather
 * than accumulating copies. Metadata and bytes live in separate stores: listing
 * the shelf must never pull a 30 MB blob into memory, and the shelf is the
 * screen the reader sees most.
 *
 * Saving is best effort. A refused quota costs the offline copy, never the
 * reading session that is already open.
 */
import { openReaderDb } from './db.js?v=11';

function write(db, stores, work) {
  return new Promise(function (resolve, reject) {
    const transaction = db.transaction(stores, 'readwrite');
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

function getAll(db, store) {
  return new Promise(function (resolve, reject) {
    const request = db.transaction(store, 'readonly').objectStore(store).getAll();
    request.onsuccess = function () { resolve(request.result || []); };
    request.onerror = function () { reject(request.error); };
  });
}

function getOne(db, store, key) {
  return new Promise(function (resolve, reject) {
    const request = db.transaction(store, 'readonly').objectStore(store).get(key);
    request.onsuccess = function () { resolve(request.result || null); };
    request.onerror = function () { reject(request.error); };
  });
}

export function createLibrary(options = {}) {
  const db = options.db || openReaderDb(options);

  async function save(book) {
    const handle = await db.open();
    const meta = {
      id: book.id,
      title: book.title || '',
      author: book.author || '',
      size: book.size || 0,
      chapterCount: book.chapterCount || 0,
      addedAt: book.addedAt || new Date().toISOString()
    };
    const blob = (typeof Blob !== 'undefined' && book.bytes instanceof Blob)
      ? book.bytes
      : new Blob([book.bytes], { type: 'application/epub+zip' });
    await write(handle, [db.stores.books, db.stores.bookData], function (transaction) {
      transaction.objectStore(db.stores.books).put(meta);
      transaction.objectStore(db.stores.bookData).put({ id: meta.id, bytes: blob });
    });
    return meta;
  }

  async function list() {
    const handle = await db.open();
    const rows = await getAll(handle, db.stores.books);
    rows.sort(function (a, b) { return String(b.addedAt).localeCompare(String(a.addedAt)); });
    return rows;
  }

  async function load(id) {
    const handle = await db.open();
    return getOne(handle, db.stores.bookData, id);
  }

  async function has(id) {
    const handle = await db.open();
    return (await getOne(handle, db.stores.books, id)) !== null;
  }

  async function remove(id) {
    const handle = await db.open();
    await write(handle, [db.stores.books, db.stores.bookData], function (transaction) {
      transaction.objectStore(db.stores.books).delete(id);
      transaction.objectStore(db.stores.bookData).delete(id);
    });
  }

  return {
    available: db.available,
    save: save,
    list: list,
    load: load,
    has: has,
    remove: remove,
    close: db.close
  };
}

export default { createLibrary: createLibrary };
