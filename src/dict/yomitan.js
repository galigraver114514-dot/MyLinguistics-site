/**
 * Yomitan dictionary import and lookup.
 *
 * A Yomitan dictionary is a ZIP holding index.json, some number of
 * term_bank_N.json files, and optionally kanji, tag and meta banks. Row format
 * is a positional array:
 *
 *   [0] term   [1] reading   [2] definition tags   [3] inflection rules
 *   [4] score  [5] glossary  [6] sequence          [7] term tags
 *
 * The device probe fixed the design. A real dictionary - 大辞林, 83 MB zipped,
 * 168 term banks, 551 MB uncompressed - has a largest bank of 3.59 MB and 2000
 * rows, so there is no enormous JSON anywhere and no streaming parser is
 * needed. Walking every bank once takes 2.28 seconds.
 *
 * So: walk the banks once to build a sorted key index, keep the original zip,
 * and inflate a bank only when a lookup lands in it. The persistent footprint
 * stays near the zip rather than the 551 MB of expanded JSON, and peak memory
 * during import is one bank.
 *
 * Glosses are passed through untouched, because they are not strings. They are
 * structured-content trees, and rendering them is src/dict/structured.js.
 */
import { openZip } from '../zip.js';

const TERM_BANK = /^term_bank_(\d+)\.json$/;
const KANJI_BANK = /^kanji_bank_(\d+)\.json$/;
const TAG_BANK = /^tag_bank_(\d+)\.json$/;
const META_BANK = /^term_meta_bank_(\d+)\.json$/;

const DEFAULT_CACHED_BANKS = 8;

function splitTags(value) {
  if (!value || typeof value !== 'string') return [];
  return value.split(/\s+/).filter(function (tag) { return tag.length > 0; });
}

// Enough of a map for what a dictionary actually ships: illustrations and its
// own stylesheet. Anything else is served as opaque bytes.
const MEDIA_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  css: 'text/css',
  woff: 'font/woff',
  woff2: 'font/woff2'
};

function mediaTypeFor(path) {
  const match = String(path).toLowerCase().match(/\.([a-z0-9]+)$/);
  return (match && MEDIA_TYPES[match[1]]) || 'application/octet-stream';
}

async function readBytes(input) {
  if (!input) throw new Error('a Yomitan import needs a file, an ArrayBuffer or a Uint8Array');
  if (input instanceof Uint8Array) return input;
  if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input.arrayBuffer === 'function') return new Uint8Array(await input.arrayBuffer());
  throw new Error('a Yomitan import needs a file, an ArrayBuffer or a Uint8Array');
}

/** Index of the first element not less than target, over a sorted string array. */
function lowerBound(keys, target) {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Group rows that belong to the same dictionary entry.
 *
 * Yomitan splits one entry's senses across several rows sharing a sequence
 * number, so without this a lookup for a common word returns a row per sense
 * and the caller has to guess which one to show.
 */
function mergeSenses(entries) {
  const byEntry = new Map();
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const sequence = entry.raw && entry.raw.sequence;
    const key = (sequence === undefined || sequence === null || sequence === '')
      ? 'text:' + entry.headword + '\u0000' + (entry.reading || '')
      : 'sequence:' + sequence;
    const existing = byEntry.get(key);
    if (existing) {
      existing.senses = existing.senses.concat(entry.senses);
      continue;
    }
    byEntry.set(key, entry);
    out.push(entry);
  }
  return out;
}

function rowToEntry(row, sourceId, language) {
  if (!Array.isArray(row)) return null;
  const term = typeof row[0] === 'string' ? row[0] : '';
  if (!term) return null;

  const reading = typeof row[1] === 'string' ? row[1] : '';
  const definitionTags = typeof row[2] === 'string' ? row[2] : '';
  const rules = typeof row[3] === 'string' ? row[3] : '';
  const sequence = row[6];
  const termTags = typeof row[7] === 'string' ? row[7] : '';

  let glosses = row[5];
  if (glosses === undefined || glosses === null) glosses = [];
  else if (!Array.isArray(glosses)) glosses = [glosses];
  if (glosses.length === 0) return null;

  return {
    id: sourceId + ':' + row.__bank + '-' + row.__row,
    source: sourceId,
    headword: term,
    reading: reading || null,
    headwords: [term],
    readings: reading ? [reading] : [],
    senses: [{
      pos: splitTags(definitionTags),
      tags: splitTags(termTags),
      language: language,
      glosses: glosses
    }],
    priority: [],
    raw: {
      sequence: sequence,
      rules: rules,
      definitionTags: definitionTags,
      termTags: termTags
    }
  };
}

