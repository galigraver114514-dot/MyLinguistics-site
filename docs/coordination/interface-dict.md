# Frozen interface: shared dictionary module

**Version 1.7. Owner: agent-reader.** Changing this file requires a version bump
and an `ANSWER:` entry in `log-wordbook.md` agreeing to it.

Changes in 1.1: Entry gained `headwords` and `readings`, and `raw` is now
documented as null for JMdict. Both are additive, so a version 1 consumer is
unaffected. They were added because an entry can be written several ways - 心 has
two readings, a verb has a kanji form and a kana form - and a caller that can
only see one of them is being shown less than the dictionary knows.

Changes in 1.2: SourceInfo gained `languages`, `keyCount`, `bankCount` and
`banks`. Additive again. `banks` matters because a monolingual dictionary
often ships no meta bank at all, which means no frequency and no pitch accent,
and a caller that wants to show a badge needs to be able to tell that apart from
a dictionary that simply has not loaded yet.

Changes in 1.3: `structured.js` is implemented and documented in full below,
and the Dictionary facade gained three ways to reach inside an imported
dictionary's zip - `asset`, `assetUrl`, `dictionaryStyles`. Additive once
more: nothing existing changed shape, and 1.2 listed some fields in
`sources()` that the implementation was still returning as a subset, which is
now fixed rather than extended.

Changes in 1.4: `src/dict/tokenize.js` exists, Dictionary gained
`lexicon()` with `has`, `count` and `sample`, and the Tokenisation
section below is new. Additive: nothing existing changed shape. The tokeniser's
lexicon is the loaded dictionary indexes themselves, and `sample` answers the
wordbook's request for a way to reach the shared word pool.

Changes in 1.5: the JMdict **common** pack is built and shipped with the site in
`dict/`, so `createDictionary()` has a real dictionary on the first visit
with nothing imported. `packBaseUrl` now defaults to that directory
**resolved from this module's own URL** rather than the hard-coded `/dict/`: a
domain-root path 404s on a GitHub Pages project site, and the module always sits
at `<site>/src/dict/index.js` next to `<site>/dict/`. Passing
`packBaseUrl` still overrides it. Also fixed a real segmentation bug in
`scriptRuns` with no API change - see the Tokenisation section.

Changes in 1.6: `scriptRuns` and `longestMatch` join a kanji run to the
next one across a one-kana infix, so 振り分け, 食べ物 and 読み方 are one token
instead of two. No API shape changed; the version moves because the tokens a
consumer sees do.

Changes in 1.7: Dictionary gained `lookupGrouped`, which is `lookup()`
grouped by source and put in reading order. Purely additive - `lookup()` is
untouched, still flat and still in load order, so no existing caller changes
behaviour. It exists because the wordbook's dictionary view shows a monolingual
dictionary and JMdict as two labelled sections, and the reader's popup wants the
same order; without it each caller re-derives the grouping and they drift.

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
      tokenize.js      text -> tokens, over the loaded dictionary index
      store.js         IndexedDB persistence

    tests/dict-*.test.js

Plain ES modules, no build step, no bundler. Node tests use `fake-indexeddb`
and `jsdom`.

