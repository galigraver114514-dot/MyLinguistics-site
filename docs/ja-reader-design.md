# Japanese Reader - feasibility and design

Status: **draft for discussion**. Nothing here is implemented yet.

Status: design approved, implementation not started.

## Decisions

| Question | Decision |
| --- | --- |
| Primary device | **iPad**, iPadOS **26.6**. Desktop is secondary. |
| Input format | **EPUB only.** PDF is deferred indefinitely; see section 10. |
| Furigana | source ruby when present; generated furigana with selectable policies |
| Dictionary | bundled JMdict as fallback, **plus local Yomitan import as the primary source** |
| Dictionary language | **JP-JP (monolingual) required**, not English glosses |
| Offline | **explicit download-everything mode** with storage management |
| Names (JMnedict) | **manual opt-in pack**, off by default |
| Pitch accent | deferred until a clean data source is confirmed |

Two companion documents carry the detail:

- `ja-reader-dictionary.md` - the dictionary subsystem, with sizes measured
  against the real JMdict.
- `ja-reader-ios-interaction.md` - how the reader is operated on an iPad, and
  the list of device behaviours that must be spiked before the features that
  depend on them are built.

## 1. Goal

Read Japanese long-form text (novels, essays) inside MyLinguistics, with reading
aids tuned for a learner above N1 who is working toward native-level reading:

- EPUB (and, later, PDF) import from local files
- furigana on demand, or filtered rather than blanket
- one-click dictionary lookup
- vertical and horizontal typesetting
- font size / line height / theme control
- bookmarks, highlights, and notes that survive reflow

## 2. Constraints we cannot change

| Constraint | Consequence |
| --- | --- |
| GitHub Pages, static only, no backend | every byte of parsing, tokenizing, and lookup happens in the browser |
| GitHub Pages cannot set custom HTTP headers | no COOP/COEP, therefore **no SharedArrayBuffer**, therefore no multithreaded WASM. A service-worker header shim exists but is fragile; assume single-threaded. |
| Git repositories reject very large single files (roughly 50 MB warns, 100 MB refuses) and the published site has a 1 GB soft limit | dictionary binaries must not live in the Pages repository |
| The site mirrors to a public repo on every push | adding a 30 MB binary puts it in public git history permanently |
| No build step today | the reader will need bundling and real dependencies |

Also to verify in a spike: whether GitHub Pages serves `.wasm` with the correct
`application/wasm` MIME type, and whether it honours HTTP Range requests for a
multi-megabyte dictionary blob. jsDelivr does both; GitHub Pages may not.

## 3. Difficulty summary

| Area | Difficulty | Why |
| --- | --- | --- |
| Text model / offset anchoring | Medium | foundational; get it wrong and every feature breaks |
| EPUB parsing + render | Medium | ZIP + OPF + spine is easy; publisher CSS fidelity is the time sink |
| Horizontal reading, font size, theme | Easy | CSS only |
| Vertical typesetting | Medium | `writing-mode: vertical-rl` is native; pagination and scroll math are fiddly |
| Source ruby rendering | Easy | native `<ruby>` |
| Generated furigana | **Hard** | tokenizer readings are wrong often enough to annoy this user |
| Dictionary data pipeline | **Hard** | 200k entries, static host, no server, memory budget |
| Click-to-lookup + deinflection | Hard | solved problem, portable rule tables, but real work |
| Highlights / notes / bookmarks | Medium | CSS Custom Highlight API works, but registration timing is a silent footgun |
| Persistence | Medium | IndexedDB, plus export/import |
| PDF (text layer) | **Very hard** | vertical extraction order is unreliable |
| PDF (scanned, OCR) | **Very hard, low quality** | several seconds/page, mediocre accuracy, no ruby |

## 4. Core architecture: a text model, not a DOM model

The single most important decision.

For each spine document (chapter), build once:

    ChapterModel {
      baseText: string                 // text content, ruby stripped to its base
      segments: [{ start, end, node, nodeStart }]   // baseText offset -> DOM text node
      ruby:     [{ start, end, reading, authored }] // where source ruby existed
      tokens:   [{ start, end, surface, lemma, reading, pos }]  // lazily computed
    }

Every annotation — bookmark, highlight, note — is stored as
`{ spineIndex, startOffset, endOffset }` into `baseText`, never as pixels and
never as DOM paths.

Why this matters:

- Toggling furigana must not move a single highlight.
- Changing font size, line height, or writing mode must not invalidate anything.
- Highlights must be able to span element boundaries (the classic reason naive
  implementations break).
- Re-tokenising or improving the dictionary must not disturb saved annotations.

Consequence: furigana is rendered as a **decoration layer** over `baseText`
(either native `<ruby>` built from the model, or CSS-only ruby positioning),
never as the source of truth for text positions.