/**
 * Build the sorted key index by walking every term bank once.
 *
 * Both the headword and the reading become keys, so a lookup by kana finds an
 * entry written in kanji.
 */
async function buildIndex(archive, bankNames, options) {
  const keys = [];
  const bankOf = [];
  const rowOf = [];
  let entries = 0;
  let uncompressedBytes = 0;
  const onProgress = options.onProgress;

  for (let b = 0; b < bankNames.length; b++) {
    const name = bankNames[b];
    if (onProgress) onProgress({ stage: 'walk', bank: b + 1, banks: bankNames.length, name: name });
    const raw = await archive.readText(name);
    if (raw === null) continue;
    uncompressedBytes += raw.length;

    let rows;
    try {
      rows = JSON.parse(raw);
    } catch (error) {
      throw new Error('term bank ' + name + ' is not valid JSON: ' + (error && error.message));
    }
    if (!Array.isArray(rows)) continue;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;
      const term = typeof row[0] === 'string' ? row[0] : '';
      if (!term) continue;
      entries++;
      keys.push(term);
      bankOf.push(b);
      rowOf.push(r);
      const reading = typeof row[1] === 'string' ? row[1] : '';
      if (reading && reading !== term) {
        keys.push(reading);
        bankOf.push(b);
        rowOf.push(r);
      }
    }
  }

  if (onProgress) onProgress({ stage: 'sort', keys: keys.length });

  // Sort the three parallel arrays together. A permutation array costs about
  // five megabytes for a dictionary this size, which is cheaper than sorting
  // objects and is thrown away immediately afterwards.
  const order = new Int32Array(keys.length);
  for (let i = 0; i < order.length; i++) order[i] = i;
  const sorted = Array.prototype.slice.call(order).sort(function (a, b) {
    const ka = keys[a];
    const kb = keys[b];
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return a - b;
  });

  const sortedKeys = new Array(sorted.length);
  const sortedBank = new Int32Array(sorted.length);
  const sortedRow = new Int32Array(sorted.length);
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i];
    sortedKeys[i] = keys[from];
    sortedBank[i] = bankOf[from];
    sortedRow[i] = rowOf[from];
  }

  return {
    keys: sortedKeys,
    bankOf: sortedBank,
    rowOf: sortedRow,
    entries: entries,
    uncompressedBytes: uncompressedBytes
  };
}