## Public API

    createDictionary(options) -> Promise<Dictionary>

    options = {
      packs:       ['common'] | ['common', 'full'] | [],   // bundled JMdict
      packBaseUrl: <resolved from this module>,  // default <site>/dict/
      storageName: 'ml-dict',       // IndexedDB database name
      onProgress:  (event) => void  // optional
    }

    Dictionary = {
      ready:          Promise<void>          resolves when bundled packs are usable
      lookup(text, opts)     -> Promise<Entry[]>   text may be inflected
      lookupGrouped(text, opts) -> Promise<LookupGroup[]>  same hits, grouped
      candidates(surface, token) -> string[]       pure, no IO
      kanji(ch)              -> Promise<KanjiInfo | null>
      sources()              -> SourceInfo[]
      problems()             -> Array<{ id, stage, error }>
      importYomitan(file, onProgress) -> Promise<ImportResult>
      stored()               -> Promise<SourceInfo[]>  imported, not loaded
      restore(id)            -> Promise<Source|null>
      removeSource(id)       -> Promise<void>
      asset(sourceId, path)  -> Promise<{ data: Uint8Array, mediaType } | null>
      assetUrl(sourceId, path) -> Promise<string | null>  blob URL; caller revokes
      dictionaryStyles(id)   -> Promise<string | null>    the zip's styles.css
      lexicon()              -> { has(form): boolean, count(): number, sample(n): string[] }
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

    LookupGroup = SourceInfo & { entries: Entry[] }

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

`lookupGrouped` returns one group per source **that has a hit** - a source with
nothing to say is absent rather than empty, so a caller renders what is there and
does not have to tell "no such word" apart from "not imported yet". Order is a
policy in the module, not in each caller: a dictionary whose definitions are in
Japanese comes first, because it answers the question rather than glossing it;
then a dictionary in any other language, which is JMdict's case; then a source
that reports no language at all, which cannot claim to be primary. Load order
breaks ties, so the order is stable. Every group carries its own `licence` and
`attribution`, because JMdict's licence requires attribution wherever its data
is shown and an imported dictionary carries its own.

## Structured content

`glosses` for a Yomitan entry are not strings. `structured.js` converts
Yomitan's tag tree into DOM nodes:

    node = { tag, style?, data?, content?, href? }

Required tags: `span div p ol ul li table thead tbody tr th td ruby rb rt br
img a`. Required behaviour, all implemented:

- `data.name` is semantic (見出部, 見出仮名, 標準表記, ...). It is kept as a
  `data-` attribute so per-dictionary CSS can target it; never discarded.
- `a` elements are cross-references. They render as focusable elements with
  `data-href`, `role="link"` and `tabindex="0"`. A click, or Enter or
  Space while focused, calls `onReference(href, event, text)` and fires a
  bubbling `dictionary-reference` CustomEvent whose `detail` is
  `{ href, text }`. There is deliberately no real `href`, so the browser
  never navigates and the caller keeps ownership of its history stack. **A
  monolingual dictionary is unusable if these are dead.**
- `img` elements carry `data-path`, relative to the zip, and are resolved
  in a second pass by `hydrateImages(root, resolveImage)`, or immediately by a
  synchronous `options.resolveImage`. A broken `src` is never emitted.
- `script`, `iframe` and the rest of a fixed unsafe list are dropped as
  elements while their text is kept, so a glossary never renders as markup.
- Per-dictionary `styles.css` from the zip is scoped and injected once by
  `ensureStyles(document, sourceId, css)`. Scoping is a conservative selector
  rewrite: conditional at-rules are descended into, and `font-face` and
  `keyframes` are left byte-for-byte alone.

    structured.js exports
      renderGloss(gloss, options)   -> DocumentFragment  string or tree, no branching
      renderNode(node, options)     -> Node | null
      plainText(gloss)              -> string            flattens a tree, ruby included
      hydrateImages(root, resolve)  -> Promise<number>   how many images resolved
      scopeStyles(css, scope)       -> string
      dictionaryScope(id)           -> string
      ensureStyles(doc, id, css)    -> HTMLStyleElement | null

    options = { document, onReference, resolveImage, referenceClass }

`plainText` matters outside the reader: a wordbook that only accepts strings
would otherwise have to skip every monolingual sense, which is most of them.
Images and stylesheets are read from the zip through the facade above, so the
renderer itself needs no zip access.

## Tokenisation

Both apps need the same two things: split a passage into words, and find the
word under a tap. `src/dict/tokenize.js` is that module and the only
implementation; the wordbook's `src/lexicon/tokenize.js` is its predecessor
and is deleted once this is wired.

The lexicon is the point. A loaded dictionary index already holds every
headword and reading, so maximal matching against it needs no model download
and no new data. `lexicon()` is that index as a lexicon - synchronous,
allocation-free, consulting the indexes already in memory.

    lexicon() = { has(form) -> boolean, count() -> number, sample(n) -> string[] }

    segment(text, { lexicon?, maxLength? }) -> Token[]
    longestMatch(text, lexicon, options)    -> Token[]
    scriptRuns(text)                        -> Token[]      no lexicon needed
    contentTokens(text, { lexicon? })       -> string[]     content surfaces only
    splitSentences(text)                    -> { text, start, end }[]
    tokenAt(tokens, offset)                 -> Token | null   tap to look up
    isContent(surface), classify(surface), classOf(cp), walk(text)

    Token = { surface: string, start: number, end: number, cls: string }

Offsets are UTF-16 into the original string, so a lookup can always be traced
back to the text the learner touched. `segment` uses the lexicon when one is
given and script runs when not, so no caller branches on it. Where nothing
matches, the gap up to the next match is script-run segmented rather than the
rest of a hiragana run being swallowed: `犬がいます` becomes `犬 + が +
います`, not `犬 + がいます`.

The fallback finds the particle boundary from the **end** of the okurigana run,
never during absorption: `食べるまで` is `食べる + まで`, and
`食べさせられた` survives `さ`, which the older character-by-character
version split. Particles are also filtered as stopwords, so `だけ` is never
offered as a candidate.

The fallback also joins a kanji run to the next one across a one-kana infix
(`振り分け`, `食べ物`, `読み方`) and refuses when the infix is longer or
ends a te-form (`思わず`, `食べて`), when the piece so far is a known
function word (`少し + 食べる`), or when a case particle starts the okurigana
(`犬 + が + います`). The ambiguous kana - `か`, `さ`, `ね`, `よ`,
`な`, `ぞ`, `ぜ` - are never boundaries, because `静か` and `長さ`
need them. In `longestMatch` such a fallback token beats a **shorter**
dictionary match, which is what stops `振り分け` from being taken apart by its
own entries `振り` and `分け`. A pure kanji run is still left to the
lexicon: consecutive kanji can only be split by a dictionary.

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
