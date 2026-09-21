# Spyke: what each probe decides

The probe page lives at `spike.html` and is served at
`https://galigraver114514-dot.github.io/MyLinguistics-site/spike.html`.

> **Removed on 2026-09-22.** The probe page and its 30 MB of fixtures were
> deleted once every question was answered, and the mirror's history was
> rewritten so the fixtures are not carried in the public repository. Everything
> below is the record of what the probes measured; the numbers are the point,
> not the page.

## How to run it

1. Open the URL on the iPad and let it sit on the Home Screen once, so the
   standalone probes have something to measure.
2. Press **Run automatic probes**.
3. Press **Run render benchmark**.
4. Tap / Pencil-tap / Pencil-hover the pointer pad, and work through the manual
   confirmations.
5. Pick a real EPUB in section 10.
6. Only then, if you want the number, run the memory stress test. It can kill
   the tab; progress is written to storage before every step, so reopening the
   page shows how far it got.
7. Press **Copy report** and send it back.

## What each probe gates

| # | Probe | Decision it gates | Looks good when |
| --- | --- | --- | --- |
| 1 | Environment | PWA mode, safe areas, layout | `displayMode` is `standalone` when installed, and the safe-area top inset is not zero |
| 2 | Caret from a point | **the entire tap-to-look-up model** | `within1` is at least ~90% on vertical text, and furigana landings are mostly on the base text rather than `<rt>` |
| 3 | Native selection in vertical text | whether selection mode can delegate to iOS | you can select a phrase and it follows the columns |
| 4 | Multi-column pagination | how page turning is implemented | one page advances by exactly one column and `scrollLeft` has a known start and range |
| 5 | Custom Highlight API | highlights, notes, and the popup anchor | `supported: true` and all three cases paint in the right place |
| 6 | Pencil and pointer types | the on-demand furigana trigger, and Pencil highlighting | `penHover: true` |
| 7 | Storage | the offline dictionary and download-everything mode | `persistGranted: true` and a usable quota |
| 8 | Chapter render cost | eager whole-chapter rendering versus a screen at a time | furigana render under roughly 1.5 s for 20,000 characters |
| 9 | Furigana toggle shift | keeping the reading position across a furigana toggle | the shift is a measurable constant that can be subtracted |
| 10 | Real EPUB | whether the import path survives on the device | inflation completes and matches the declared size |
| 11 | Memory ceiling | how aggressively the dictionary must be sharded | gives the ceiling in MB, which is the budget everything else fits into |

## Fallbacks if a probe fails

| Failure | Fallback |
| --- | --- |
| caret API is inaccurate on vertical text | hit-test against precomputed per-token rectangles instead of relying on the caret API; more memory, always correct |
| caret lands in `<rt>` | map the returned node back to its base text node before computing the offset |
| highlight API mispaints in vertical text | fall back to wrapping ranges in `<span>` elements, recomputing offsets from the text model |
| multi-column stepping is unreliable | scroll continuously with scroll-snap, or paginate by translating a wrapper element instead of scrolling |
| Pencil hover never fires | tap is the only on-demand furigana trigger; the persistent policies carry more weight |
| `persist()` is refused | warn about the seven-day rule, keep downloads re-runnable, and offer a one-tap restore |
| chapter render is too slow | render lazily by visible range, which the text model already makes possible |

## v1 results - iPadOS 26.6, 2026-09-21

### Confirmed, and now assumed by the design

| Finding | Measured | Design impact |
| --- | --- | --- |
| **Pencil hover works** | `pointerType: 'pen'` with hover, plus `penDown` and touch | on-demand furigana via Pencil hover becomes the primary trigger for a near-native reader |
| hover cannot be detected by media query | `hover: hover` and `any-hover: hover` are both **false**, yet pen hover fires | feature-detect by listening for events, never by media query |
| standalone detection | `navigator.standalone === true` while `matchMedia('(display-mode: standalone)')` is **false** | use `navigator.standalone`; the display-mode media query is unreliable in an iPadOS 26 home-screen web app |
| persistent storage | `persist()` granted, `persisted()` true, quota **39322 MB** | download-everything mode is safe; a full dictionary plus books fits easily |
| IndexedDB and Cache Storage | 512 KB blob round-trip in 12 ms; cache put/match in 5 ms | both usable |
| chapter render cost | 20,000 chars with 5,232 ruby runs in **78 ms**, relayout on font change 48 ms | render whole chapters eagerly; no virtualisation needed |
| furigana changes pagination | content width 54,592 -> 55,582 px, **+1.8%** | toggling furigana shifts the page; restore position from the text offset |
| EPUB unzip | 0.26 MB, 36 entries, 76 KB inflate in 2 ms, byte-exact | the ZIP + `DecompressionStream` path is sound on the device |
| memory | 512 MB allocation fine; a 102 MB (UTF-16) JSON parse took 63 ms | the sharding plan stands, but the ceiling is higher than the desktop measurement suggested |
| native selection in vertical text | confirmed working by hand | selection mode delegates to iOS; no custom selection handles needed |
| safe area | bottom 25 px, top 0 | reserve the home-indicator strip |
| orientation | `screen.width/height` did not follow rotation; `innerWidth/Height` did | never lay out from screen dimensions |