function makeSource(state) {
  const keys = state.index.keys;
  const bankOf = state.index.bankOf;
  const rowOf = state.index.rowOf;
  const language = state.language;
  const bankCache = new Map();

  async function loadBank(bankIndex) {
    const cached = bankCache.get(bankIndex);
    if (cached) {
      bankCache.delete(bankIndex);
      bankCache.set(bankIndex, cached);   // refresh recency
      return cached;
    }
    const name = state.bankNames[bankIndex];
    const raw = await state.archive.readText(name);
    const rows = raw ? JSON.parse(raw) : [];
    bankCache.set(bankIndex, rows);
    while (bankCache.size > (state.cachedBanks || DEFAULT_CACHED_BANKS)) {
      const oldest = bankCache.keys().next().value;
      bankCache.delete(oldest);
    }
    return rows;
  }

  function refsFor(key) {
    const start = lowerBound(keys, key);
    if (start >= keys.length || keys[start] !== key) return null;
    const out = [];
    for (let i = start; i < keys.length && keys[i] === key; i++) out.push(i);
    return out;
  }

  // A dictionary's images and styles.css live inside the same zip, so reading
  // them is this source's job and not the renderer's.
  async function readAsset(path) {
    if (typeof path !== 'string' || path.length === 0) return null;
    const clean = path.replace(/^\.?\//, '').replace(/\\/g, '/');
    const data = await state.archive.read(clean);
    if (data === null) return null;
    return { data: data, mediaType: mediaTypeFor(clean) };
  }

  async function assetUrl(path) {
    const asset = await readAsset(path);
    if (!asset) return null;
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    return URL.createObjectURL(new Blob([asset.data], { type: asset.mediaType }));
  }

  function readStyles() {
    return state.archive.readText('styles.css');
  }

  const source = {
    id: state.id,
    kind: 'yomitan',
    title: state.info.title,
    revision: state.info.revision,
    licence: state.info.licence,
    attribution: state.info.attribution,
    entryCount: state.info.entryCount,
    languages: [language],
    keyCount: keys.length,
    bankCount: state.bankNames.length,

    info() {
      return {
        id: state.id,
        kind: 'yomitan',
        title: state.info.title,
        revision: state.info.revision,
        licence: state.info.licence,
        attribution: state.info.attribution,
        entryCount: state.info.entryCount,
        languages: [language],
        keyCount: keys.length,
        bankCount: state.bankNames.length,
        // Which kinds of bank the dictionary ships. A monolingual dictionary
        // with no meta bank has no frequency and no pitch accent, and a caller
        // showing badges needs to know that rather than showing nothing.
        banks: state.info.banks || null
      };
    },

    has(form) {
      return refsFor(form) !== null;
    },

    /** Synchronous, like the JMdict source: the index is in memory. */
    lookup(candidateList) {
      const byBank = new Map();
      const found = [];

      for (let c = 0; c < candidateList.length; c++) {
        const refs = refsFor(candidateList[c]);
        if (!refs) continue;
        for (let i = 0; i < refs.length; i++) {
          const at = refs[i];
          const bank = bankOf[at];
          const row = rowOf[at];
          let bucket = byBank.get(bank);
          if (!bucket) {
            bucket = [];
            byBank.set(bank, bucket);
          }
          bucket.push({ row: row, rank: c });
        }
      }

      if (byBank.size === 0) return found;

      const banks = Array.from(byBank.keys());
      const pending = banks.map(function (bank) {
        return loadBank(bank).then(function (rows) {
          const wanted = byBank.get(bank);
          for (let i = 0; i < wanted.length; i++) {
            const item = wanted[i];
            const raw = rows[item.row];
            if (!Array.isArray(raw)) continue;
            const copy = raw.slice();
            copy.__bank = bank;
            copy.__row = item.row;
            const entry = rowToEntry(copy, source.id, language);
            if (entry) {
              entry.rank = item.rank;
              found.push(entry);
            }
          }
        });
      });

      return Promise.all(pending).then(function () {
        found.sort(function (a, b) { return a.rank - b.rank; });
        const merged = mergeSenses(found);
        for (let i = 0; i < merged.length; i++) delete merged[i].rank;
        return merged;
      });
    },

    kanji() {
      return null;
    },

    /** Raw bytes of one file inside the dictionary zip, or null. */
    asset(path) {
      return readAsset(path);
    },

    /** A blob URL for one asset, or null. The caller owns revoking it. */
    assetUrl(path) {
      return assetUrl(path);
    },

    /** The dictionary's own styles.css text, or null when it ships none. */
    styles() {
      return readStyles();
    },

    clearCache() {
      bankCache.clear();
    },

    stats() {
      return {
        id: source.id,
        banks: state.bankNames.length,
        keys: keys.length,
        entries: state.info.entryCount,
        cachedBanks: bankCache.size
      };
    }
  };

  source.lookup = source.lookup.bind(source);
  return source;
}

/**
 * Import a dictionary from a file.
 *
 * @param {{
 *   file?: File|Uint8Array|ArrayBuffer,
 *   id?: string,
 *   language?: string,
 *   store?: object,
 *   onProgress?: Function,
 *   cachedBanks?: number
 * }} options
 */
export async function importYomitan(options) {
  const started = Date.now();
  if (!options) throw new Error('importYomitan needs options');

  const sourceId = options.id || 'yomitan:' + Date.now().toString(36);
  const language = options.language || 'ja';
  const onProgress = options.onProgress;

  if (onProgress) onProgress({ stage: 'read' });
  const bytes = await readBytes(options.file);
  const archive = await openZip(bytes);

  const indexText = await archive.readText('index.json');
  if (indexText === null) {
    throw new Error('this zip has no index.json, so it is not a Yomitan dictionary');
  }
  let index;
  try {
    index = JSON.parse(indexText);
  } catch (error) {
    throw new Error('index.json is not valid JSON: ' + (error && error.message));
  }

  const bankNames = archive.find(TERM_BANK)
    .map(function (entry) { return entry.name; })
    .sort(function (a, b) {
      const na = parseInt((a.match(TERM_BANK) || [])[1], 10);
      const nb = parseInt((b.match(TERM_BANK) || [])[1], 10);
      return na - nb;
    });

  if (bankNames.length === 0) {
    throw new Error('this dictionary has no term banks, so it holds no words');
  }

  const counts = {
    termBanks: bankNames.length,
    kanjiBanks: archive.find(KANJI_BANK).length,
    tagBanks: archive.find(TAG_BANK).length,
    metaBanks: archive.find(META_BANK).length
  };

  const built = await buildIndex(archive, bankNames, { onProgress: onProgress });

  const info = {
    id: sourceId,
    kind: 'yomitan',
    title: typeof index.title === 'string' ? index.title : 'Yomitan dictionary',
    revision: typeof index.revision === 'string' ? index.revision : null,
    format: index.format === undefined ? null : index.format,
    licence: typeof index.licence === 'string' ? index.licence : (typeof index.license === 'string' ? index.license : ''),
    attribution: typeof index.attribution === 'string' ? index.attribution : '',
    entryCount: built.entries,
    keyCount: built.keys.length,
    banks: counts,
    importedAt: new Date().toISOString(),
    bytes: bytes.byteLength
  };

  const state = {
    id: sourceId,
    language: language,
    archive: archive,
    bankNames: bankNames,
    index: built,
    info: info,
    cachedBanks: options.cachedBanks
  };

  if (options.store) {
    if (onProgress) onProgress({ stage: 'persist' });
    try {
      await options.store.put('sources', sourceId, info);
      await options.store.put('meta', sourceId + ':banks', bankNames);
      await options.store.put('terms', sourceId + ':index', {
        keys: built.keys,
        bankOf: built.bankOf,
        rowOf: built.rowOf
      });
      // A Blob rather than the raw bytes: IndexedDB stores it without a copy,
      // and whether it survives the round trip is exactly what
      // store.verifyBlobRoundTrip exists to check.
      await options.store.put('blobs', sourceId + ':zip', new Blob([bytes]));
    } catch (error) {
      info.persistError = String(error && error.message ? error.message : error);
    }
  }

  const source = makeSource(state);
  if (onProgress) onProgress({ stage: 'done', entries: built.entries, banks: bankNames.length });

  source.result = {
    source: source.info(),
    banks: bankNames.length,
    entries: built.entries,
    uncompressedBytes: built.uncompressedBytes,
    elapsedMs: Date.now() - started,
    storedBytes: options.store ? bytes.byteLength : null
  };
  return source;
}

/** Source ids of every Yomitan dictionary already in storage. */
export async function listYomitanSources(store) {
  const ids = await store.keys('sources');
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const info = await store.get('sources', ids[i]);
    if (info && info.kind === 'yomitan') out.push(info);
  }
  return out;
}

