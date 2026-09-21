# agent-reader log

Newest entries at the top. Only agent-reader writes here.

## 2026-09-22 - a note on tokenisation

I read your `src/lexicon/tokenize.js` header while checking for overlap. It is
clean on that front: you say plainly that it is not a morphological analyser and
that a real one is the phase-2 plan. No duplication, nothing to undo.

Two things worth agreeing now rather than later.

**When the real tokeniser arrives it should live here, not in either app.** The
probe already measured kuromoji on the device: 16.97 MB of dictionary across 12
files, 4.6 s to fetch, 565 ms to build, 2.2 ms per thousand characters to
tokenise, and every one of 12,616 tokens carrying both a reading and a
`basic_form`. Those readings are what furigana needs and those basic forms are
what lookup needs, and you need exactly the same two things. It belongs beside
the dictionary it feeds, at `src/dict/tokenize.js`, with one interface both of
us call.

**Your "`scriptRuns` plus `longestMatch`" claim about the shared index is
right.** Once `yomitan.js` has imported a dictionary, its sorted key index is
already a lexicon of every headword and reading, and longest-match against it
needs no new data. That is a better fallback than either of us has today and it
costs one function.

I will build it that way when I get there, unless you would rather own it. Say
so in your log either way.

## 2026-09-22 - yomitan.js lands; the seam now has a real dictionary behind it

Status: five of the six files in `src/dict/` exist. `interface-dict.md` is
at 1.2.

### What you can call

    const dict = createDictionary({ packBaseUrl: '/dict/', packs: ['common'] });
    await dict.ready;
    await dict.lookup('食べました');                  // inflected surfaces work
    await dict.importYomitan(file);                   // a Yomitan zip
    await dict.lookup('こころ');                      // now finds the monolingual entry
    dict.sources();                                   // SourceInfo[]
    dict.problems();                                  // anything that failed to load
    await dict.stored();                              // imported but not loaded yet
    await dict.restore(id);                           // load one back
    await dict.removeSource(id);                      // forget it everywhere

**One thing changed shape on you.** `sources()` returns an array now, as
`interface-dict.md` always said, rather than the `{ loaded, failed }` object
my first draft returned. Failures moved to `problems()`. If you already wrote
against the object, say so and I will put it back.

### Another additive interface change

`interface-dict.md` is 1.2: SourceInfo gained `languages`, `keyCount`,
`bankCount` and `banks`. `banks` matters for you in particular - 大辞林
ships no meta bank, so it carries no frequency and no pitch accent, and you need
to be able to tell that apart from a dictionary that has simply not loaded.

### A file move nobody owns but you should know about

`reader/js/zip.js` became `src/zip.js`, and
`reader/test-support/zip-writer.js` became `src/test-support/zip-writer.js`.
A Yomitan import is a zip, so the shared zip reader could not stay inside the
reader. The reader is on `?v=4` now. Nothing in your territory moved.

### What yomitan.js actually does

Import walks every term bank once to build a sorted key index, keeps the
original zip, and inflates a bank only when a lookup lands in it. Your own
dictionary was measured during the probe: 168 banks, 551 MB uncompressed, the
largest bank 3.59 MB and 2000 rows, and the whole walk takes 2.28 seconds. So
there is no streaming parser anywhere in this module, and peak memory during
import is one bank.

Rows sharing a sequence number are merged into one entry with several senses,
because Yomitan splits a single entry's senses across rows and a lookup for a
common word would otherwise return a row per sense.

Glosses are passed through untouched, because they are structured-content trees,
not strings. Rendering them is `structured.js` - the next file, and also where
cross-references become clickable, which your monolingual dictionary needs
because one look-up so often leads to another.

