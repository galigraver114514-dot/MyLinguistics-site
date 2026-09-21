/**
 * The shared dictionary module.
 *
 * Contract: docs/coordination/interface-dict.md version 1. Both the reader and
 * the wordbook consume this and neither owns a second implementation.
 *
 * Everything here is deliberately synchronous once ready. The device probe
 * showed a full JMdict pack parsing and indexing in 2.4 seconds, so there is
 * nothing to hide behind a lazy shard loader, and an async lookup would only
 * add latency to the one interaction that has to feel instant.
 */
import { loadJmdictPack, PACK_FILES, JMDICT_ATTRIBUTION } from './jmdict.js';
import { candidates as buildCandidates } from './candidates.js';

export { JMDICT_ATTRIBUTION, PACK_FILES };

const NOT_YET = 'not implemented yet; see docs/coordination/interface-dict.md';

/**
 * @param {{
 *   packs?: string[],
 *   packBaseUrl?: string,
 *   fetchImpl?: Function,
 *   onProgress?: Function
 * }} [options]
 */
export function createDictionary(options = {}) {
  const base = options.packBaseUrl || '/dict/';
  const packs = Array.isArray(options.packs) ? options.packs : ['common'];

  const sources = [];
  const errors = [];

  function notify(event) {
    if (typeof options.onProgress === 'function') options.onProgress(event);
  }

  const ready = (async function load() {
    for (let i = 0; i < packs.length; i++) {
      const pack = packs[i];
      const file = PACK_FILES[pack];
      if (!file) {
        errors.push({ pack: pack, error: 'unknown pack name' });
        continue;
      }
      const url = base.replace(/\/?$/, '/') + file;
      notify({ stage: 'pack', pack: pack, index: i, count: packs.length });
      try {
        const source = await loadJmdictPack({
          url: url,
          id: 'jmdict:' + pack,
          fetchImpl: options.fetchImpl,
          onProgress: function (event) {
            notify({ stage: event.stage, pack: pack, loaded: event.loaded, total: event.total });
          }
        });
        source.pack = pack;
        sources.push(source);
        notify({ stage: 'pack-done', pack: pack, entries: source.entryCount });
      } catch (error) {
        // One missing pack must not take the dictionary down; the others are
        // still useful and the failure is reported through sources().
        errors.push({ pack: pack, url: url, error: String(error && error.message ? error.message : error) });
        notify({ stage: 'pack-failed', pack: pack, error: String(error && error.message ? error.message : error) });
      }
    }
    notify({ stage: 'ready', sources: sources.length, errors: errors.length });
  })();

  function eachSource(fn) {
    for (let i = 0; i < sources.length; i++) {
      const result = fn(sources[i]);
      if (result && result.length) return result;
    }
    return null;
  }

  return {
    ready: ready,

    /** Ordered candidate forms for a surface string. Pure, no IO. */
    candidates(surface, token) {
      return buildCandidates(surface, token);
    },

    /**
     * Look a surface up. Accepts a plain string or { surface, token }.
     * Resolves to the shared Entry shape.
     */
    async lookup(text, lookupOptions) {
      await ready;
      const input = typeof text === 'string' ? { surface: text } : (text || {});
      const list = buildCandidates(input.surface, input.token || lookupOptions && lookupOptions.token);
      if (list.length === 0) return [];

      const merged = [];
      const seen = new Set();
      for (let c = 0; c < list.length; c++) {
        for (let s = 0; s < sources.length; s++) {
          const hits = sources[s].lookup([list[c]]);
          for (let h = 0; h < hits.length; h++) {
            const entry = hits[h];
            const key = entry.source + ':' + entry.id;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(entry);
          }
        }
      }
      return merged;
    },

    /** Kanji detail, when a pack that carries it is loaded. */
    async kanji(character) {
      await ready;
      return eachSource(function (source) { return source.kanji(character); });
    },

    /** Everything loaded, plus anything that failed to load. */
    sources() {
      return {
        loaded: sources.map(function (source) {
          return {
            id: source.id,
            kind: source.kind,
            title: source.title,
            revision: source.revision,
            licence: source.licence,
            attribution: source.attribution,
            entryCount: source.entryCount,
            languages: source.languages
          };
        }),
        failed: errors.slice()
      };
    },

    /** Importing a Yomitan dictionary is the next file in this module. */
    async importYomitan() {
      throw new Error('Yomitan import ' + NOT_YET);
    },

    async removeSource(id) {
      for (let i = sources.length - 1; i >= 0; i--) {
        if (sources[i].id === id) sources.splice(i, 1);
      }
    },

    async usage() {
      if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) {
        return { bytes: null, quota: null, supported: false };
      }
      const estimate = await navigator.storage.estimate();
      return { bytes: estimate.usage, quota: estimate.quota, supported: true };
    },

    close() {
      sources.length = 0;
    }
  };
}

export default { createDictionary };
