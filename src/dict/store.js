/**
 * IndexedDB persistence for dictionary data.
 *
 * Two things here are not obvious:
 *
 * 1. **Every operation is wrapped in a promise, and every transaction is
 *    created inside the same task that uses it.** An IndexedDB transaction
 *    auto-closes as soon as control returns to the event loop, so awaiting
 *    anything between opening a transaction and using it is the classic way to
 *    get "the transaction is not active".
 *
 * 2. **verifyBlobRoundTrip exists because a blob write is not proof of a blob
 *    read.** On the target device, navigator.storage.estimate() reported only
 *    13 MB of usage after an 83 MB zip was written, which is far too low to
 *    trust. Whether an imported dictionary can be kept as its original zip and
 *    have banks inflated on demand, or whether all 500 MB has to be expanded,
 *    depends entirely on the answer, so the question is answered by reading
 *    the bytes back rather than by assuming.
 */

const DEFAULT_DB = 'ml-dict';
const DEFAULT_STORES = ['meta', 'entries', 'terms', 'sources', 'blobs'];

function requestToPromise(request) {
  return new Promise(function (resolve, reject) {
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error || new Error('indexeddb request failed')); };
  });
}

function transactionDone(tx) {
  return new Promise(function (resolve, reject) {
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function () { reject(tx.error || new Error('indexeddb transaction failed')); };
    tx.onabort = function () { reject(tx.error || new Error('indexeddb transaction aborted')); };
  });
}

/**
 * @param {{name?: string, version?: number, stores?: string[]}} [options]
 */
export function openStore(options = {}) {
  const name = options.name || DEFAULT_DB;
  const version = options.version || 1;
  const stores = options.stores || DEFAULT_STORES;

  return new Promise(function (resolve, reject) {
    let request;
    try {
      request = indexedDB.open(name, version);
    } catch (error) {
      reject(error);
      return;
    }

    request.onupgradeneeded = function () {
      const db = request.result;
      stores.forEach(function (store) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      });
    };
    request.onerror = function () { reject(request.error || new Error('could not open ' + name)); };
    request.onblocked = function () { reject(new Error('database ' + name + ' is blocked by another tab')); };

    request.onsuccess = function () {
      const db = request.result;
      db.onversionchange = function () { db.close(); };

      const api = {
        name: name,
        db: db,
        stores: stores,

        put: function (store, key, value) {
          const tx = db.transaction(store, 'readwrite');
          tx.objectStore(store).put(value, key);
          return transactionDone(tx);
        },

        get: function (store, key) {
          return requestToPromise(db.transaction(store, 'readonly').objectStore(store).get(key));
        },

        del: function (store, key) {
          const tx = db.transaction(store, 'readwrite');
          tx.objectStore(store).delete(key);
          return transactionDone(tx);
        },

        keys: function (store) {
          return requestToPromise(db.transaction(store, 'readonly').objectStore(store).getAllKeys());
        },

        count: function (store) {
          return requestToPromise(db.transaction(store, 'readonly').objectStore(store).count());
        },

        clear: function (store) {
          const tx = db.transaction(store, 'readwrite');
          tx.objectStore(store).clear();
          return transactionDone(tx);
        },

        /** Storage quota and usage, in bytes, if the browser will say. */
        estimate: function () {
          if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) {
            return Promise.resolve({ quota: null, usage: null, supported: false });
          }
          return navigator.storage.estimate().then(function (value) {
            return { quota: value.quota, usage: value.usage, supported: true };
          });
        },

        close: function () { db.close(); }
      };

      resolve(api);
    };
  });
}

export function deleteStore(name) {
  return new Promise(function (resolve, reject) {
    const request = indexedDB.deleteDatabase(name || DEFAULT_DB);
    request.onsuccess = function () { resolve(true); };
    request.onerror = function () { resolve(false); };
    request.onblocked = function () { resolve(false); };
  });
}

function headAndTailMatch(a, b, window) {
  const span = Math.min(window || 64, a.length, b.length);
  for (let i = 0; i < span; i++) {
    if (a[i] !== b[i]) return false;
    if (a[a.length - 1 - i] !== b[b.length - 1 - i]) return false;
  }
  return true;
}

/**
 * Write bytes as a Blob, read them back, and report whether they survived.
 *
 * Uses its own database by default so it can never disturb real data.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{ok: boolean, written: number, read?: number, kind?: string, ms: number, error?: string}>}
 */
export async function verifyBlobRoundTrip(bytes, options = {}) {
  const name = options.name || 'ml-dict-probe';
  const storeName = 'probe';
  const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const started = Date.now();
  const result = { written: payload.byteLength, ms: 0 };

  let store = null;
  try {
    store = await openStore({ name: name, stores: [storeName] });
    await store.put(storeName, 'probe', new Blob([payload]));

    const readBack = await store.get(storeName, 'probe');
    if (!readBack) {
      result.ok = false;
      result.error = 'the write reported success but nothing came back';
      return result;
    }

    result.kind = readBack instanceof Blob ? 'blob' : 'arraybuffer';
    const buffer = readBack instanceof Blob ? await readBack.arrayBuffer() : readBack;
    result.read = buffer.byteLength;
    result.ok = buffer.byteLength === payload.byteLength &&
      headAndTailMatch(new Uint8Array(buffer), payload);
    if (!result.ok) {
      result.error = 'read back ' + buffer.byteLength + ' bytes, wrote ' + payload.byteLength;
    }
  } catch (error) {
    result.ok = false;
    result.error = String(error && error.message ? error.message : error);
  } finally {
    if (store) store.close();
    await deleteStore(name);
    result.ms = Date.now() - started;
  }

  return result;
}

export default { openStore, deleteStore, verifyBlobRoundTrip };