## 5. EPUB

An EPUB is a ZIP containing `META-INF/container.xml`, an OPF package
(`manifest`, `spine`, `metadata`), XHTML content documents, CSS, and images.

Unzip in-browser with `fflate` (small, fast) rather than JSZip.

Renderer options:

| Option | Verdict |
| --- | --- |
| `epub.js` | mature-ish API and CFI support, but heavy, iframe-centric, weak vertical-writing story, and effectively unmaintained |
| Readium ts-toolkit | actively maintained, large, oriented to full app architectures, no Japanese vertical layout |
| **custom renderer** | recommended: parse OPF, render spine items ourselves, own the text model, own the typography |

For a personal reader, imposing **our own typography** and ignoring most
publisher CSS is what makes this tractable and gives a consistent look across
books. We keep: spine order, `page-progression-direction`, document structure,
images, and authored ruby.

## 6. Vertical typesetting

- `writing-mode: vertical-rl` plus `text-orientation: mixed` is well
  supported across current Chrome, Safari, and Firefox.
- Ruby in vertical mode is placed to the right of the base characters **by the
  browser**, natively, with correct sizing. This is a large win: no manual
  furigana layout engine.
- Scrolling becomes horizontal, and the origin is the top-right corner, so scroll
  position and progress calculations need care (`direction: rtl` on the
  scroller, or explicit `scrollLeft` arithmetic).
- **Page turning uses plain flow, not multi-column.** Measured on the device:
  in vertical writing mode, multi-column pushes its columns along the *vertical*
  axis, which is not how a Japanese book paginates. Instead, a fixed-size
  container with `writing-mode: vertical-rl` and no multicol lets text wrap into
  vertical lines and overflow horizontally; stepping `scrollLeft` by exactly one
  `clientWidth` moves exactly one page and lands exactly. See
  `ja-reader-spike.md`.
- Kinsoku (禁則処理): `line-break: strict` covers most 行頭禁則 / 行末禁則.
  Known gaps remain around ー and 〜 at line start; acceptable for v1.
- 縦中横: digits and Latin run sideways by default. `text-combine-upright: all`
  (or `digits`) fixes short runs, but the numbers may need wrapping in a span.
- Images in vertical books may need rotation.

## 7. Furigana

Three sources, all supported by the same rendering path.

### (a) Authored ruby in the source — Easy

青空文庫 notation is `｜base《reading》` (and `《》` directly after a kanji
run); Aozora-derived EPUBs and many commercial EPUBs carry real `<ruby>`
markup. Use it as ground truth. Render natively.

### (b) Generated ruby — Hard

Pipeline: tokenise -> read each token -> align kanji runs against the reading ->
emit ruby.

- Tokeniser: `kuromoji.js` (IPADIC, pure JS, ~15 MB dictionary, 1-3 s load) is
  the pragmatic choice; run it in a Web Worker so the UI never blocks.
  Sudachi via WASM is more accurate but its dictionary is far larger.
- Readings come back in katakana; convert to hiragana.
- **Alignment** is the subtle part. Token 食べる reads タベル, so the ruby must
  be `食[た]べる`, not `食[たべる]る`. Standard approach: match the leading
  and trailing kana of the surface against the reading, then distribute the
  remainder across the kanji run. 熟字訓 (今日/きょう, 大人/おとな) needs
  special handling. The Yomitan ecosystem has `japanese-furigana-normalize`
  for exactly this normalisation and is reusable.

**Accuracy reality check.** Tokeniser readings fail often enough on literature
to be a genuine annoyance at this level. Failure classes: proper nouns, heteronyms
(生物, 一日, 市場, 風), 熟字訓, literary ateji, and archaic kana usage in older
texts. Mitigations:

1. a personal exception dictionary the user grows over time,
2. per-book corrections that apply to every occurrence,
3. never treat generated ruby as authoritative — always visually distinguishable
   from authored ruby.

### (c) Annotation policy — the highest-value idea here

For a reader above N1, blanket furigana is noise and arguably harmful: it trains
the eye to read the ruby instead of the kanji. Policies worth having:

| Policy | Description |
| --- | --- |
| Off | pure text |
| **On demand** | furigana appears for the word under the cursor / on tap |
| **Non-jōyō only** | annotate only kanji outside 常用漢字, or outside a frequency band |
| **Unknown only** | annotate only words not yet mastered in the MyLinguistics SRS |
| Names only | annotate 人名 / 地名 only |
| Full | everything |

`Unknown only` is the differentiator: it links the reader to the existing
trainer. A word studied to box 5 loses its ruby permanently; a word you keep
forgetting keeps its ruby. That is a genuinely better reading aid than a static
toggle, and it is the main reason to build this inside MyLinguistics rather than
using an off-the-shelf extension.

