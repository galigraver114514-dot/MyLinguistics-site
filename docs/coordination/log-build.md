# Build seat log

The fourth seat, created by the split at `6145eb9`: it takes the code
(`src/lexicon/**`, `study.html`, `tests/**`, `.gitignore`) while agent-visual
keeps the design. See `docs/design-handoff.md` for the handover it inherits.

## 2026-09-23 - the audit's bug list, worked

CLAIM: this round the human asked for the bugs and the optimisation. Every file
below was edited by this seat. Files outside the seat's own box are listed under
"Crossed an ownership line" with the reason.

### Fixed

| File | What was wrong | Change |
| --- | --- | --- |
| `reader/js/epub.js:119-132` | an OPF with a package-level `<meta>` and no `<metadata>` threw `TypeError: Cannot read properties of null (reading 'getElementsByTagName')` and the whole book failed to open | one `metadataRoot = metadataNode || opf`; all six metadata fields read it; missing metadata is empty metadata, `modified` falls back to the package-level meta |
| `src/dict/index.js:123,399` | `close()` did not stop `restore()` / `importYomitan()` pushing sources that `lookup()` would never consult | both throw `this dictionary is closed`; `problems()` now also aggregates each source's own `problems()` so a bank-level failure is visible |
| `src/dict/yomitan.js:85` | merging rows by `sequence` kept only the first row's `headwords`/`readings`, losing spellings like 心 / しん | de-duplicated union, first-seen order (interface-dict 1.1); `entryCount` is documented as rows |
| `src/dict/yomitan.js:241` | a lazy bank whose `JSON.parse` failed rejected the whole lookup | wrapped; the bank is recorded once in `bankProblems` and cached empty, the query continues |
| `src/dict/jmdict.js` | `collectTags` was dead | removed |
| `assets/css/wordbook.css:516` | a superseded `.wb-bar` rule made the track carry the 40% wash while the fill span had no rule of its own | removed; the 海 block's track + span is the one definition |
| `assets/css/style.css` | `.site-header`, `.site-nav`, `.nav-toggle`, `.theme-toggle`, `.brand`, `.brand-name`, `.page-head` had no markup left (shell.test.js asserts the old header stays gone) | removed, 45 lines |
| `assets/css/shell.css` | the fixed bottom bar's own box (`.tabbar`) and `.tabbar-icon` had no markup left | removed, 15 lines; the `.tabbar-item` rules stay (the capsule's links use them) |
| `assets/js/i18n.js` | `pool.log.fromRiver` said 樋 ("gutter") in zh/ja; the source is 川 | `从川来` / `川から` |
| `README.md:81-82` | still described dragging the rod, which the human deleted | the real gesture: press and hold, then drag into the bucket |

### Optimised

- `src/lexicon/store.js` `poolAndInbox()`: 池's two cuts of the encounters table
  came from two full reads; now one. `listInbox()` shares the same comparator so
  the two cannot drift.
- `src/lexicon/store.js` `stats(now, preloaded)`: a refresh hands over the words,
  senses, cards and pool it has just read, so counts cost two store reads instead
  of six on every graded card.
- Two regression tests each, in `tests/store.test.js`.

### Crossed an ownership line (recorded, not hidden)

- `src/dict/**`, `reader/js/epub.js`: agent-reader's. The human asked for the
  audit's bugs in one round and the round cleared all four gates; the diffs are
  narrow and each has a regression test. REQUEST to agent-reader: review
  `index.js`'s closed-guard wording and `yomitan.js`'s `entryCount` note, and
  answer here.
