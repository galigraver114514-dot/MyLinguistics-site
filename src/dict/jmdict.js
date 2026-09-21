/**
 * A packaged JMdict pack, loaded and indexed.
 *
 * The pack is the jmdict-simplified JSON, gzipped. Two facts from the device
 * probe shape everything here:
 *
 *   - the whole pack parses in 334 ms and indexes in 108 ms on the target iPad,
 *     so there is no sharding, no lazy loading and no streaming parser. Load it,
 *     parse it, index it.
 *   - the parsed object graph is what costs memory, not the string. Keeping the
 *     original word objects on every entry would roughly double the footprint
 *     for data nothing reads, so entries are slimmed into the shared shape and
 *     the source object is dropped.
 *
 * JMdict is Japanese to English. It is the always-available fallback, not the
 * primary dictionary: the primary is a locally imported monolingual one.
 */

/** EDRDG require attribution wherever the data is redistributed. */
export const JMDICT_ATTRIBUTION =
  'JMdict, property of the Electronic Dictionary Research and Development Group, ' +
  'used in conformance with the Group licence (Creative Commons BY-SA 4.0).';

const PRIORITY_TAGS = ['ichi1', 'news1', 'spec1', 'gai1'];

/** Pack name to file name. Produced by the build step; see the design doc. */
export const PACK_FILES = {
  common: 'jmdict-eng-common.json.gz',
  full: 'jmdict-eng.json.gz',
  names: 'jmnedict-all.json.gz'
};

function looksLikeJson(bytes) {
  for (let i = 0; i < Math.min(bytes.length, 64); i++) {
    const b = bytes[i];
    if (b === 32 || b === 10 || b === 13 || b === 9) continue;
    return b === 0x7b;   // "{"
  }
  return false;
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Fetch a URL into bytes, reporting progress when the body is streamable.
 *
 * A .gz served from GitHub Pages arrives as raw gzip with no Content-Encoding,
 * but some hosts do set it and then fetch decodes for us, which is why the
 * caller checks the first byte rather than assuming.
 */
async function fetchBytes(url, options) {
  // An explicit null means "there is no fetch", which is different from leaving
  // it undefined and letting the global one be used.
  const provided = options.fetchImpl;
  const fetchImpl = provided !== undefined ? provided : (typeof fetch === 'function' ? fetch : null);
  if (typeof fetchImpl !== 'function') {
    throw new Error('loadJmdictPack needs fetch; pass options.fetchImpl');
  }

  let response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new Error('could not fetch ' + url + ': ' + (error && error.message ? error.message : error));
  }
  if (!response.ok) throw new Error('could not fetch ' + url + ': HTTP ' + response.status);

  const total = Number(response.headers && response.headers.get ? response.headers.get('content-length') : 0) || 0;
  const onProgress = options.onProgress;

  if (!response.body || !response.body.getReader) {
    const buffer = await response.arrayBuffer();
    if (onProgress) onProgress({ stage: 'download', loaded: buffer.byteLength, total: buffer.byteLength });
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    chunks.push(step.value);
    loaded += step.value.byteLength;
    if (onProgress) onProgress({ stage: 'download', loaded: loaded, total: total || loaded });
  }

  const out = new Uint8Array(loaded);
  let at = 0;
  for (let i = 0; i < chunks.length; i++) {
    out.set(chunks[i], at);
    at += chunks[i].byteLength;
  }
  return out;
}

function priorityScore(tags) {
  let score = 0;
  for (let i = 0; i < tags.length; i++) {
    if (PRIORITY_TAGS.indexOf(tags[i]) !== -1) score++;
  }
  return score;
}

function collectTags(form) {
  const out = [];
  const tags = form && form.tags ? form.tags : [];
  for (let i = 0; i < tags.length; i++) out.push(tags[i]);
  return out;
}

/**
 * Turn one jmdict-simplified word into the shared Entry shape.
 *
 * raw is deliberately null: the shared shape already carries everything a
 * reader can display for JMdict, whose glosses are plain strings. Holding the
 * original object as well would keep a second copy of the whole pack alive.
 */
function toEntry(word, sourceId) {
  const kanji = word.kanji || [];
  const kana = word.kana || [];

  const headwords = kanji.map(function (k) { return k.text; });
  const readings = kana.map(function (k) { return k.text; });

  const priority = [];
  const pushPriority = function (form) {
    const tags = form && form.tags ? form.tags : [];
    for (let i = 0; i < tags.length; i++) {
      if (PRIORITY_TAGS.indexOf(tags[i]) !== -1 && priority.indexOf(tags[i]) === -1) priority.push(tags[i]);
    }
  };
  kanji.forEach(pushPriority);
  kana.forEach(pushPriority);

  const senses = (word.sense || []).map(function (sense) {
    const glosses = (sense.gloss || [])
      .filter(function (g) { return g && g.text; })
      .map(function (g) { return g.text; });
    return {
      pos: (sense.partOfSpeech || []).slice(),
      tags: [].concat(
        sense.field || [], sense.misc || [], sense.dialect || [],
        sense.info ? [sense.info] : []
      ),
      language: 'en',
      glosses: glosses
    };
  }).filter(function (sense) { return sense.glosses.length > 0; });

  if (senses.length === 0) return null;

  return {
    id: String(word.id),
    source: sourceId,
    headword: headwords[0] || readings[0] || '',
    reading: readings[0] || null,
    headwords: headwords,
    readings: readings,
    senses: senses,
    priority: priority,
    raw: null
  };
}