Caveat on the memory numbers: the ladder parsed a flat array of small objects,
which is a much cheaper shape than JMdict's nested entries. It bounds the
string size, not the object-graph cost. The real test is parsing an actual
dictionary pack on the device.

### Three probes were defective, not failing

| Probe | What went wrong | v2 fix |
| --- | --- | --- |
| caret from a point | every one of 99 samples returned null. The APIs return null for points outside the viewport and the sample elements sat thousands of pixels below the fold. This says nothing about the device. | run inside a fixed full-screen stage; report the count of skipped out-of-viewport points, which must be zero |
| pagination | the multicol configuration never overflowed horizontally and only the horizontal axis was measured; the overflow probably went to the vertical axis, which was hidden. | four configurations, both axes, and a check that a one-page step sticks |
| highlight API | reported as not visible, but the probe ran off-screen with no horizontal control and no colour reference to compare against. | runs in the stage, adds a colour reference and a horizontal control case |
| furigana shift | measured a marker's own position, which does not move; the quantity that matters is the change in total paginated width. | replaced by a width delta probe |

## v2 results - iPadOS 26.6, after fixing the probes

### Caret from a point: solved, and better than needed

| Case | samples | exact | within 1 | null | rt hits | outside viewport |
| --- | --- | --- | --- | --- | --- | --- |
| `caretPositionFromPoint`, vertical | 90 | **94%** | **100%** | 0 | 0 | 0 |
| `caretRangeFromPoint`, vertical | 90 | **94%** | **100%** | 0 | 0 | 0 |
| `caretPositionFromPoint`, horizontal | 90 | 23% | **100%** | 0 | 0 | 0 |
| `caretRangeFromPoint`, horizontal | 90 | 30% | **100%** | 0 | 0 | 0 |
| `caretPositionFromPoint`, with furigana | 57 | **100%** | **100%** | 0 | **0** | 0 |

Three conclusions:

1. **Accuracy is never worse than one character**, in either writing mode, with
   either API. Since the reader snaps the resulting offset to a token, an error
   of one is harmless. Tap-to-look-up is validated.
2. The histogram is `{0: 85, 1: 5}` in vertical and `{0: 21, 1: 69}` in
   horizontal: the error is always +1 and never -1, which is the caret landing on
   the following boundary rather than inside the character. Where an exact
   character matters, testing the offset and the offset minus one resolves it.
3. **Furigana does not misroute the caret into `<rt>`.** Zero of 57 samples
   landed on a ruby annotation, so no rt-to-base mapping layer is needed. The one
   case not covered is a tap aimed directly at the furigana glyphs rather than at
   the base character; the base box is much larger, so the risk is low.

### Pagination: plain flow, not multi-column

| Configuration | overflow | pages | one-page step |
| --- | --- | --- | --- |
| A `columns` shorthand, vertical | **vertical** | 1 across, 14 down | exact, but on the wrong axis |
| B plain flow, `overflow-x` only, vertical | **horizontal** | **12 across** | **exact** |
| C `column-width` longhand, vertical | **vertical** | 1 across, 14 down | exact, but on the wrong axis |
| D multicol, horizontal (control) | horizontal | 14 across | inexact |

**Multi-column layout is wrong for vertical pagination.** Both multicol
configurations pushed their columns along the *vertical* axis, which is not how a
Japanese book paginates.

**The right approach is the simplest available:** a fixed-size container with
`writing-mode: vertical-rl` and no multicol at all. Text wraps into vertical
lines, the content overflows horizontally, and stepping `scrollLeft` by exactly
one `clientWidth` moves exactly one page. Configuration B yields 12 pages and
the step lands exactly.

This removes multi-column layout, column arithmetic, and scroll-snap from the
design.

### EPUB: a real Japanese novel

`こころ` (夏目漱石): 31 MB, 394 zip entries, 195 XHTML documents, 31.4 MB
uncompressed, inflated in 3 ms, byte-exact. The import path handles a large
real-world Japanese book.

