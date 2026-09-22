/**
 * The shared dictionary module.
 *
 * Contract: docs/coordination/interface-dict.md. Both the reader and the
 * wordbook consume this and neither owns a second implementation.
 *
 * Two kinds of source, and they are not interchangeable:
 *
 *   JMdict packs    bundled, Japanese to English, always available. Cheap
 *                   enough to load eagerly: 2.4 seconds for the full pack.
 *   Yomitan imports local, usually monolingual, and the one that actually
 *                   answers a question about nuance. Expensive to hold - the
 *                   zip stays in memory so banks can be inflated on demand -
 *                   so they are imported and restored explicitly rather than
 *                   at startup.
 */
import { loadJmdictPack, PACK_FILES, JMDICT_ATTRIBUTION } from './jmdict.js';
import { importYomitan as importYomitanFile, restoreYomitan, listYomitanSources, removeYomitan } from './yomitan.js';
import { openStore } from './store.js';
import { candidates as buildCandidates } from './candidates.js';

export { JMDICT_ATTRIBUTION, PACK_FILES };
export { importYomitanFile as importYomitanFromFile, restoreYomitan, listYomitanSources, removeYomitan };

const DEFAULT_STORAGE = 'ml-dict';

/**
 * Where the packs are served, resolved from this module's own URL.
 *
 * A hard-coded '/dict/' is absolute from the domain root, so it works on a user
 * site and 404s from a project path such as /MyLinguistics-site/. This module
 * always lives at <site>/src/dict/index.js and the packs at <site>/dict/, so a
 * relative URL from here is right on both, for every page that imports it.
 */
const DEFAULT_PACK_BASE = new URL('../../dict/', import.meta.url).href;

function describe(error) {
  return String(error && error.message ? error.message : error);
}

/**
 * @param {{
 *   packs?: string[],
 *   packBaseUrl?: string,
 *   storageName?: string,
 *   restore?: string[],
 *   fetchImpl?: Function,
 *   onProgress?: Function
 * }} [options]
 */
