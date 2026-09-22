# iPad-first redesign: the iOS shell and the brick model

Status: **decisions locked; P0 to P3 are implemented - and the navigation and
section parts of this document are superseded.** On 2026-09-22 the human replaced
the bottom tab bar and the two sections with one floating capsule and four
vocabulary destinations (壁 / 川 / 池 / 海), and deleted the passive track. The
current architecture is `README.md` section "The wordbook" and
`docs/coordination/log-wordbook.md`; where this file disagrees with them, they
win. Everything about the engine - schema, FSRS-6, the mining funnel, the shared
dictionary - still holds.

## 1. Why a redesign

The current site is a desktop web page that happens to run on an iPad. The
wordbook mirrors its own engine as five tabs (Review, Passive, River, Inbox,
Browse), the reader is a separate visual world with its own tokens and no site
navigation, and every view is a URL-less tab that resets on refresh.

The target is the opposite: an iPad app with one shell, one design system, two
sections, and a review unit built around the way words are actually captured.

## 2. Platform and interaction model

Main device: iPad, Safari, normally added to the home screen.

- **Global navigation**: one floating capsule (Home / Reading / Vocabulary) with
  a translucent material, a hairline and one shadow. On the vocabulary page it
  expands in place to reveal 壁 / 川 / 池 / 海. **Superseded on 2026-09-22**: this
  replaces the bottom tab bar and the large-title navigation bar described here
  and in section 6, and the in-page tab row with it. See section 8.
- **Gestures**: edge-swipe back within a tab, pull to refresh, long press for a
  context menu, and every modal is a bottom sheet with a grabber and
  drag-to-dismiss.
- **Touch**: every target at least 44pt, no hover-only affordances, no tap
  highlight, no rubber-band scrolling.
- **Viewport**: `viewport-fit=cover`, `100dvh`, `env(safe-area-inset-*)`, the
  system font stack, and support for Dynamic Type.
- **Launch**: a web manifest plus `apple-mobile-web-app-capable`, so a
  home-screen launch is fullscreen with no Safari chrome.
- **Known limit**: iOS Safari does not expose the Vibration API. Haptic
  feedback is unavailable without a native wrapper, so feedback is visual and
  audible instead. It is not promised.

## 3. Information architecture

**Superseded on 2026-09-22 by section 8.** The three destinations are ホーム /
読書 / 語彙, and 語彙 carries four views rather than two sections. What follows is
kept as the record of the design this replaced.

Two sections only.

### Learn (学习)

The default landing surface and the only place learning happens.

- The current **brick** (ten words): the day's learning and review, assembled
  automatically.
- The **word river** with the **rod** below it.
- A persistent session strip: bricks due today, words in the pool, recognition.

### Overview (总览)

Everything that is about the lexicon rather than about doing today.

- The **word pool**: every captured word, with its source and state.
- Brick progress: filling, sealed, learning, review, retired.
- Mastery.
- Data management (mine text, import a frequency list, import a Yomitan
  dictionary, backup and restore) behind a `…` menu.

## 8. The vocabulary redesign, as implemented

Decided by the human on 2026-09-22 and implemented in `d43dc6b` and
`db95847`. Where this section and the sections above disagree, this one wins.

### Navigation

One floating capsule, written statically into every page as
`#tabbar.capsule` (so the site navigates without JavaScript). Three
destinations - ホーム (`index.html`), 読書 (`reader/index.html`), 語彙
(`study.html`) - and on the vocabulary page the four sub-items 壁 / 川 / 池 / 海
after a hairline. `.tabbar-item[data-tab]` and `a.tabbar-sub[data-view]` are
the load-bearing hooks; `#tabbar` keeps its name because the reader detects the
shell through `.tabbar`.

The bottom tab bar, the large-title navigation bar and the in-page tab row are
deleted.

### The route is the navigation

| Route | View |
| --- | --- |
| `#wall` | 壁 - the wall: bricks stacked in review order, ten readable words each |
| `#wall/review` | 壁 - the drill: one card per word, FSRS-6 |
| `#river` | 川 - the river, the rod, the bucket |
| `#pool` | 池 - the words waiting for a brick, and the two sheets that pack them |
| `#sea` | 海 - 単語総覧: your own vocabulary and the entry card |
| `#sea/bricks` | 海 - ブリック総覧 |
| `#sea/dict` | 海 - 辞書: every loaded dictionary, and the words you looked up |

An unknown route falls back to `#wall`. The passive track is deleted; the
familiarity helpers stay, because 既知 uses them.

### 池 packs in sheets