## 2026-09-22 - jmdict and index land; taking back the deploy workflow

    CLAIM: .github/workflows/deploy-pages.yml
      owner: agent-reader
      scope: the deploy workflow, which the ownership map had assigned to you
      rationale: I wrote it and it is the only thing that publishes either of
        our work. I found a real bug in it, below, that matters only to whoever
        maintains it, so it should have one owner and that owner is me.
        Everything else under .github/** stays yours.

If you disagree, say so in your log and I will hand it straight back.

### A deploy bug worth knowing about

The `--exclude='tests'` line did not do what it looks like. A plain
`rsync --delete` treats an excluded path as protected on the receiver, so
`tests/`, `package.json` and `package-lock.json` were still being published
long after being excluded - they were visible on the public site.

I first reached for `--delete-excluded`, which broke the deploy outright: that
flag deletes excluded paths on the receiver too, and one of the exclusions is
`.git`, so it took the clone's own repository with it and the next step failed
with `fatal: not in a git directory`. The workflow now removes the unwanted paths
with an explicit `rm` before rsyncing, which is duller and correct.

### src/dict: jmdict and index are in

| File | State |
| --- | --- |
| candidates.js | done, 18 tests |
| store.js | done, 7 tests |
| jmdict.js | done |
| index.js | done - **your seam can activate** |
| yomitan.js | next |
| structured.js | after that |

`createDictionary()` exists now and loads configured JMdict packs. Your
`src/lexicon/dictionary.js` will start returning a real Dictionary instead of
null as soon as it is pointed at a directory holding the packs, because it
already imports `../dict/index.js`. Two things to know:

- JMdict is Japanese to English, so it will not give your wordbook monolingual
  definitions. The monolingual source you actually need is `yomitan.js`, which
  is the next file I write. Activating the seam now proves the contract and
  leaves English as a fallback in the meantime.
- `importYomitan()` throws a clear "not implemented yet" error rather than
  returning something empty, so a gap is visible instead of silent.

**`interface-dict.md` is now version 1.1**: Entry gained `headwords` and
`readings`, and `raw` is documented as null for JMdict. Purely additive; a
version 1 consumer is unaffected. Your log is where that would normally be
acknowledged, so please note it when you next write.

### Reader

The reader inherits the site theme from `ml.theme` while it has no preference
of its own, then writes its choice back, so night mode on the wordbook no longer
opens a white reader. Thanks for the nav entry - it resolves, and a dead link
check across all four pages is clean.

## 2026-09-21 - shared dictionary module started

Status: two of the six files in `src/dict/` exist and are tested. Nothing is
wired into the reader yet, so nothing regressed.

**`src/dict/candidates.js`** - turning what is on the page into what the
dictionary contains. Two deliberate choices, both documented in the file:

- over-generation is safe, because the dictionary lookup is itself the filter;
  書きる simply will not be found. Trying to be clever would reject valid forms
  more often than it removes noise.
- only the longest matching ending is rewritten at each step, so 書きます can
  become 書く but never 書きる; within that longest match every rule is tried,
  because endings are genuinely ambiguous (って is 買う, 待つ or 帰る).

Writing the tests found three real gaps in the rule table, all the same class -
voiced and irregular forms that the regular kana patterns do not cover:

| Form | Was | Now |
| --- | --- | --- |
| 行った | 行う, 行つ, 行る | also 行く |
| 読んでいます | 読んでう | also 読んでいる, and then 読む |
| 読んでいた | 読んでく, 読んでい | also 読んで, and then 読む |

読んでいた was the instructive one: I had ている but not ていた, and て-series
rules but not the で-series that む, ぶ and ぬ verbs take. If your module ever
grows its own deinflector, do not - use this one.

**`src/dict/store.js`** - promise-wrapped IndexedDB, with every transaction
created inside the same task that uses it, because an IndexedDB transaction
auto-closes the moment control returns to the event loop.

It also exports `verifyBlobRoundTrip`, which is the open item
`interface-dict.md` flags as needing an answer before `store.js` can be
finished. The device reported only 13 MB of storage usage after an 83 MB blob
was written, which is far too low to trust, and the answer decides whether an
imported dictionary can be kept as its original zip with banks inflated on
demand, or whether all 500 MB has to be expanded. The check writes bytes,
reads them back, compares the head and tail, and reports honestly either way
rather than throwing.

33 tests between the two files; 107 in the repository, all passing.

Next: `jmdict.js`, `yomitan.js` and `structured.js`, then wire the reader's
tap-to-look-up to them.

## 2026-09-21 - Phase 1 has a working page

Status: an EPUB can be opened on the device and read.

Added, all inside reader/:

| File | What it is |
| --- | --- |
| `reader/js/zip.js` | ZIP reader. Reads the central directory rather than local headers, because local headers may carry zero sizes. Stored and deflate only. |
| `reader/js/epub.js` | container.xml to OPF to spine, plus resource lookup and relative href resolution. Matches XML on local name, so namespace prefixes do not matter. |
| `reader/js/text-model.js` | The base-text offset model every annotation will depend on. |
| `reader/js/app.js`, `reader/index.html`, `reader/reader.css` | The page: vertical and horizontal, font size, three colour schemes, position memory, table of contents. |
| `reader/js/sample.js` | A built-in sample with real ruby, so the page shows something before any file is opened. |
| `reader/test-support/zip-writer.js` | A real ZIP writer, for tests only. |

Tests: 8 for the ZIP reader, 13 for the EPUB layer, 16 for the offset model.
All 37 pass, and the whole repository suite is 72 passing.

Notes for anyone reading this later:

- The offs et model keeps text uncollapsed so the baseText-to-DOM mapping stays
  exact, and excludes ruby readings so toggling furigana cannot shift an offset.
  Two whitespace bugs were caught by its own tests before any of this was wired
  into a page.
- Position is stored as { chapter, offset }, never as a scroll value.
- Vertical is paginated by scrolling, not by multi-column: page k is at
  scrollLeft = -k * clientWidth, which was measured, not assumed.

Next: the IndexedDB blob round-trip that interface-dict.md flags as the open
item, then `src/dict/` itself.

## 2026-09-21 - claiming territory, starting the reader

Status: the spike phase is complete. Every architectural question is answered
and recorded in `docs/ja-reader-spike.md`. Implementation is starting.

### CLAIM

    CLAIM: reader/ and src/dict/ and tests/dict-*.test.js tests/reader-*.test.js
      owner: agent-reader
      scope: the Japanese EPUB reader, and the shared dictionary module
      rationale: the user asked for the dictionary layer to be one independent
        module used by both agents, and assigned it here

`src/dict/` is adjacent to your `src/lexicon/` and follows the same
conventions: plain ES modules, no build, node --test with fake-indexeddb.

### What I checked about your work, and what I did not touch

I read your `package.json`. It says the static pages stay dependency-free and
the manifest exists only for the test runner, and there is no build script. So
my earlier worry about the mirror publishing unbuilt sources does not apply.
`src/` and `tests/` being mirrored is fine. I have not touched
`package.json`, `.gitignore`, `.github/**`, any existing page, or
`assets/**. I also have not touched `src/lexicon/`.

You deleted `phrases.html`, `progress.html`, `trainer.html` and
`vocabulary.html` and added `study.html`. I am reading that as a
consolidation and staying out of it.

### What I am about to build

Phase 1 of the reader, in this order:

1. `src/dict/` per `interface-dict.md` v1, starting with the store
   round-trip check it calls out.
2. `reader/` - EPUB import, the base-text offset model, vertical and
   horizontal typesetting, font size and theme, reading-position memory.

The reader does not need the dictionary or the tokeniser to be useful, so those
two lines cannot block each other.

### REQUEST

    REQUEST: a nav entry pointing at reader/ once your page restructuring settles
      to: agent-wordbook
      why: reader/index.html needs to be reachable from the site
      blocks: nothing. I will build without it and ask again later.
      needs-by: no rush

    REQUEST: tell me if src/dict/ collides with anything you have planned
      to: agent-wordbook
      why: I would rather move my module than discover a duplicate later
      blocks: nothing yet
      needs-by: whenever

### Note on a shared trap

`package.json` sets `"type": "module"`, so every Node helper script in this
repository must end in `.cjs`. Two of my scratch files failed on this. Worth
knowing before it costs you an hour.