export function createDictionary(options = {}) {
  const base = options.packBaseUrl || DEFAULT_PACK_BASE;
  const packs = Array.isArray(options.packs) ? options.packs : ['common'];
  const storageName = options.storageName || DEFAULT_STORAGE;
  const autoRestore = Array.isArray(options.restore) ? options.restore : [];

  const sources = [];
  const failures = [];
  let closed = false;
  let storePromise = null;

  function notify(event) {
    if (typeof options.onProgress === 'function') options.onProgress(event);
  }

  function hasStorage() {
    return typeof indexedDB !== 'undefined';
  }

  function getStore() {
    if (!hasStorage()) return Promise.reject(new Error('this environment has no IndexedDB'));
    if (!storePromise) {
      storePromise = openStore({ name: storageName }).catch(function (error) {
        storePromise = null;
        throw error;
      });
    }
    return storePromise;
  }

  async function loadPacks() {
    for (let i = 0; i < packs.length; i++) {
      const pack = packs[i];
      const file = PACK_FILES[pack];
      if (!file) {
        failures.push({ id: pack, stage: 'pack', error: 'unknown pack name' });
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
        // One missing pack must not take the dictionary down. The others are
        // still useful, and the failure is reported through problems().
        failures.push({ id: 'jmdict:' + pack, stage: 'pack', url: url, error: describe(error) });
        notify({ stage: 'pack-failed', pack: pack, error: describe(error) });
      }
    }
  }

  async function loadRestored() {
    for (let i = 0; i < autoRestore.length; i++) {
      try {
        await restore(autoRestore[i]);
      } catch (error) {
        failures.push({ id: autoRestore[i], stage: 'restore', error: describe(error) });
      }
    }
  }

  async function restore(id) {
    // close() dropped every source, and lookup() short-circuits on closed, so
    // a source restored afterwards would sit in the list answering nothing.
    if (closed) throw new Error('this dictionary is closed');
    if (!hasStorage()) throw new Error('this environment has no IndexedDB');
    const store = await getStore();
    const existing = sources.some(function (source) { return source.id === id; });
    if (existing) return null;
    const source = await restoreYomitan(store, id);
    sources.push(source);
    notify({ stage: 'restored', id: id, entries: source.entryCount });
    return source;
  }

  const ready = (async function load() {
    await loadPacks();
    await loadRestored();
    notify({ stage: 'ready', sources: sources.length, failures: failures.length });
  })();

  function findSource(id) {
    for (let i = 0; i < sources.length; i++) {
      if (sources[i].id === id) return sources[i];
    }
    return null;
  }

  /** One source as SourceInfo (interface 1.2). Always a fresh object. */
  function describeSource(source) {
    if (typeof source.info === 'function') return source.info();
    // JMdict packs do not report an index size or bank layout.
    return {
      id: source.id,
      kind: source.kind,
      title: source.title,
      revision: source.revision,
      licence: source.licence,
      attribution: source.attribution,
      entryCount: source.entryCount,
      languages: source.languages || null,
      keyCount: null,
      bankCount: null,
      banks: null
    };
  }

  /**
   * Where a source sits in the display order. See lookupGrouped.
   *
   * 0 - the definition is written in Japanese. 1 - it is written in some other
   * language, which is JMdict's case. 2 - the source does not say, so it cannot
   * claim to be primary.
   */
  function languageRank(info) {
    const languages = Array.isArray(info.languages) ? info.languages : [];
    if (languages.indexOf('ja') !== -1) return 0;
    if (languages.length > 0) return 1;
    return 2;
  }

  return {
    ready: ready,

    /** Ordered candidate forms for a surface string. Pure, no IO. */
    candidates(surface, token) {
      return buildCandidates(surface, token);
    },

    /**
     * Look a surface up. Accepts a plain string or { surface, token }.
     *
     * Sources are asked in load order, so an imported monolingual dictionary
     * added after the packs is consulted after them. Ordering across sources is
     * the caller's business: a JP-JP definition is usually wanted over a JP-EN
     * gloss, but that is a display decision, not a lookup one.
     */
    async lookup(text, lookupOptions) {
      await ready;
      if (closed) return [];
      const input = typeof text === 'string' ? { surface: text } : (text || {});
      const token = input.token || (lookupOptions && lookupOptions.token);
      const list = buildCandidates(input.surface, token);
      if (list.length === 0) return [];

      const merged = [];
      const seen = new Set();
      for (let c = 0; c < list.length; c++) {
        for (let s = 0; s < sources.length; s++) {
          const hits = await sources[s].lookup([list[c]]);
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

    /**
     * Look a surface up, grouped by source, in the order a learner reads them.
     *
     * lookup() returns one flat list in load order and leaves ordering to the
     * caller. There are two callers now - the reader's popup and the wordbook's
     * dictionary view - and both answer the same question, so the policy lives
     * here once rather than being re-derived twice and differently.
     *
     * Order: a dictionary whose definitions are in Japanese first, because it
     * answers "what does this mean" instead of glossing it; then every other
     * language; then a source that reports no language at all. Load order
     * breaks ties, so the order is stable across calls.
     *
     * A source with no hits is not returned. The caller renders what is there
     * without having to tell "no such word" apart from "this dictionary has
     * nothing to say" or "it is not imported yet".
     *
     * Shape: SourceInfo with entries. Attribution travels with the group,
     * because JMdict's licence requires it wherever its data is shown and a
     * Yomitan source carries its own.
     *
     * @returns {Promise<Array<SourceInfo & { entries: Entry[] }>>}
     */
    async lookupGrouped(text, lookupOptions) {
      await ready;
      if (closed) return [];
      const input = typeof text === 'string' ? { surface: text } : (text || {});
      const token = input.token || (lookupOptions && lookupOptions.token);
      const list = buildCandidates(input.surface, token);
      if (list.length === 0) return [];

      const groups = sources.map(function (source, order) {
        const info = describeSource(source);
        return {
          info: info,
          order: order,
          rank: languageRank(info),
          entries: [],
          seen: new Set()
        };
      });

      // Candidate-outer, source-inner, exactly as lookup() does it, so the two
      // cannot disagree about which entries a surface reaches.
      for (let c = 0; c < list.length; c++) {
        for (let s = 0; s < sources.length; s++) {
          const hits = await sources[s].lookup([list[c]]);
          const group = groups[s];
          for (let h = 0; h < hits.length; h++) {
            const entry = hits[h];
            const key = entry.source + ':' + entry.id;
            if (group.seen.has(key)) continue;
            group.seen.add(key);
            group.entries.push(entry);
          }
        }
      }

      return groups
        .filter(function (group) { return group.entries.length > 0; })
        .sort(function (a, b) { return a.rank - b.rank || a.order - b.order; })
        .map(function (group) {
          return Object.assign({}, group.info, { entries: group.entries });
        });
    },

    /** Kanji detail, when a source that carries it is loaded. */
    async kanji(character) {
      await ready;
      for (let i = 0; i < sources.length; i++) {
        const detail = await sources[i].kanji(character);
        if (detail) return detail;
      }
      return null;
    },

    /**
     * A read-only lexicon over every loaded source, for segmentation and for
     * "is this a word" checks. has() is synchronous and consults the indexes
     * that are already in memory, so it copies nothing.
     */
    lexicon() {
      return {
        has(form) {
          if (typeof form !== 'string' || form.length === 0) return false;
          for (let i = 0; i < sources.length; i++) {
            if (typeof sources[i].has === 'function' && sources[i].has(form)) return true;
          }
          return false;
        },
        count() {
          let total = 0;
          for (let i = 0; i < sources.length; i++) {
            if (typeof sources[i].formCount === 'number') total += sources[i].formCount;
            else if (typeof sources[i].keyCount === 'number') total += sources[i].keyCount;
          }
          return total;
        },
        /**
         * A uniform random sample of forms from every loaded source, by
         * reservoir sampling, so a word stream can draw from the whole
         * dictionary without materialising half a million strings.
         */
        sample(count) {
          const wanted = Math.max(0, Math.floor(count) || 0);
          const out = [];
          if (wanted === 0) return out;
          let seen = 0;
          for (let i = 0; i < sources.length; i++) {
            if (typeof sources[i].forms !== 'function') continue;
            const iterable = sources[i].forms();
            for (const form of iterable) {
              if (typeof form !== 'string' || form.length === 0) continue;
              if (seen < wanted) {
                out.push(form);
              } else {
                const j = Math.floor(Math.random() * (seen + 1));
                if (j < wanted) out[j] = form;
              }
              seen++;
            }
          }
          return out;
        }
      };
    },

    /** Raw bytes of a file inside an imported dictionary zip, or null. */
    async asset(sourceId, path) {
      await ready;
      const source = findSource(sourceId);
      if (!source || typeof source.asset !== 'function') return null;
      return source.asset(path);
    },

    /** A blob URL for one dictionary asset, or null. The caller revokes it. */
    async assetUrl(sourceId, path) {
      await ready;
      const source = findSource(sourceId);
      if (!source || typeof source.assetUrl !== 'function') return null;
      return source.assetUrl(path);
    },

    /** An imported dictionary's own styles.css text, or null. */
    async dictionaryStyles(sourceId) {
      await ready;
      const source = findSource(sourceId);
      if (!source || typeof source.styles !== 'function') return null;
      return source.styles();
    },

    /** Everything currently in memory, as SourceInfo (interface 1.2). */
    sources() {
      return sources.map(describeSource);
    },

    /**
     * Anything that failed to load, restore or read, in the order it failed.
     *
     * A source can also fail later - a Yomitan bank that will not inflate is
     * noticed on the lookup that lands in it - so those failures are collected
     * from the sources too, or they would happen invisibly.
     */
    problems() {
      const out = failures.slice();
      for (let i = 0; i < sources.length; i++) {
        if (typeof sources[i].problems !== 'function') continue;
        const sourceProblems = sources[i].problems();
        for (let j = 0; j < sourceProblems.length; j++) out.push(sourceProblems[j]);
      }
      return out;
    },

    /**
     * Import a Yomitan dictionary from a File. Persists it when storage is
     * available, so the next session can restore it without the file.
     */
    async importYomitan(file, onProgress) {
      await ready;
      // Same reason as restore(): after close() a pushed source is unreachable,
      // so importing one is refused rather than half-done.
      if (closed) throw new Error('this dictionary is closed');
      let store = null;
      if (hasStorage()) {
        try {
          store = await getStore();
        } catch (error) {
          failures.push({ id: 'storage', stage: 'import', error: describe(error) });
        }
      }
      const source = await importYomitanFile({
        file: file,
        store: store,
        onProgress: typeof onProgress === 'function' ? onProgress : options.onProgress
      });
      sources.push(source);
      notify({ stage: 'imported', id: source.id, entries: source.entryCount });
      return source.result;
    },

    /** Load a previously imported dictionary back into memory. */
    restore: restore,

    /** What is stored but not loaded. Cheap: it reads metadata only. */
    async stored() {
      if (!hasStorage()) return [];
      const store = await getStore();
      return listYomitanSources(store);
    },

    /** Forget a source, in memory and on disk. */
    async removeSource(id) {
      for (let i = sources.length - 1; i >= 0; i--) {
        if (sources[i].id === id) {
          if (typeof sources[i].clearCache === 'function') sources[i].clearCache();
          sources.splice(i, 1);
        }
      }
      if (hasStorage()) {
        try {
          const store = await getStore();
          await removeYomitan(store, id);
        } catch (error) {
          failures.push({ id: id, stage: 'remove', error: describe(error) });
        }
      }
    },

    async usage() {
      if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) {
        return { bytes: null, quota: null, supported: false };
      }
      const estimate = await navigator.storage.estimate();
      return { bytes: estimate.usage, quota: estimate.quota, supported: true };
    },

    /**
     * Drop every source and spend the dictionary. After this lookup() answers
     * nothing, and importing or restoring rejects rather than pushing a source
     * that can never be reached again.
     */
    close() {
      closed = true;
      for (let i = 0; i < sources.length; i++) {
        if (typeof sources[i].clearCache === 'function') sources[i].clearCache();
      }
      sources.length = 0;
    }
  };
}

export default { createDictionary };