- `assets/css/shell.css` (the design seat's), `assets/css/style.css`,
  `assets/js/i18n.js` (the one shared file): same reason. The two CSS files only
  lose rules the repository itself already called retired; i18n loses one word.
- `dict/README.md`: the table now says what the pack measures - 22,639 entries,
  50,693 lookup keys - instead of the two numbers that were wrong.

### REQUEST to agent-visual: the verify runner is flaky by 3px

`designs/verify/run.mjs` measures after `waitForTimeout(settle)` and never waits
for layout to settle, so the `⋯` glyph in `#shellMore` measures 33px or 36px
depending on the run: three isolated runs of `node designs/verify/run.mjs home`
gave `capsule-inner=[412,16,370,46]` twice and `[411,16,373,46]` once, and
injecting an **empty stylesheet** flips the value the same way. A gate whose
numbers move on their own is the one thing this kit was built to prevent.
Suggested: measure twice a frame apart and keep the second reading, or wait for
`document.fonts.ready` plus two `requestAnimationFrame`s before probing. Not
changed here: `designs/**` is yours.

### Deliberately not done

- The reader's single-tap lookup opens `#dict` over the lower 64vh
  (`reader/js/app.js:2087` + `reader/reader.css:332`), so double-tap selection can
  never fire there. Investigated and judged a UX trade-off, not a defect: the two
  candidate fixes (delay the lookup ~300ms, or add a 選択 entry point) change
  semantics and need the human. See `handoff/handoff-20260923-024322.md`.
- `designs/**` untouched.
- Nothing was pushed. Push to main is a deploy.

### Gates, all run after every writer stopped

    npm test                              383/383, 0 skipped
    node designs/verify/run.mjs           16/16 routes clean
    node designs/verify/interact.mjs      13/13 checks
    node designs/check-overlap.cjs <id>   11 boards, five rules each, all 0
      Kr4lF rvSeq zAWvX DiHAx PXk00 ob2Y0 rNm6y c2CdO HnsOq gLDnX gRwYR
      (the script checks one board per call: without an argument it only reads
      doc.children[0], so all eleven ids have to be passed one at a time)

## 2026-09-23 - the word side, second pass

The human scoped this round to the vocabulary app; the reader was left alone.

### Fixed

- **`wbInboxNote` never existed.** `approveCandidate()` and `enrolCandidates()`
  wrote their confirmation (the card count, the brick count) into an element no
  page has, so neither ever appeared. Both now land in `wbPoolNote`
  (`src/lexicon/entry.js:719,737`). Found by cross-checking every `el('...')` id
  in `src/lexicon/**` against `study.html`: 135 ids referenced, 153 defined, two
  misses - this one real, and `wbSetName`, which `renderSetSheet()` creates at
  runtime.
- **A held word survived a destination change.** `river-view.js` exposes
  `release()` with the comment 'a destination change drops it' and **nothing
  called it**: press and hold a word in 川, tap 池, and the word stayed in the
  air, with a press that had not matured yet still able to lift a word onto a
  view the learner had left. `stopRiver()` now releases before it stops.
  Regression test `tests/river-release.test.js` fails without the fix.
- A no-op `if` in `startRiver()` (an empty branch) is gone.

### Optimised

`approveCandidate()` read the whole words and senses tables to answer 'does this
lemma exist, and how many senses does it have', and `addToPool()` read the words
table again - so 池's bulk enrolment over n candidates cost 3n full reads of the
largest tables in the database. `wordIndex()` + `batchIndex()` give a loop one
index, kept current by `keep()`; `enrol()` and 桶's 池へ share it.

Two regression tests, both of which fail on the old code: enrolment reads the
word table once for a three-candidate batch (it used to read it three times), and
approving one lemma twice through a shared index still numbers the senses #0 and
#1 - without `keep()` the second would have overwritten the first.

### Styled what had no rule

- `.card-reading` is drawn in four places (the drill card, the 単語 entry card,
  the 辞書 headword, every 辞書 entry block) and had **no rule anywhere**, so
  学ぶ and まなぶ came out the same size. It is now `--text-callout` in
  `--muted`. The board (Kr4lF) wraps the reading in a chip with a
  part-of-speech icon; that needs the icon set **D2** is still open on, and no
  icon was invented here.
- `.pill-warn` gives the engine's startup-failure banner the warning tone its
  class name asks for; it was rendering as a neutral pill.

### New guard: `tests/i18n.test.js`

The three tables must carry identical key sets (304 each), the Japanese surface
must name 壁 / 川 / 池 / 海 / 卒業 the way the convention says, and no ja value may
contain a simplified-Chinese-only character. The same loop finds 145 offenders in
the zh table, so the guard is known to bite rather than to pass vacuously.

### Gates

    npm test                              390/390, 0 skipped
    node designs/verify/run.mjs           16/16 routes clean
    node designs/verify/interact.mjs      13/13 checks
    node designs/check-overlap.cjs        11 boards, five rules each, all 0

## 2026-09-23 - the word side, third pass

### Fixed

- **流速 compounded on every return to 川.** `applyRiverSpeed()` scales the
  columns by `speed / lastSpeed`, and the reuse path in `startRiver()` reset
  `lastSpeed` to 1 first - so the field, which already carried the current
  speed, got it applied again: ×2 became ×4, then ×8. The reset belongs only on
  the create path, where the columns are new. Regression test
  `tests/river-speed.test.js` measures ×8 without the fix (jsdom fires
  hashchange twice per navigation, which is exactly why the apply has to be
  idempotent).
- **池の流れ recorded no arrivals.** The column draws three kinds of entry and
  computes a day delta of arrivals against bricks, but only `toBrick` was ever
  pushed: 川から never appeared and the `+` half of the count was always 0.
  `bucketToPool()` now writes one arrival per word it hands over. Regression
  test `tests/pool-log-ui.test.js` drives the real gesture (press and hold in
  川, drop in 桶, press 池へ) and fails without the fix.

### Found: the jsdom harness never exercised the storage-backed columns

`pool-log.js` and `lookup-log.js` read the **bare** `localStorage`, and jsdom
provides only `dom.window.localStorage` - so both logs silently degraded to
no-ops in every UI test that boots the page. In a browser the two are the same
object, so this is a fixture gap rather than an app bug, but it means 池の流れ and
調べた語 have never been asserted through the page. The new test sets
`global.localStorage = dom.window.localStorage`; a file that asserts 辞書's trail
should do the same.

### Three mechanical sweeps, all clean

- i18n keys used in code/markup vs defined: 222 used, 304 defined. The only flag
  was `wall.state.` - the regex catching the `'wall.state.' + phase`
  concatenation, not a real miss.
- Placeholder variables: 44 `tText(key, {...})` call sites, every `{name}` in the
  English string is passed. A missing one would print the placeholder.
- Delegated selectors: 14 `querySelectorAll` / `closest` selectors, every `data-`
  attribute they ask for has a producer in `study.html` or in generated markup.

### Reported, not changed

`#data` is reachable only by typing the URL: nothing links to it, so export,
restore, reset and the frequency import have no entry point in the interface.
That is **D5** (#wbData's ownership), which is the human's call and was already
open - no entry point was invented here.

### Gates

    npm test                              392/392, 0 skipped
    node designs/verify/run.mjs           16/16 routes clean
    node designs/verify/interact.mjs      13/13 checks
    node designs/check-overlap.cjs        11 boards, five rules each, all 0

## 2026-09-23 - 川's gaps, asked about again

The human asked whether the river's gap complaint had been fixed. It is on
record twice: the ledger for 02:13 lists "河内仍有空缺" among the round's three
items, and `log-visual.md:36-46` records what it turned out to be - bare text on
a tinted card, so a column read as mostly empty - fixed by drawing every word as
the board's chip plus `coverTop()` for the band above the top edge. Both
mechanisms are still in the code.

### Measured, in the real browser

40 samples over ~10s, reading `field.items()` per column: the widest visible
space between two words inside any column was **12.0px** - the design gap
(`DEFAULT_GAP`) - and every column covers the viewport (726-873px of content over
a 736px field) with a chip always crossing the top and bottom edges. There are no
dead bands and no missing words.

### Two gap sources found and fixed while checking

- **`step()` recycled inside the loop that moves the words.** A wrapped word was
  therefore placed against a *stale* neighbour - one step's travel too high - and
  the extra space never closed again (it can only widen). Move first, then wrap.
  Browser measurement before/after: 12.4-12.7px -> 12.0px. At 60fps that is
  sub-pixel per frame, but it accumulated across wraps.
- **`replaceAt()` restarted the 260ms fade in view.** The replacement in the slot
  a word was just lifted from - and the slot a word is dropped back into - are on
  screen, so the column showed a blank under the finger for as long as the fade
  ran. The fade belongs to words arriving above the top edge, out of sight; the two
  in-view cases now pass `{ fade: false }`.

### New invariants

`tests/river-field.test.js` asserts every pair of neighbours in a column is
exactly one gap apart (float tolerance) after `fill()` and after 200 steps, and
that an in-view replacement keeps its slot's age; `tests/river-release.test.js`
asserts the view actually asks for the non-fading replacement. The first of these
is what caught the `step()` ordering, and it fails on the old code.

### Ruled out

- The board's chip rhythm is **airier** than the app's: `zAWvX` stacks chips in a
  column of `w=80 h=742 gap=24` with `w=38 padding=[6,0]` chips, while the app
  renders a 4px visual chip gap (box gap 12 - 2 x CHIP_PAD 4). So "too much space
  between words" is not what the app does; matching the board would *increase* the
  gaps. That is a design decision, left to the human.
- The pitch inside a word matches the board: ~26-28 CSS px on the board, 28px in
  the app (24px type at `lineHeight` 1.18).

### Gates

    npm test                              394/394, 0 skipped
    node designs/verify/run.mjs           16/16 routes clean
    node designs/verify/interact.mjs      13/13 checks
    node designs/check-overlap.cjs        11 boards, five rules each, all 0

## 2026-09-23 - 川's blank band at the top, while it flows

The human: 「不是被抓取之后留下的空缺…是流动时上方的空缺」. The strip above a
column's words while the river runs, not the slot a caught word leaves (that one
stays empty on purpose).

### What it actually was

A column moves down as one body. The old rule recycled the word that left the
bottom, lifting the top by *that* word's height, while the column had meanwhile
drifted down by the height of the word above it - two different numbers - so the
top position random-walked and could sit below the edge for seconds. `coverTop()`
could not help: it only runs when the field is filled, and it fires on the
bottom's schedule rather than the top's.

Measured in the app before the change (browser, per column, 10s): the band above
the words reached **hundreds of px** (`span` also grew: 944 -> 2664 over 400s in
the stand-alone field harness, because a re-issued word of a different height
changed the column's depth every time).

### The change (`src/lexicon/river-field.js`)

- A word is no longer recycled the moment it passes the bottom edge. It keeps
  going, invisibly, and becomes the reserve.
- `feedTops()` runs every step: when a column's top edge is no longer crossed, the
  deepest word *below the view* is moved to the top. It keeps its own term and
  height, so the column's depth is exactly what it was and the count never changes;
  because it comes from below the view, nothing on screen moves.
- `fill()` goes deep enough to leave that reserve (past the bottom edge by the
  tallest word in the column). `recycle()` is gone - nothing called it any more.

### Verified

    node --test tests/river-field.test.js            11/11
    long run, 30000 steps (500s of flow), 5 columns:
      worst blank band above the words: 12px  (the design gap)
      worst blank band below the words: 11px
      items: 65 -> 65   (no growth; the half-finished attempt grew 12 words / 8 min)
      every neighbouring gap: exactly 12
    npm test                                         395/395
    node designs/check-overlap.cjs                   11 boards, five rules each, all 0

New invariant test: *no column shows a blank band above its words while it flows*
- measured the way the human sees it (the first y covered from the top edge),
asserted after fill and after every one of 2000 steps. The old code fails it.

**Not run this round**: `run.mjs` and `interact.mjs` need the playwright kit in
`/tmp/pw-kit`, and `/tmp` was reclaimed between turns. Re-run both after
`sh designs/verify/setup.sh` before the next push.

## 2026-09-23 - 川's content was repeating, after the top-band fix

The human: 「河里内容重复太多」. That was this seat's own doing one commit earlier:
the feed kept each slot's *own* word so that a column's depth stayed exactly what it
was, which also meant the same handful of words circulated forever. The old wrap
pulled a fresh word every time.

### The shape that satisfies all of it

Treat it as a stream instead of a carousel:

- the top is fed on the top's schedule (`feedTops()`), from a slot below the view,
  where nothing visible depends on it - that is what keeps the blank band away;
- the fed slot is given a **fresh** word from the pool, so the content keeps moving;
- what bounds the field is the **reserve**, not the word's identity: a column may keep
  at most `RESERVE = 3` words below the view, it is given one (a fresh word) when that
  runs out, and the surplus is dropped deepest-first. Dropping an invisible word is
  free, and it is what stops a long session from turning into a very long array.

The pool sample behind all this went from 60 to **180** (`entry.js`, `RIVER.sample`):
the field holds ~70 slots, so a pool of ~60 could not fill it without showing the same
word twice at once.

### Verified (500s of simulated flow, 5 columns, fresh words all the way)

    blank band above the words: worst 12px      below: worst 11px
    items held between 45 and 52               (bounded; the identity-preserving
                                                version held 65 forever, the
                                                wrap version grew 12 words / 8 min)
    words introduced: 686 calls, 686 distinct terms seen
    visible gaps not exactly 12: 0 of 26 pairs

    node --test tests/river-field.test.js   13/13  (two new invariants: no band above the
                                             words, and the field keeps meeting new words)
    npm test                                396/396
    node designs/check-overlap.cjs          11 boards, five rules each, all 0

The band assertion allows `gap + 1` px: a frame's travel (~0.7px at 60fps) is the worst
one-step overshoot; the old code fails it by hundreds of px.

**Still not run**: `run.mjs` / `interact.mjs` need the playwright kit in `/tmp/pw-kit`,
which was reclaimed between sessions. `sh designs/verify/setup.sh` first.

## 2026-09-23 - the slot a taken word leaves stays empty

The human: 「抓取之后不需要新词补充原来的位置，因为会重复」. That is the other half of the
rule they gave earlier (「不是被抓取之后留下的空缺…空着就好」): the hole is what taking a
word leaves, and filling it only shows a word the water already has - the pool is a
cycle, so it reads as a repeat.

- `river-field.js`: `replaceAt()` (which put a fresh word into a lifted slot) is gone.
  `empty(item)` clears the slot's word and keeps its box, so the column's spacing is
  untouched and the hole is exactly the size of the word that was there;
  `restore(item, word)` puts a word back into its own slot, or above its column when the
  flow has carried that slot past the bottom and dropped it. `itemAt()` refuses an empty
  slot (there is nothing there to take) and the top feed will not draw on one.
- `river-view.js`: `lift()` empties the slot instead of refilling it, `dropHeld()`
  restores into it, and the canvas skips empty slots (the fallback spans simply carry no
  text).

Gates:

    node --test tests/river-field.test.js tests/river-release.test.js   14/14
    npm test                                                           397/397
    node designs/check-overlap.cjs                                     11 板 × 5 规则全 0
    run.mjs / interact.mjs                                             not run (no playwright kit)