## 8. Dictionary

The full specification, with sizes measured against the real JMdict, lives in
`ja-reader-dictionary.md`. Summary: the complete dictionary is 118 MB of JSON,
and a sharded store (256 key shards plus 256 entry shards, fetched on demand)
keeps the memory footprint flat. That design rested on a desktop measurement of
557 MB of heap for a full parse - but the iPad has since been measured doing a
1 GB allocation and a 203 MB JSON parse without trouble, so **whether the
sharding is needed at all is now an open question**, which v3 of the spike
answers by parsing the real packs on the device.

### Data

- **JMdict** - the canonical JP-EN dictionary, roughly 200k entries. Licence:
  Creative Commons BY-SA 4.0 (EDRDG), safe to redistribute with attribution.
- **JMnedict** - proper names. Important for literature.
- **KANJIDIC2** - kanji detail.
- **Yomitan / Yomichan dictionary format** - the de-facto ecosystem format: a ZIP
  containing `index.json`, `term_bank_N.json`, `kanji_bank_N.json`,
  `term_meta_bank_N.json` (frequency, pitch accent), and `tag_bank_N.json`.
  Supporting this import format immediately gives access to JMdict, JPDB and
  BCCWJ frequency data, pitch accent data, and any 国語辞典 the user already owns.

**Licensing split, and it matters:** third-party Yomitan dictionaries of
copyrighted works (新明解, 大辞泉, 三省堂 and similar) circulate unofficially and
must **not** be bundled on a public site. Bundle only EDRDG data (CC BY-SA);
let the user import everything else locally into IndexedDB, where it stays on
their machine. This is both the legal and the clean architectural split.

### Storage and performance on a static host

Loading JMdict as ordinary parsed JSON costs hundreds of megabytes of heap.
Instead, convert once at build time into a compact binary:

- a sorted term index with a prefix bucket table (a few MB, kept in memory)
- a UTF-8 definition blob (`Uint8Array`) fetched on demand by offset
- storage in IndexedDB, loaded lazily in the background

Realistic budget: compacted term + definition data ~15-30 MB compressed, hot
index ~3-8 MB. Host the binary outside the Pages repository (separate data repo
behind jsDelivr, which gives CORS, brotli, and a global CDN) so the site repo
stays small and the deploy mirror does not accumulate large blobs forever.

### Lookup mechanics

- **Click to word**: caret offset in `baseText` -> the token covering it -> lookup.
  This is why tokenisation and the text model belong together.
- **Arbitrary selection**: longest-match scan from the click point, dictionary
  form first, then inflected forms.
