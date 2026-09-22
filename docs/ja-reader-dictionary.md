# Japanese Reader - the dictionary subsystem

Companion to `ja-reader-design.md`. Every number below was measured, most of
them on the target device.

## 1. Measured facts

JMdict (English), from `scriptin/jmdict-simplified` release
`3.6.2+20260914172325`.

| | full | common subset |
| --- | --- | --- |
| official archive (`.tgz`) | 11.0 MB | 1.4 MB |
| raw JSON | **112.5 MB** | 15.7 MB |
| entries | 218,776 | 22,640 |
| kanji forms | 233,458 | - |
| kana forms | 265,663 | - |
| distinct lookup keys | **499,121** | 54,154 |
| senses / glosses | 253,596 / 443,239 | - |
| heap for one `JSON.parse` (desktop V8) | +557 MB | ~70 MB |

Other packs: JMnedict (names) 12.8 MB, KANJIDIC2 1.2 MB, KRADFILE 0.1 MB.

Licences: JMdict, JMnedict and KANJIDIC2 are **Creative Commons BY-SA 4.0**
(EDRDG) and may be redistributed with attribution.

### Measured on the iPad instead

| Stage | common pack | full pack |
| --- | --- | --- |
| download (gzip) | 1.4 MB / 408 ms | 10.7 MB / 1214 ms |
| gunzip | 25 ms | **134 ms** |
| utf-8 decode | 17 ms | 102 ms |
| `JSON.parse` | **62 ms** | **334 ms** |
| build the lookup index | **9 ms** | **108 ms** |
| entries / lookup keys | 22,640 / 54,154 | 218,776 / 499,121 |
| **total, cold start to indexed** | **~0.5 s** | **~2.4 s** |
| 3,000 lookups | under 0.5 ms | under 0.5 ms |

## 2. The conclusion that changed

An earlier draft of this document argued that the dictionary must be split into
256 balanced key shards plus 256 entry shards, fetched on demand, because a
desktop measurement showed 557 MB of heap for a single `JSON.parse` and an iPad
was assumed to be far weaker.

**That was wrong.** The iPad parses the entire 112.5 MB JMdict, builds a
499,121-key index over it, and is ready in **2.4 seconds**, with lookups under a
millisecond. It also survives a 1 GB allocation and a 203 MB JSON parse in the
memory probe.

So:

- **No sharding.** No key shards, no entry shards, no manifest, no prefix
  buckets, no binary format.
- **No separate data repository and no CDN.** The dictionary is a build-time
  artefact of the site itself, or a single file fetched once.
- **No streaming parser** for JMdict.
- **No Web Worker required** for the parse. 334 ms of blocking is noticeable
  once and acceptable; it can still go in a worker for tidiness, but it is not
  an architectural requirement.
- **No range requests, no lazy shard loading, no LRU eviction.**

Roughly a week of planned work removed. The only thing worth keeping from the
old design is the idea of loading the dictionary in the background so the first
screen is not delayed.

### What to watch instead

The parse is not free in memory. At peak the browser holds the 112.5 MB JSON
string as UTF-16 plus the parsed object graph. Safari exposes no
`performance.memory`, so this was never measured directly; the device simply
survived. The practical consequence: load the **common** pack eagerly, and treat
the **full** pack as an optional download, so a device under memory pressure is
not holding a dictionary it is not using.

## 3. Yomitan dictionaries: the primary source

The user's main dictionary is a locally held Yomitan JP-JP dictionary, so this
is the critical path, not an afterthought.

### Measured on a real one

`[JA-JA] 大辞林　第四版.zip`, on the iPad:

| | |
| --- | --- |
| zip size | 83.13 MB |
| entries in the zip | 3,028 |
| term banks | **168** |
| tag banks / meta banks / kanji banks | 1 / 0 / 0 |
| total uncompressed | **551.79 MB** |
| **largest single term bank** | **3.59 MB, 2000 rows** |
| inflate the largest bank | 9 ms |
| decode it | 10 ms |
| `JSON.parse` it | **26 ms** |
| format / title | 3, 大辞林　第四版 |

**This kills the second sharding requirement.** No single bank is large enough
to be a problem: the biggest is 3.6 MB and 2000 rows. So the feared
"two-hundred-megabyte JSON that must be stream-parsed" does not exist in
practice.

**Import is therefore a loop, not a parser.** Walk the zip entries, inflate one
bank, `JSON.parse` it, write it to IndexedDB, release it, next bank. Peak
memory is one bank. 168 banks at roughly 45 ms each is under ten seconds of
work, and it is fully resumable.

### Recommended on-device layout

Keep the original zip and build an index, rather than expanding 551 MB:

1. on import, walk every term bank once, inflating and parsing each in turn;
2. from each row record only `key -> (bank, row)` into a compact index, and
   nothing else;
3. store the original zip blob plus that index in IndexedDB;
4. on lookup, inflate the one bank that contains the hit (9 ms), cache the
   parsed bank in a small LRU, and serve from it.

That keeps the persistent footprint near the 83 MB zip rather than 551 MB, and
makes lookups fast after the first hit in a bank.

**Measured on the device, this whole import takes 2.28 seconds:**

| Stage | Time |
| --- | --- |
| walk all 168 banks, 507.61 MB uncompressed, 334,751 rows | 1842 ms |
| write the 602,669-key index (a 2.3 MB Int32Array plus the key strings) | 97 ms |
| write the 83 MB zip blob | 51 ms |
| read the index back | 40 ms, all 602,669 keys intact |
| slowest single bank | 17 ms |