`ブリックを作る` opens 選ぶ over the pool - 自動で組む (the ten the greedy
packer would take) or 手で選ぶ, with a checkbox per waiting word - then 設定:
name, part of speech, a fixed ten words, 認識 / 産出, and the first review
(today / tomorrow / in three days). `buildBricks({ selection, name, pos, modes,
firstDueDays })` writes exactly that. The brick just built becomes the current
one.

### 海 switches in the left column

A segmented control at the top of the left column, not a control buried
mid-column. 辞書's left column is the trail of words looked up, with relative
times; hiding a dictionary with the eye is a display choice - the lookup still
happens - and each source's own licence or attribution is rendered with its
entries, which is an obligation for JMdict rather than a decoration.

## 4. The pipeline

    capture (auto or net) -> pool -> cards -> bricks (x10) -> learn/review

### 4.1 Capture

Two paths, one destination.

- **Automatic**: a lookup in the reader, a mined passage, or a dictionary
  sample that survives the frequency funnel.
- **Manual**: the net. The learner drags a net through the river and catches
  the words they do not know.

### 4.2 Pool

The pool is the single source of truth for captured words. Every word carries
its provenance (reader, mined text, frequency list, net), when it was captured,
and its state. Card generation and bricking are automatic processes over the
pool; the learner never has to file anything by hand.

### 4.3 Cards

Generated mechanically from the dictionary entry and the capture context, one
card per sense, by the existing `authoring.js` rules.

### 4.4 Bricks

A brick is exactly ten words and is the unit of learning and review.

Bricking order: the same source first (one book or one import batch), then the
same frequency band, then the same part of speech, and the remainder is filled
from the river. A brick gets a name and a provenance line.

### 4.5 Brick scheduling (decision C, hybrid)

Each card keeps its own FSRS state and is graded individually. The brick adds a
pacing layer on top:

- when a brick is due, all ten cards are shown, whatever their individual due
  dates;
- the brick's next due is the **median** of its cards' next intervals, so the
  ten words stay together without over-reviewing the easy ones;
- if three or more cards are rated *Again*, the whole brick is due tomorrow;
- words that keep failing return to the pool and are re-bricked, rather than
  repeating the same brick forever;
- a brick retires once every card reaches a stability threshold, at which
  point it moves to the overview.

## 5. Word river and rod

- Rendered on a `<canvas>` in **tategaki**: words fall from the top in
  columns, one character under the last, and the columns drift down at
  different speeds.
- The column count follows the width - about one column per 46px, between 3
  and 14 of them - so a wide iPad is densely packed and a phone is not.
- A word that leaves the bottom returns above its own column's top, so the
  stream never ends and the spacing inside a column can never close up.
- **Rod**: press or drag to drop the hook. The first word it touches is hooked,
  reported, and sent to the pool. One cast, one word; the hook is always lifted,
  so the same word can be hooked again.
- The one exception to "never stops": `prefers-reduced-motion` draws a single
  static frame instead of animating.

## 6. Decisions locked

| Decision | Choice |
| --- | --- |
| Global navigation | **Superseded**: one floating capsule, Home / Reading / Vocabulary, expanding on 語彙 to 壁 / 川 / 池 / 海 (section 8) |
| Review gesture | Four-way swipe grading |
| Brick scheduling | C, hybrid: per-card grades plus brick pacing |
| Net | Drag out an area; everything inside is caught |
| Brick size | Exactly 10; a short tail waits for the next batch |

## 7. Phases

| Phase | Contents |
| --- | --- |
| P0 | iOS shell and design system: tab bar, nav bar, sheets, tokens. No engine change; the suite stays green. **Done.** |
| P1 | Pool and bricks: data model, bricking algorithm, brick session. DB version 3. **Done.** |
| P2 | River and net: canvas flow, drag-to-cast, catch into the pool. **Done.** |
| P3 | The two sections: Learn and Overview; the old five tabs are demoted. **Done.** |
| P4 | PWA polish: home-screen fullscreen, motion, empty and error states, touch detail. |
| P5 | The 語彙 redesign: the floating capsule, 壁 / 川 / 池 / 海, the route, the packing sheets, the dictionary view. **Done** (`d43dc6b`, `db95847`); see section 8. |

### P0, as built

| File | What it is |
| --- | --- |
| `assets/css/tokens.css` | design tokens: colour, spacing, radius, type, touch size, safe areas, light and dark |
| `assets/css/shell.css` | navigation bar, tab bar, bottom sheet, iOS lists, the embedded content box |
| `assets/js/shell.js` | active tab, collapsing large title, the more sheet, edge-swipe back, `window.Shell` |
| `manifest.webmanifest`, `assets/apple-touch-icon.png` | home-screen launch: fullscreen, no Safari chrome |
| `overview.html` | the third tab, a placeholder for the pool and the bricks |
| `tests/shell.test.js` | the shell markup, the manifest, and the sheet behaviour |