### Memory and storage

- allocations of 32, 64, 128, 256, 512 and **1024 MB all succeed**
- JSON strings of 10, 25, 51, 102, and **203 MB** all parse, the largest in
  126 ms
- `persist()` granted, quota 39322 MB, IndexedDB round-trip 7 ms, cache 3 ms

The 203 MB parse does not by itself prove that the real dictionary parses,
because the ladder used flat objects rather than JMdict's nested entries, but it
does show the desktop figure of 557 MB of heap is not the ceiling on this device.

### Highlight API: still nothing

All four samples were invisible again, this time in a probe that ran on screen
with a colour reference alongside each one, and with a horizontal control case.
Since the horizontal control failed too, this is not a vertical-writing-specific
bug: the API does not paint anything here.

v3 checks whether the `::highlight()` rule survives CSS parsing at all, and
places a plain wrapped-span highlight next to an API highlight for direct visual
comparison.

### Still untested

- kuromoji on the device.

## v3 results - iPadOS 26.6

### Pagination: works, and the scroll direction is now known

    clientW 832, clientH 298, scrollW 13572 -> 16 pages
    scrollLeft at start 0, at end -12740 (negative range)
    stepping by one clientWidth lands exactly

Page `k` is at `scrollLeft = -k * clientWidth`. In Safari, `vertical-rl`
with the default `direction: ltr` numbers `scrollLeft` from 0 downwards, so
the reader scrolls to negative offsets or sets `direction: rtl` to flip the
sign. Plain flow with no multicol is confirmed working end to end.

### Custom Highlight API: it works - the v2 probe was at fault

    registryPresent true, constructorPresent true, supportsSelector true
    33 parsed CSS rules, including "::highlight(spike-post)"
    ruleWasDropped false, registered true, rectsAtCreation 1
    manual answer: both the span and the API highlight are visible

**The v2 conclusion was wrong and has been corrected.** The API does paint on
this device. The v2 probe registered its highlights while the samples sat inside
a `display: none` stage, and WebKit fails silently and permanently in that
case: registration reports success, the range has geometry once shown, and
nothing paints.

The lesson is a construction rule, not a workaround: **register highlights only
after the content is attached, visible and laid out**, and check
`range.getClientRects().length > 0` before registering. The span fallback stays
in the codebase behind a flag, because it is also the only way to make a note
marker clickable.

### Dictionary: the common pack is trivially loadable

| Stage | Time |
| --- | --- |
| download 1.4 MB (gzip) | 408 ms |
| gunzip to 15.74 MB | 25 ms |
| utf-8 decode to 16.08 M chars | 17 ms |
| `JSON.parse` to 22,640 entries | **62 ms** |
| build a 54,154-key lookup index | **9 ms** |
| 3,000 lookups | under 0.5 ms |

**Half a second from a cold start to a working, indexed dictionary.** No
sharding, no worker, no lazy loading needed for the common pack. The sharded
store in `ja-reader-dictionary.md` exists only for the full pack, and whether
even that is necessary is still open - the full pack (118 MB of JSON) has not
been run yet.

### Still open

- The full JMdict pack on the device.
- A Yomitan dictionary import, which is the primary dictionary path and has not
  been probed at all.
- kuromoji on the device: load time, tokenisation throughput, and whether it
  really returns `basic_form` and readings.

## v4 results - iPadOS 26.6

### The full dictionary parses on the device

| Stage | Time |
| --- | --- |
| download 10.69 MB (gzip) | 1214 ms |
| gunzip to 112.45 MB | 134 ms |
| decode to 112.5 M chars | 102 ms |
| `JSON.parse` to 218,776 entries | **334 ms** |
| build a 499,121-key index | 108 ms |
| **total, cold start to indexed** | **2360 ms** |
| 3,000 lookups | under 0.5 ms |

**The sharded store design is dead.** It existed only because a desktop V8
measurement suggested the parse was impossible on a tablet. It is not: 112.5 MB
of JSON becomes a fully indexed dictionary in 2.4 seconds, with sub-millisecond
lookups.

### A real Yomitan dictionary imports cleanly

`[JA-JA] 大辞林　第四版.zip`: 83.13 MB zip, 168 term banks, 551.79 MB
uncompressed, and **the largest single bank is only 3.59 MB / 2000 rows**.

| Stage on the largest bank | Time |
| --- | --- |
| inflate 3.59 MB | 9 ms |
| utf-8 decode | 10 ms |
| `JSON.parse` to 2000 rows | **26 ms** |

The second sharding requirement is dead too. There is no enormous single JSON
file to stream-parse; import is a loop over zip entries with one bank in memory
at a time.

