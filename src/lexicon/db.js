/* IndexedDB access for the lexicon.
 *
 * Seven stores: words, senses, cards, encounters, exposures, frequency, bricks,
 * plus meta. Everything is promise-wrapped so callers can await; there is no
 * callback style anywhere else in the module.
 */

export const DB_NAME = 'ml-lexicon';
/* Every upgrade is additive, so an older database keeps every word, card
 * schedule, and exposure: 2 added frequency, 3 added bricks. */
export const DB_VERSION = 3;

export const STORES = Object.freeze({
  words: 'words',
  senses: 'senses',
  cards: 'cards',
  encounters: 'encounters',
  exposures: 'exposures',
  frequency: 'frequency',
  bricks: 'bricks',
  meta: 'meta'
});

export function openDb(factory) {
  var idb = factory || (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (!idb) return Promise.reject(new Error('IndexedDB is not available'));
  return new Promise(function (resolve, reject) {
    var request = idb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = function (event) {
      var db = event.target.result;
      var names = db.objectStoreNames;
      if (!names.contains(STORES.words)) {
        var words = db.createObjectStore(STORES.words, { keyPath: 'id' });
        words.createIndex('lemma', 'lemma', { unique: false });
      }
      if (!names.contains(STORES.senses)) {
        var senses = db.createObjectStore(STORES.senses, { keyPath: 'id' });
        senses.createIndex('wordId', 'wordId', { unique: false });
      }
      if (!names.contains(STORES.cards)) {
        var cards = db.createObjectStore(STORES.cards, { keyPath: 'id' });
        cards.createIndex('senseId', 'senseId', { unique: false });
        cards.createIndex('phase', 'srs.phase', { unique: false });
      }
      if (!names.contains(STORES.encounters)) {
        db.createObjectStore(STORES.encounters, { keyPath: 'wordKey' });
      }
      if (!names.contains(STORES.exposures)) {
        var exposures = db.createObjectStore(STORES.exposures, { keyPath: 'id', autoIncrement: true });
        exposures.createIndex('senseId', 'senseId', { unique: false });
        exposures.createIndex('ts', 'ts', { unique: false });
      }
      if (!names.contains(STORES.frequency)) {
        db.createObjectStore(STORES.frequency, { keyPath: 'lemma' });
      }
      if (!names.contains(STORES.bricks)) {
        var bricks = db.createObjectStore(STORES.bricks, { keyPath: 'id' });
        bricks.createIndex('due', 'due', { unique: false });
        bricks.createIndex('phase', 'phase', { unique: false });
      }
      if (!names.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: 'key' });
      }
    };
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error); };
  });
}

function fromRequest(request) {
  return new Promise(function (resolve, reject) {
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error); };
  });
}

function fromTransaction(tx) {
  return new Promise(function (resolve, reject) {
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function () { reject(tx.error); };
    tx.onabort = function () { reject(tx.error); };
  });
}

export function get(db, store, key) {
  var tx = db.transaction(store, 'readonly');
  return fromRequest(tx.objectStore(store).get(key));
}

export function all(db, store) {
  var tx = db.transaction(store, 'readonly');
  return fromRequest(tx.objectStore(store).getAll());
}

export function count(db, store) {
  var tx = db.transaction(store, 'readonly');
  return fromRequest(tx.objectStore(store).count());
}

export function put(db, store, value) {
  var tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return fromTransaction(tx);
}

export function putAll(db, store, values) {
  if (!values || !values.length) return Promise.resolve();
  var tx = db.transaction(store, 'readwrite');
  var objectStore = tx.objectStore(store);
  values.forEach(function (value) { objectStore.put(value); });
  return fromTransaction(tx);
}

export function remove(db, store, key) {
  var tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return fromTransaction(tx);
}

export function clear(db, store) {
  var tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  return fromTransaction(tx);
}

export function indexAll(db, store, index, query) {
  var tx = db.transaction(store, 'readonly');
  return fromRequest(tx.objectStore(store).index(index).getAll(query));
}

export function dropDb(factory) {
  var idb = factory || (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (!idb) return Promise.reject(new Error('IndexedDB is not available'));
  return new Promise(function (resolve, reject) {
    var request = idb.deleteDatabase(DB_NAME);
    request.onsuccess = function () { resolve(); };
    request.onerror = function () { reject(request.error); };
    request.onblocked = function () { resolve(); };
  });
}
