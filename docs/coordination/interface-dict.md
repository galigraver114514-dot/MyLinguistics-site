# Frozen interface: shared dictionary module

**Version 1.1. Owner: agent-reader.** Changing this file requires a version bump
and an `ANSWER:` entry in `log-wordbook.md` agreeing to it.

Changes in 1.1: Entry gained `headwords` and `readings`, and `raw` is now
documented as null for JMdict. Both are additive, so a version 1 consumer is
unaffected. They were added because an entry can be written several ways - 心 has
two readings, a verb has a kanji form and a kana form - and a caller that can
only see one of them is being shown less than the dictionary knows.

Both the reader and the vocabulary system need the same four things: import a
Yomitan dictionary, resolve an inflected surface to a dictionary form, look a
form up, and render a definition. This is that module, and nothing else.

## Location and shape

    src/dict/
      index.js         public entry, createDictionary()
      jmdict.js        bundled JMdict packs: fetch, parse, index
      yomitan.js       Yomitan zip import, per-bank inflation, search index
      candidates.js    surface -> candidate dictionary forms
      structured.js    Yomitan structured-content -> DOM nodes
      store.js         IndexedDB persistence

    tests/dict-*.test.js

Plain ES modules, no build step, no bundler. Node tests use `fake-indexeddb`
and `jsdom`.

## Public API

    createDictionary(options) -> Promise<Dictionary>

    options = {
      packs:       ['common'] | ['common', 'full'] | [],   // bundled JMdict
      packBaseUrl: '/dict/',        // where pack artefacts are served
      storageName: 'ml-dict',       // IndexedDB database name
      onProgress:  (event) => void  // optional
    }

    Dictionary = {
      ready:          Promise<void>          resolves when bundled packs are usable
      lookup(text, opts)     -> Promise<Entry[]>   text may be inflected
      candidates(surface, token) -> string[]       pure, no IO
      kanji(ch)              -> Promise<KanjiInfo | null>
      sources()              -> SourceInfo[]
      importYomitan(file, onProgress) -> Promise<ImportResult>
      removeSource(id)       -> Promise<void>
      usage()                -> Promise<{ bytes, quota }>
      close()                -> void
    }

    Entry = {
      id:        string,        // stable within a source
      source:    string,        // SourceInfo.id
      headword:  string,        // first spelling, kanji preferred
      reading:   string | null, // first reading, kana
      headwords: string[],      // every spelling, in the source's order
      readings:  string[],      // every reading
      senses:    Sense[],
      priority:  string[],      // 'ichi1' | 'news1' | 'spec1' | 'gai1'
      raw:       unknown        // null for JMdict: the shared shape already
                                // carries everything displayable, and holding
                                // the original would double memory for 218k
                                // entries. Yomitan sources may populate it.
    }

    Sense = {
      pos:      string[],       // from the source, untranslated tags
      tags:     string[],
      language: 'en' | 'ja',    // never assume 'en'
      glosses:  StructuredNode[] | string[]
    }

    SourceInfo = {
      id, title, revision, kind: 'jmdict' | 'yomitan',
      entryCount: number | null, licence: string, attribution: string
    }

    ImportResult = {
      source: SourceInfo, banks: number, entries: number,
      uncompressedBytes: number, elapsedMs: number, storedBytes: number | null
    }

`lookup` and `importYomitan` must both be safe to call concurrently and must
never block the main thread for more than ~50 ms at a time; yield between banks.

## Structured content

`glosses` for a Yomitan entry are not strings. `structured.js` converts
Yomitan's tag tree into DOM nodes:

    node = { tag, style?, data?, content?, href? }

Required tags: `span div p ol ul li table thead tbody tr th td ruby rb rt br
img a`. Required behaviour:

- `data.name` is semantic (見出部, 見出仮名, 標準表記, ...). Keep it as a
  `data-` attribute so per-dictionary CSS can target it; do not discard it.
- `a` elements are cross-references. Render them as focsable elements and
  emit a click event carrying `href` so the caller can push them onto its own
  history stack. **A monolingual dictionary is unusable if these are dead.**
- `img` sources resolve relative to the dictionary zip; the module returns
  object URLs or blob URLs, not broken paths.
- Per-dictionary `styles.css` from the zip is scoped and injected once.

## Performance budget, measured on the target device

These are real measurements from the spike, not estimates. Do not regress them.

| Operation | Budget |
| --- | --- |
| full JMdict cold start (112 MB JSON, 218,776 entries, 499,121 keys) | 2.4 s |
| lookup, warm | under 1 ms |
| Yomitan import, 83 MB zip, 168 banks, 507 MB uncompressed, 334,751 rows | 2.3 s |
| inflate + parse one bank (3.6 MB, 2000 rows) | 35 ms |
| peak memory during Yomitan import | one bank |

## Invariants

1. **No sharding, no streaming parser, no separate data service.** Measured
   unnecessary. Load whole JSON and parse it.
2. **Peak memory during Yomitan import is one bank.** Process bank by bank;
   never hold two parsed banks plus the index.
3. **Definitions must not assume English.** JP-JP is the primary case.
4. **An imported dictionary is never bundled or uploaded.** It stays on the
   device.
5. **The module never touches the DOM except through `structured.js`, and
   never touches reader or wordbook state.** It has no opinion about how a
   definition is displayed.

## Open item the implementer must close first

`navigator.storage.estimate()` reported only 13 MB used after an 83 MB zip
blob was written to IndexedDB. The index round-trip is proven; **the blob
round-trip is not**. Store the zip and inflate banks on demand **only if** the
blob reads back at the right size; otherwise the fallback is to expand all banks
into IndexedDB, which costs roughly 507 MB. Decide this before writing
`store.js`.