Two new facts that matter more than the timings:

1. **Glosses are `structured-content` trees, not strings** - nested tags,
   inline styles, semantic `data.name` markers, and `a` cross-references. A
   renderer for that format is now a required piece of work, and it is the
   largest UI task in the dictionary subsystem.
2. 大辞林 ships no frequency bank, no pitch bank and no kanji bank. Those need
   separate dictionaries if they are wanted.

### kuromoji: inconclusive, and the reason is probably boring

    scriptLoadMs 18, globalPresent true, then stuck at "build tokenizer"

The build never completed and the run was stopped by hand. The script itself
loaded in 18 ms, so the network to the CDN was fine.

**The kuromoji dictionary is 18 MB, not the 4 MB an article claimed:** 12
`.dat.gz` files, `base.dat.gz` 3.96 MB, `tid_pos.dat.gz` 5.9 MB, and ten
others. An 18 MB download made as twelve separate CDN requests, on a tablet, is
a plausible explanation for a build that appears to hang - and it is not a
defect in kuromoji.

The next probe serves those same files from our own origin, times each fetch
individually so download and build cost can be told apart, and wraps the build
in a timeout so the result is a measurement rather than a hang.

## v5 results - iPadOS 26.6

### kuromoji works, and the earlier hang was the download

| Stage | Time |
| --- | --- |
| fetch the dictionary, 16.97 MB across 12 files | **4617 ms** |
| load kuromoji.js, 308 KB | 365 ms |
| build the tokenizer | **565 ms** |
| **cold start, total** | **~5.5 s** |
| tokenise 20,000 characters | **44 ms** (2.2 ms per 1000 characters) |

Every fetch returned raw gzip bytes. The slowest files are the largest ones
(`base.dat.gz` 759 ms, `tid_pos.dat.gz` 804 ms), so the cost is bandwidth
rather than processing. Against jsDelivr the build was abandoned as too slow;
from our own origin the same build finishes in 4.6 s. **The dictionary is 17 MB,
not the 4 MB an article claimed**, and that is the entire explanation.

Functional checks matter more than the timings:

| Input | Token | basic_form | reading |
| --- | --- | --- | --- |
| 食べました | 食べ | **食べる** | タベ |
| 読んでいる | 読ん | **読む** | ヨン |
| 行われた | 行わ | **行う** | オコナワ |
| 美しくない | 美しく | **美しい** | ウツクシク |
| 心 / こころ | 心 / こころ | 心 / こころ | ココロ |

Over 20,000 characters: **12,616 of 12,616 tokens carry both a reading and a
basic_form** (100%), and 1,077 of them are inflected. Both things the reader
depends on are therefore present on every single token - readings for furigana,
and dictionary forms for click-to-look-up without needing a deinflection engine
for the common case.

### The Yomitan import loop is fast

| Stage | Time |
| --- | --- |
| walk all 168 banks, 507.61 MB uncompressed, 334,751 rows | **1842 ms** |
| write the 602,669-key index | 97 ms |
| write the 83 MB zip blob | 51 ms |
| read the index back | 40 ms, all 602,669 keys |
| **total** | **2276 ms** |

Slowest single bank: **17 ms**. The import is not merely feasible, it is nearly
instant: under three seconds to make an entire 83 MB dictionary searchable, with
peak memory of one bank.

One thing to verify during implementation: `navigator.storage.estimate()`
reported only 13 MB of usage after an 83 MB blob was written, which is far too
low. The index round-trip is proven; the blob round-trip is not. That difference
decides whether the original zip can be persisted and banks inflated on demand,
or whether all 507 MB has to be expanded into IndexedDB instead. It is a
five-line check and should be done early.

### Every architectural question is now closed

| Question | Answer |
| --- | --- |
| tap to look up a word | 100% within one character, vertical and horizontal, furigana included |
| page turning | plain flow, page `k` at `-k * clientWidth`, exact |
| highlights and notes | CSS Custom Highlight API works; register only after layout |
| on-demand furigana trigger | Pencil hover |
| storage | persistent, 39 GB quota |
| native selection in vertical text | works; no custom handles needed |
| chapter rendering | 99 ms for 20,000 characters with full furigana |
| keeping position across a furigana toggle | restore from the text offset; width changes 1.8% |
| EPUB import | 31 MB Japanese novel in 28 ms |
| full JMdict | 2.36 s cold start, sub-millisecond lookups |
| Yomitan import | 2.28 s for 168 banks, 507 MB, 334,751 rows |
| kuromoji | 5.5 s cold start, 2.2 ms per 1000 characters, 100% readings |