One caveat to close during implementation: `navigator.storage.estimate()`
reported only 13 MB of usage after the 83 MB blob was written. The index
round-trip is proven, the blob round-trip is not, and the answer decides whether
the zip can be persisted and banks inflated on demand or whether all 507 MB must
be expanded into IndexedDB. Check it early; it is a five-line test.

### Definition rendering is a real piece of work

Yomitan glosses are **not plain strings**. The sampled 大辞林 row is:

    ["月見座頭","つきみざとう","","",0,
     [{"type":"structured-content","content":[
        {"tag":"span","data":{"name":"見出部"},"content":[
           {"tag":"span","style":{"fontWeight":"bold"},
            "data":{"name":"見出仮名"},"content":"つきみざとう"}, ... ]}]}],
     1234567, []]

So the reader needs a **structured-content renderer**: nested `tag` trees
(`span`, `div`, `ol`, `ul`, `li`, `table`, `ruby`, `br`, `img`),
inline `style`, semantic `data.name` markers (見出部, 見出仮名, 標準表記 and
so on), per-dictionary `styles.css`, and — most importantly — `a` links for
cross-references, which in a monolingual dictionary are used constantly.

Budget a few hundred lines, plus per-dictionary CSS. It is the single largest
piece of UI work in the dictionary subsystem and it cannot be skipped.

### Licensing

Third-party Yomitan dictionaries of copyrighted works circulate unofficially.
They must never be bundled into the public site. Local import keeps the data on
the user's device and keeps the project clean. Only EDRDG data (CC BY-SA) is
bundled.

## 4. Lookup pipeline

Candidates, in order:

1. the surface itself;
2. kana normalisation (katakana to hiragana and back);
3. the tokeniser's `basic_form` for the token covering the click;
4. deinflected candidates from a suffix-stripping rule table (Yomitan's
   `deinflect.json` is portable);
5. orthographic variants (kyuujitai to shinjitai, okurigana variation).

Ranking: exact key match, then reading match, then deinflected match; within a
tier, JMdict priority tags (`ichi1`, `news1`, `spec1`, `gai1`), then
frequency, then entry order.

Note that step 3 covers most click-to-lookup cases, so the deinflector is only
needed for arbitrary selections and tokeniser failures.

## 5. Frequency, pitch accent, monolingual

- **Frequency**: build our own from 青空文庫. The texts are public domain, so a
  derived list is clean, and a corpus of novels and essays matches the user's
  reading far better than subtitle or anime based lists.
- **Pitch accent**: deferred. The blocker is licensing, not difficulty - the
  accent data in circulation traces back to copyrighted dictionaries. If the
  user's Yomitan collection includes a pitch dictionary, the import path will
  surface it for free.
- **Monolingual**: required, and the reason section 3 matters. JMdict is JP-EN
  only, and at this level a JP-JP dictionary is often more useful. Definitions
  in Japanese come only from imported Yomitan dictionaries, so the definition
  renderer must never assume English.

## 6. The tokeniser

Settled, and it works. kuromoji's dictionary is **16.97 MB** across 12
`.dat.gz` files - not the 4 MB an article claimed, which is why a build
against a CDN copy appeared to hang. Self-hosted:

| Stage | Time |
| --- | --- |
| fetch 16.97 MB across 12 files | 4617 ms |
| load kuromoji.js, 308 KB | 365 ms |
| build the tokenizer | 565 ms |
| **cold start** | **~5.5 s** |
| tokenise 20,000 characters | 44 ms (2.2 ms per 1000) |

Over 20,000 characters, **every one of 12,616 tokens carried both a reading and
a `basic_form`**, and 1,077 were inflected. That means:

- **furigana generation would have had a reading for every token**, with no
  gaps to interpolate - noted, and then dropped on 2026-09-22, see
  @@ja-reader-design.md@@ section 7;
- **click-to-look-up can use `basic_form` as the dictionary form** for the
  common case, so the deinflection engine is only needed for arbitrary
  selections and tokeniser failures.

The tokeniser dictionary should ship with the site rather than come from a
third-party CDN: it is 17 MB, it is fetched once, and serving it from our own
origin removes a dependency on someone else's availability and compression
behaviour.

Remaining minor risks: a larger or multi-volume Yomitan dictionary may ship far
more than 168 term banks, so the import loop must stay resumable; and the blob
round-trip noted in section 3 is still unverified.

## 7. Build pipeline

Much smaller than the old design required:

1. fetch the jmdict-simplified release and strip it to the fields the reader
   uses (headwords, readings, part of speech, glosses, priority tags);
2. write one artefact per pack (common, full, names);
3. ship them as ordinary files or as a single optional download.

No separate data repository, no CDN, no shard generation, no manifest. The
packs belong in the site's own build output.

**Built:** @@dict/jmdict-eng-common.json.gz@@, 1.4 MB, the release JSON gzipped
unchanged. It is committed and served at @@/dict/@@; @@dict/README.md@@ carries
the source, the licence and the rebuild command. The @@full@@ and @@names@@
packs are named but not committed: 11 MB in the public git history is paid again
on every release for a pack the reader does not load by default.

Attribution and the CC BY-SA licence text ship alongside and are rendered in
the UI.