- **Deinflection (活用)**: text contains 食べました, 読んでいた,
  食べさせられた; dictionaries contain 辞書形. A suffix-stripping rule table
  (Yomitan's `deinflect.json` is portable and small) generates candidate
  lemmas. Bounded, well-understood, but real work.
- **Result card**: readings, senses, part of speech, frequency badge, and pitch
  accent. Pitch accent is a strong feature for someone heading toward native
  level and comes free from the Yomitan meta banks.

## 9. Highlights, notes, bookmarks

- **Anchor**: `{ spineIndex, start, end }` into `baseText`, plus a text
  snippet and a little surrounding context for validation.
- **Render: the CSS Custom Highlight API** (`CSS.highlights`, `Highlight`,
  `Range`). It works on the target device, and it paints ranges without
  modifying the DOM, so offsets stay valid and ranges may cross element
  boundaries.
  - **The one footgun, which cost three spike rounds to find:** registering a
    highlight for a range whose subtree has no layout boxes - a `display: none`
    container, for instance - fails **silently and permanently**. The JS API
    reports success, the range has geometry, and nothing ever paints.
  - So: register highlights only after the content is attached, visible and laid
    out, inside a `requestAnimationFrame`, and assert
    `range.getClientRects().length > 0` first.
  - Keep the span-wrapping fallback (split the text nodes, wrap each run in a
    `<span>`) behind a flag. It is about a hundred lines, and it is also the
    thing that makes a note marker clickable, because the API produces no
    element.
  - Note markers are positioned from `Range.getBoundingClientRect()`.
- **Notes**: attached to the same range, shown as a marker positioned from the
  range's bounding box, plus a side panel. In vertical mode the gutter is on the
  left, which is a pleasing detail to get right.
- **Bookmarks**: `{ spineIndex, offset, label, createdAt }`, a resume button,
  and a per-book list.
- **Persistence**: **IndexedDB**, not localStorage (5 MB is nowhere near enough
  for annotations plus dictionary caches). Stores: books, annotations, optional
  token cache (evictable, regenerable), imported dictionaries.
- **Export / import**: follow the existing JSON export pattern so nothing is
  trapped in one browser profile.

## 10. PDF - the honest assessment

Three cases with very different difficulty.

1. **Text PDF, correct extraction order.** Read it in the same reader UI using
   PDF.js text extraction. Works, but is uncommon for vertical Japanese.
2. **Text PDF, vertical layout.** Glyph positions are correct but logical order
   usually is not; extraction tends to return visual order, sometimes reversed,
   sometimes one character per line. Recovering reading order needs column
   detection from glyph transforms. Feasible, never 100 percent.
3. **Scanned PDF.** Requires OCR. `Tesseract.js` does ship a vertical Japanese
   model (`tesseract.js-data/jpn_vert`), but expect several seconds per page in
   WASM, mediocre accuracy on literary vertical text, no ruby, and compounding
   errors for a lookup workflow. This is a rough text layer, not a reading aid.

PDF.js alone is roughly 1.5 MB or more. **Recommendation: defer PDF. Ship EPUB
plus plain text first, and for PDFs the cheapest good answer is usually to
convert offline (Calibre, or `pdftotext`) and import the result.** A genuinely
good vertical PDF reader is a project of its own.

## 11. Before building: the honest alternative

Yomitan (the maintained successor to Yomichan) already does dictionary lookup,
furigana, frequency, pitch accent, and Anki export, extremely well, as a browser
extension on desktop. Anyone considering this feature should ask why not to use
it.

Honest answers, in order of strength:

1. **iOS and iPadOS Safari do not offer that extension ecosystem.** A web-based
   reader is the only way to get lookup plus furigana on an iPad, which is the
   natural device for vertical Japanese reading.
2. **Integration with the existing MyLinguistics SRS.** One click to add a word
   from the page you are reading into the deck you already review, and ruby that
   disappears as words graduate. No extension can do that with our data.
3. Ownership and control of typography and data, with no extension install.

If those do not matter, adopting Yomitan and spending the effort on the SRS side
instead is the rational choice. Worth deciding explicitly rather than by default.

## 12. Build tooling

The site is currently no-build, dependency-free, and deployed by an rsync mirror
workflow. The reader realistically wants ES modules and several dependencies.

| Option | Trade-off |
| --- | --- |
| Vendor prebuilt ESM bundles | deploy pipeline unchanged; manual dependency updates |
| Add a build step (Vite) to the existing workflow | clean authoring, TypeScript possible; the workflow already runs npm-capable runners, so it is a small change |

Recommendation: introduce Vite for the reader once it exceeds a few files, and
have the deploy workflow run the build before mirroring. Keep the existing
vocabulary and SRS pages as they are.

## 13. Proposed phasing

| Phase | Contents | Notes |
| --- | --- | --- |
| 1 | EPUB import, text model, horizontal + vertical, font size, theme, resume position, authored ruby | no dictionary; usable on its own |
| 2 | JMdict pipeline, click-to-lookup, deinflection, frequency and pitch accent, Yomitan ZIP import | the largest single chunk of work |
| 3 | Generated furigana, annotation policies, personal correction dictionary, add-to-deck | the differentiating phase |
| 4 | Highlights, notes, bookmarks, side panel, export/import | mostly UI on a solved foundation |
| 5 | Bundled 青空文庫 starter library (public domain), offline caching, sync | |
| 6 | PDF | separate decision; likely defer or skip |

## 14. Open decisions

1. **PDF scope.** Are the PDFs text-based or scans, and how central is PDF next
   to EPUB? This is the biggest single scope lever.
2. **Source files.** DRM-free files you own, or DRM-protected purchases? DRM
   would block the whole feature.
3. **Furigana policy.** On demand, non-jōyō only, unknown-only, or full? I would
   default to on-demand plus non-jōyō, with unknown-only as the differentiator.
4. **Dictionary data.** OK to bundle EDRDG data (CC BY-SA, attribution required)
   and import Yomitan ZIPs locally? Do you already own Yomitan dictionaries?
5. **Devices.** Desktop only, or iPad and iPhone as well? Vertical reading on an
   iPad is the natural target, and Safari has some highlight-API rough edges.
6. **Build tooling.** OK to add a bundler and a build step to the deploy workflow?
7. **Default direction.** Default Japanese books to vertical, following the
   EPUB `page-progression-direction`.
8. **Starter library.** Bundle a small public-domain 青空文庫 selection so there
   is something to read on day one?
9. **Notes scope.** Range notes only, or also whole-book notes and an index-card
   style review surface?
10. **Priority.** Is an EPUB-only Phase 1, without dictionary lookup, acceptable
    as the first usable milestone?