/** Reopen a dictionary that was imported earlier, without the original file. */
export async function restoreYomitan(store, sourceId, options = {}) {
  const info = await store.get('sources', sourceId);
  if (!info) throw new Error('no stored dictionary with id ' + sourceId);

  const bankNames = await store.get('meta', sourceId + ':banks');
  const index = await store.get('terms', sourceId + ':index');
  const blob = await store.get('blobs', sourceId + ':zip');

  if (!bankNames || !index || !blob) {
    throw new Error('the stored dictionary ' + sourceId + ' is incomplete; import it again');
  }

  const bytes = blob instanceof Blob
    ? new Uint8Array(await blob.arrayBuffer())
    : new Uint8Array(blob);
  const archive = await openZip(bytes);

  return makeSource({
    id: sourceId,
    language: options.language || (info.languages && info.languages[0]) || 'ja',
    archive: archive,
    bankNames: bankNames,
    index: {
      keys: index.keys,
      bankOf: index.bankOf,
      rowOf: index.rowOf,
      entries: info.entryCount,
      uncompressedBytes: 0
    },
    info: info,
    cachedBanks: options.cachedBanks
  });
}

/** Forget a stored dictionary and everything it wrote. */
export async function removeYomitan(store, sourceId) {
  await store.del('sources', sourceId);
  await store.del('meta', sourceId + ':banks');
  await store.del('terms', sourceId + ':index');
  await store.del('blobs', sourceId + ':zip');
}

export default { importYomitan, restoreYomitan, listYomitanSources, removeYomitan };
