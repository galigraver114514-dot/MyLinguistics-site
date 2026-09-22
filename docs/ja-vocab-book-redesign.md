# iPad-first redesign: the iOS shell and the brick model

Status: **decisions locked; P0 (the iOS shell), P1 (the pool and the bricks) and P2 (the river and the net) are implemented.** This supersedes the page and
navigation parts of `ja-vocab-book-design.md`. The engine described there -
schema, FSRS-6, passive track, mining funnel, shared dictionary - is reused
unchanged.

## 1. Why a redesign

The current site is a desktop web page that happens to run on an iPad. The
wordbook mirrors its own engine as five tabs (Review, Passive, River, Inbox,
Browse), the reader is a separate visual world with its own tokens and no site
navigation, and every view is a URL-less tab that resets on refresh.

The target is the opposite: an iPad app with one shell, one design system, two
sections, and a review unit built around the way words are actually captured.

## 2. Platform and interaction model

Main device: iPad, Safari, normally added to the home screen.

- **Global navigation**: a bottom tab bar (`阅读 / Learn / Overview`) plus a
  per-tab large-title navigation bar that collapses to an inline title on
  scroll. Both use a translucent material and respect the safe area.
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

Two sections only.

### Learn (学习)

The default landing surface and the only place learning happens.

- The current **brick** (ten words): the day's learning and review, assembled
  automatically.
- The **word river** with the **net** below it.
- A persistent session strip: bricks due today, words in the pool, recognition.

### Overview (总览)

Everything that is about the lexicon rather than about doing today.

- The **word pool**: every captured word, with its source and state.
- Brick progress: filling, sealed, learning, review, retired.
- Mastery.
- Data management (mine text, import a frequency list, import a Yomitan
  dictionary, backup and restore) behind a `…` menu.

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

## 5. Word river and net

- Rendered on a `<canvas>`: four to eight lanes scrolling at different speeds,
  words tiled densely and wrapped seamlessly, driven by a
  `requestAnimationFrame` loop that never stops.
- Density target: 40 to 80 readable words on screen; offscreen text caching and
  a device-pixel-ratio cap keep it at 60fps.
- **Net**: press and drag to cast. Words inside the net highlight and are pulled
  toward its centre; releasing opens a catch sheet with *collect* and
  *release*. Words already in the lexicon are skipped.
- The one exception to "never stops": `prefers-reduced-motion` slows it to a
  static grid.

## 6. Decisions locked

| Decision | Choice |
| --- | --- |
| Global navigation | Bottom tab bar: Reader / Learn / Overview |
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
| P3 | The two sections: Learn and Overview; the old five tabs are demoted. |
| P4 | PWA polish: home-screen fullscreen, motion, empty and error states, touch detail. |

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
| `src/lexicon/river-field.js` | pure: lanes, tiling, wrap-around, and the net's hit test |
| `src/lexicon/river-view.js` | canvas drawing, the clock, pointer handling, and a DOM fallback where there is no 2D context |
| `src/lexicon/river-pool.js` | the field's food: the lexicon, the captured pool, and a dictionary sample, shuffled |
| `src/lexicon/entry.js` | the river tab: start and stop, pause, a new course, and the catch sheet |

The field is six lanes alternating direction, each at its own speed, with words
tiled along them and recycled behind their lane so the stream never ends. The
view caps the device pixel ratio at 2 and reads its colours from the tokens, so
the river follows the theme; `prefers-reduced-motion` draws one static frame
instead of animating.

The net: press and drag catches every word it touches, and releasing opens the
shell's sheet with *add to the pool* and *release*. A caught word goes through
`addToPool`, so it is carded mechanically like any other capture, and
`buildBricks` runs straight after.

The river's food is three sources: the learner's own lexicon (whose items carry
a sense, so they keep their schedule), the captured pool (the unknown words the
net is for), and a dictionary sample.

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