/**
 * @param {{url: string, id?: string, title?: string, fetchImpl?: Function, onProgress?: Function}} options
 * @returns {Promise<JmdictSource>}
 */
export async function loadJmdictPack(options) {
  const url = options.url;
  if (!url) throw new TypeError('loadJmdictPack needs options.url');

  const sourceId = options.id || 'jmdict';
  const started = Date.now();

  const bytes = await fetchBytes(url, options);
  if (options.onProgress) options.onProgress({ stage: 'decompress', loaded: bytes.byteLength, total: bytes.byteLength });

  // A pack is either raw gzip or already-decoded JSON, and which one it is is
  // decided by the first byte, because a host that sets Content-Encoding has
  // already undone the gzip for us. Anything else gets a message that says what
  // was actually wrong, rather than a decompression stack trace.
  let plain;
  if (looksLikeJson(bytes)) {
    plain = bytes;
  } else {
    try {
      plain = await gunzip(bytes);
    } catch (error) {
      throw new Error('the pack at ' + url + ' is neither JSON nor gzip');
    }
  }
  const text = new TextDecoder('utf-8').decode(plain);

  if (options.onProgress) options.onProgress({ stage: 'parse', loaded: text.length, total: text.length });

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error('the pack at ' + url + ' is not valid JSON: ' + (error && error.message));
  }

  if (!data || !Array.isArray(data.words)) {
    throw new Error('the pack at ' + url + ' has no words array; is it a jmdict-simplified pack?');
  }

  if (options.onProgress) options.onProgress({ stage: 'index', loaded: data.words.length, total: data.words.length });

  const byForm = new Map();
  const entries = [];
  const entryById = new Map();

  for (let i = 0; i < data.words.length; i++) {
    const entry = toEntry(data.words[i], sourceId);
    if (!entry) continue;
    entry.order = entries.length;
    entries.push(entry);
    entryById.set(entry.id, entry);

    const forms = entry.headwords.concat(entry.readings);
    for (let f = 0; f < forms.length; f++) {
      const key = forms[f];
      let bucket = byForm.get(key);
      if (!bucket) {
        bucket = [];
        byForm.set(key, bucket);
      }
      if (bucket.indexOf(entry) === -1) bucket.push(entry);
    }
  }

  const packName = data.commonOnly ? 'common' : (options.pack || 'full');
  const indexMs = Date.now() - started;

  const source = {
    id: sourceId,
    kind: 'jmdict',
    title: options.title || (data.commonOnly ? 'JMdict (common)' : 'JMdict'),
    revision: data.version ? String(data.version) + (data.dictDate ? ' ' + data.dictDate : '') : null,
    licence: 'Creative Commons BY-SA 4.0',
    attribution: JMDICT_ATTRIBUTION,
    entryCount: entries.length,
    formCount: byForm.size,
    pack: packName,
    languages: ['en'],

    /** Does this pack contain a form, in any spelling? */
    has(form) {
      return byForm.has(form);
    },

    /** Every form, for sampling. An iterator, so nothing is copied. */
    forms() {
      return byForm.keys();
    },

    /**
     * Ranked entries for an ordered candidate list.
     *
     * Ranking is by how likely the spelling was in the first place - the
     * candidate order - and only then by whether the match was on the headword
     * rather than the reading, then by JMdict priority, then by entry order.
     * Sorting by anything earlier in that chain would put a rare exact match
     * above a common inflected one.
     */
    lookup(candidateList) {
      const picked = [];
      const seen = new Set();

      for (let c = 0; c < candidateList.length; c++) {
        const form = candidateList[c];
        const bucket = byForm.get(form);
        if (!bucket) continue;
        for (let b = 0; b < bucket.length; b++) {
          const entry = bucket[b];
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          picked.push({
            entry: entry,
            rank: c,
            byHeadword: entry.headwords.indexOf(form) !== -1,
            priority: priorityScore(entry.priority)
          });
        }
      }

      picked.sort(function (a, b) {
        if (a.rank !== b.rank) return a.rank - b.rank;
        if (a.byHeadword !== b.byHeadword) return a.byHeadword ? -1 : 1;
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.entry.order - b.entry.order;
      });

      return picked.map(function (pick) { return pick.entry; });
    },

    /** JMdict carries no kanji detail; KANJIDIC is a separate pack. */
    kanji() {
      return null;
    },

    stats() {
      return {
        id: source.id,
        entries: entries.length,
        forms: byForm.size,
        pack: packName,
        indexMs: indexMs
      };
    }
  };

  // Drop the parsed pack. The entries are the index; keeping the original
  // object graph as well would hold a second copy of everything for nothing.
  data = null;

  return source;
}

export default { loadJmdictPack, JMDICT_ATTRIBUTION, PACK_FILES };