The tabs are `Reader / Learn / Overview`. `Home` and `About` moved into the
navigation bar's `more` sheet. The wordbook's own five tabs are untouched: P3
collapses them into Learn and Overview.

### P1, as built

| File | What it is |
| --- | --- |
| `src/lexicon/brick.js` | pure: grouping in priority order, full bricks of ten, median pacing, the hybrid rule |
| `src/lexicon/brick-label.js` | a brick's group as a name, shared by the wordbook and the overview |
| `src/lexicon/db.js` | DB version 3 adds a `bricks` store; the upgrade is additive |
| `src/lexicon/store.js` | `addToPool`, `enrol`, `buildBricks`, `nextBrick`, `brickQueue`, `paceBrick`, `dissolveBrick` |
| `src/lexicon/entry.js` | review is brick-first; an Enrol button; the brick chip and the session summary |
| `assets/js/overview.js`, `overview.html` | the pool and the bricks, live |

The pool is the encounter table with two new states: `carded` (cards exist,
waiting for a brick) and `bricked`. `enrol` turns every inbox candidate into
cards and packs the pool into bricks; `buildBricks` runs after every import and
is safe to repeat because a bricked word is skipped. A brick session is **one
card per word**, so a brick is ten cards, and the output modes rotate across
sessions because the card chosen is the lowest-mode one that is due.

The hybrid rule lives in `nextBrickState`: the brick's due date is the median
of its cards' next intervals, three or more Again ratings pull the whole brick
to tomorrow, and a brick retires once every card reaches a 21-day stability.

### P2, as built

| File | What it is |
| --- | --- |
| `src/lexicon/river-field.js` | pure: columns, tategaki boxes, wrap-around, the rod's hit test, and a no-overlap guard |
| `src/lexicon/river-view.js` | canvas drawing (one character per cell), the clock, the rod, and a DOM fallback where there is no 2D context |
| `src/lexicon/river-pool.js` | the field's food: the lexicon, the captured pool, and a dictionary sample, shuffled |
| `src/lexicon/entry.js` | the river tab: start and stop, pause, a new course, and the one-word catch |

The field lays out columns of equal cells, so two words in one column can only
touch if the layout puts them there and it never does; a test steps the field
four hundred times and asserts no overlap after every step. The view caps the
device pixel ratio at 2 and reads its colours from the tokens, so the river
follows the theme; `prefers-reduced-motion` draws one static frame instead of
animating.

The rod hooks one word per cast and sends it straight through `addToPool`, so it
is carded mechanically and `buildBricks` runs straight after. Nothing stands
between the finger and the result; a line under the river says what happened,
including when the word was already in the pool.

The river's food is three sources: the learner's own lexicon (whose items carry
a sense, so they keep their schedule), the captured pool (the unknown words the
rod is for), and a dictionary sample.

### P3, as built

The wordbook is one page with two sections, routed by the hash and switched by
the bottom tab bar. The old five tabs are gone.

| Section | Views |
| --- | --- |
| Learn (`study.html#learn`) | Brick, River, Passive |
| Overview (`study.html#overview`) | Pool, Bricks, Lexicon, Data |

`overview.html` is a redirect into `#overview`, and its separate controller is
gone: one page means one engine instance, so the pool, the bricks and the data
tools share state with the session instead of reloading it. The session strip
(words, due, new, recognition) sits above both sections. Data management moved
from the bottom of the wordbook into Overview, where the redesign put it.

The reader boundary is `docs/coordination/interface-shell.md`, proposed by
agent-reader. The shell sets `document.documentElement.dataset.shell = 'on'`
and `body.has-shell`, exposes `window.Shell`, renders whatever
`window.Reader.actions()` returns, subscribes to `Reader.on('title')`, and
gives the reading surface a `.shell-content` box. The z scale is bars 30,
reader sheets 40, shell sheets 50, hover bubble 60.

## 8. Coordination

The global navigation bar has to cover `reader/`, which belongs to
agent-reader. The proposal is that this side provides the shell
(`assets/css/tokens.css`, `assets/css/shell.css`, `assets/js/shell.js`) and
the reader adds one stylesheet and one script tag; the reading logic does not
change. The request is recorded in `docs/coordination/log-wordbook.md`.

## 9. Open

- **Visual direction** is not yet chosen. The working assumption is
  "instrument-like density on paper-like surfaces" until a reference says
  otherwise.
- Whether the top-level `Home` and `About` pages survive as tabs, become
  sheets, or are absorbed into `Overview`.
