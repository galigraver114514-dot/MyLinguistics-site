# Handoff · design seat → build seat · 2026-09-23

The human has split the work: **a new agent builds; agent-visual designs.** This
document is what the build seat needs and does not have to rediscover. It is
written by the design seat at the moment the split happened, and everything in
it is checkable with the commands in the last section.

Two things it is not: a specification (that is `designs/design.pen`, and its
prose in `designs/README.md`), and a plan for new screens (that is
`docs/full-control.md` and the project whiteboard).

---

## 1. The split

- **Build seat**: `src/lexicon/**`, `study.html`, `tests/**`, `.gitignore` — and
  the whole app's behaviour from here on.
- **Design seat (agent-visual)**: `designs/**` (`design.pen` and the boards it
  draws), the design system in `assets/css/tokens.css`, the shell
  (`shell.css`, `shell.js`, `app.js`), motion, and `reader.css`'s visual layer.
- **agent-reader** keeps `reader/**` except its visual layer, `src/dict/**`, the
  interface documents, and the deploy workflow.
- `assets/js/i18n.js` is the one shared file: REQUEST/ANSWER in the writer's own
  log before editing it (`docs/coordination/README.md`).

Until this point the design seat held **grant 1**, a time-limited full control
of the working tree, because a mismatch between the boards and the app had its
cause in files it did not own. That grant is what produced the code the build
seat inherits (section 3). **It ends with this handoff**: the design seat does
not edit `src/`, `study.html`, `tests/` or `i18n.js` any more. Every code change
from here is the build seat's, under the normal ownership rule.

Recorded in `docs/full-control.md`; append to it, never rewrite it.

---

## 2. What the app is

The vocabulary app has four destinations under 語彙, plus the reader and home:

| Route | Board | State |
| --- | --- | --- |
| `#wall` | `DiHAx` | Stack of bricks, ten readable words each |
| `#wall/review` | `Kr4lF` | The drill: 壁's rail + the four totals, a progress strip, the page-sized card, four grade cards |
| `#river` | `zAWvX` | 川 and 桶 as the board's two columns |
| `#pool` | `HnsOq` / `gLDnX` | 池, and the two floating sheets that pack a brick |
| `#sea` | `c2CdO` | 海 · 単語総覧, with the entry card and three right-rail cards |
| `#sea/bricks` | `rNm6y` | 海 · ブリック総覧: stage filter, glyph matrix, stage breakdown |
| `#sea/dict` | `PXk00` / `ob2Y0` | 海 · 辞書: the entry panel, the dictionary blocks, the landing state |

The cycle is 海 → 川 → 桶 → 池 → ブリック → 海 → 壁, and each stage exists:
a word is caught in 川, held in 桶, sent to 池 by 池へ, packed into a brick by the
two sheets, and taken to 壁 from 海 · ブリック総覧 or from the pool's build button.

**The gestures are not the obvious ones and they were chosen deliberately:**

- 川: **press and hold a word (~300ms), then drag it into the bucket.** There is
  no rod; the concept was deleted by the human. A tap takes nothing. Letting go
  over the bucket puts the word there; letting go anywhere else puts it back in
  the river. **The slot a taken word leaves stays empty** (the human's rule,
  2026-09-23): filling it can only put back a word the water already shows, since
  the pool is a cycle. Letting go elsewhere puts the word back into its own slot,
  or - if the flow has already carried that slot past the bottom edge and dropped
  it - in at the top of its column. An empty slot cannot be picked up.
- 桶: a chip is a button — pressing it returns that word to the river, and 取消
  returns all of them.
- Every other control is a normal button.

**No global scrollbar, anywhere.** The app is one screen: the page is locked and
each column scrolls inside itself. That is a requirement, not a detail — it was
one of the four things the human reported.

---

## 3. What this seat's work left in the code

The build seat inherits a codebase where the following are done and verified.
Do not re-decide them without the human.

- **The layout contract**: every view starts at y=74 (capsule 16+46+12) and ends
  at y=812 (834 − page-pad). `.wb-app` is `calc(100dvh - var(--shell-top))` with
  the page padding as its margin; `.panel + .panel` no longer applies to views.
- **The colour contract is live**: `data-pos` (part of speech) and `data-phase`
  (sealed/learning/review/retired) are written by the engine and read by CSS.
  `ladderState()` in `entry.js` derives a word's rung from record → brick →
  cards. `--depth-none/learning/review` are 12/55/100%.
- **The river** draws chips on a canvas: `river-field.js` owns the words and
  their motion, `river-view.js` owns the pixels and the gesture. The field's API
  is `items()`, `columns()`, `itemAt(x,y)`, `replaceAt(item, word)`,
  `coverTop()`, `fill()`, `step()`, `resize()`, `bornMs`.
- **Performance**: the canvas caches its palette (it used to call
  `getComputedStyle` twice per frame — 120 forced style recalcs a second) and
  invalidates it with a `data-theme` observer; `go()` sets the hash and lets the
  `hashchange` route, because routing in both places rendered every view twice.
- **iOS surface**: `body:has(.wb-app)` locks scrolling, rubber-banding and
  double-tap zoom; inner lists get momentum and `overscroll-behavior: contain`.
- **Two traps, learned the hard way**:
  - a `transform` on an ancestor of a `position: fixed` element makes it the
    containing block, *even when the animation ends at `none`* — the pool's two
    sheets moved 22px right and 74px down because the view fade had a rise in it.
    The fade is opacity only.
  - `show()` had to clear the `hidden` **attribute** as well as the class, or the
    two pool sheets could never open.

---

## 4. The verification kit — the most useful thing here

`designs/verify/`. It is the only way to know whether the app matches the
boards, and the build seat should run it after every change.

    sh designs/verify/setup.sh            # once: playwright + chromium into /tmp (~170 MB)
    node designs/verify/run.mjs           # 16 routes: PNGs + the measured rect of every probe
    node designs/verify/run.mjs wall sea  # only those routes
    node designs/verify/interact.mjs      # 13 finger-level assertions
    node designs/check-overlap.cjs        # the boards themselves: 7 rules, must be 0
    npm test                              # 376

- `run.mjs` **is a gate**: it exits non-zero if a page threw, an anchor selector
  was missing, or a document is taller than the viewport. It measures rather than
  looks — the measured rect is what caught the sheets jumping, a column that grew
  with its list, and a `height: 100%` that had been resolving to `auto`.
- `interact.mjs` **is also a gate**: the page is locked, a tap takes nothing, a
  long press picks a word up, it follows the finger, the bucket lights up, the
  drop lands, a word dropped elsewhere is back in the river, 一新 replaces the
  words, every column starts above the top edge, a switch touches the DOM once,
  nothing thrown.
- `routes.json` is the whole configuration. A route may carry `steps` to drive
  the app to a screen that only exists once something has been packed:
  `hash:#river`, `catch:auto:30`, `toPool`, `click:#wbPoolBuild`, `wait:400`,
  `eval:<js>`. **Name words instead of auto-catching and it will not work**: a
  word already in the lexicon is marked 既知, so only words the book has never
  met reach ブリック待ち.
- Each route gets its own browser context, because the routes write to IndexedDB
  and a shared profile means the tenth screenshot is taken over the first nine.

The seat has **no browser of its own** — that is why this kit exists and why it
is in the repository rather than in a log.

---

## 5. Hard conventions

- **UI copy is Japanese, no simplified Chinese characters.** ブリック / 壁 / 桶 /
  川 / 池 / 海 / 復習 / 卒業. i18n keys live in `assets/js/i18n.js`, three locales,
  **304 keys each — grep for a key name before adding one** (a duplicate of
  agent-wordbook's `dict.toPool` had to be removed once).
- **Readability first**: colour blocks carry shape, never the only copy of a
  fact. Every wall cell spells its word.
- **The colour contract**: 形 = membership (the ten-cell glyph), 濃淡 = progress
  (12/55/100), 色相 = part of speech, 中性 = exit. Time is never a colour; 40% is
  the magnitude channel for the 内訳 bars and nothing else.
- **The ruler is the board.** Where this document and `designs/design.pen`
  disagree, the board wins and this document is corrected.
- Commits: explicit paths only, never `git add -A` (the tree regularly holds
  other agents' work). Every push to `main` deploys.

---

## 6. Still open

- **The kanji detail card** (`ob2Y0`: 音読み / 訓読み / 画数 / 部首 / 漢検, 熟語,
  関連, この漢字を使う語). Nothing in the build has character metadata — JMdict
  carries glosses. It needs a decision (bundle a 常用漢字 table?) before it can be
  drawn; it is deliberately not drawn rather than drawn with blanks.
- **ホーム and 読書 have no boards.** `index.html` is still a marketing hero.
- **D1** the wall's phase tab (recommendation: the thin colour tab carries
  12/55/100, cells stay a constant 12% wash), **D2** icons on the capsule items,
  **D4** 池's candidate approval step (no board draws one, which is why the filter
  still exists), **D5** `#wbData`'s ownership.
- **R7**, an open cross-agent request: `window.Reader.setPageAnimator(fn)`.
- The 川 canvas mask axis and the night-mode highlight alphas in
  `reader/reader.css` want eyes on a rendered page.

---

## 7. The design seat's tools, honestly

Nine `pencil_mcp_*` tools plus `read_image`. Not all of them work in this
environment, and the working ones are not the obvious ones:

| Tool | State |
| --- | --- |
| `pencil_mcp_open` | works — opens/switches the `.pen` on the live canvas |
| `pencil_mcp_get_app_state` | works, including `include_schema: true` (the full `.pen` schema) |
| `pencil_mcp_export_nodes` | works — renders nodes to PNG at 2×; **this is how a board is looked at** |
| `read_image` | works — reads the exported PNG back |
| `pencil_mcp_batch_get` | **broken** — "engine start failed: pen.dev engine exited" |
| `pencil_mcp_get_screenshot` | **broken** — same engine |
| `pencil_mcp_get_guidelines` | **broken** — same engine |
| `pencil_mcp_execute` | used successfully in earlier design rounds (`Update`/`Insert`/`Copy`/`Delete`/`Move`/`Set`/`Replace`); not re-exercised this session. There is no `raw()` in the sandbox, and `Update` rejects `fontSize`. |
| `pencil_mcp_export_html`, `pencil_mcp_insert_image` | not exercised |

The consequences, which any design round has to plan around:

- **Boards are read as images.** Export the eleven board ids with one
  `pencil_mcp_export_nodes` call into `designs/exports/` (git-ignored), then
  `read_image` them. `designs/README.md` lists what each board is.
- **Node data cannot be read back.** `batch_get` is the documented way to verify
  text and properties, and it does not start here — so a board's text is verified
  by reading its PNG, and the geometry by `designs/check-overlap.cjs`.
- **`designs/check-overlap.cjs` is the geometry gate** for boards: seven rules
  (out of bounds, text on text, overlapping surfaces, text that cannot fit, a box
  whose content outgrows it, and the overlay exception). It has caught the canvas
  injecting stray text nodes mid-edit, so **run it after every board edit**, not
  at the end of a round.

---

## 8. Environment facts

- The workspace is sandboxed to `workspace-write`: `~/.cache`, `~/.dsh` and
  `~/.local/share` are refused, and only `/tmp` and the repository are writable.
  That is why the browser kit lives in `/tmp/pw-kit` and its screenshots in
  `/tmp`, and why `package.json` is untouched.
- System Firefox is a snap and cannot start here (`snap-confine` lacks
  `cap_dac_override`); `~/.npm` is owned by another uid, so npm's cache is
  redirected rather than repaired. `designs/verify/setup.sh` encodes all of it.
- Headless chromium through Playwright is the only renderer. It is pinned and
  installed by that script; nothing needs installing to run the checks again
  while `/tmp/pw-kit` survives.

---

## 9. How to check any claim in this document

    git log --oneline -12                     # d5d56a3 .. 212436f are this seat's
    node designs/check-overlap.cjs            # boards: 7 rules, expect 0
    node designs/verify/run.mjs               # app: 16/16 clean, every rect printed
    node designs/verify/interact.mjs          # gestures: 13/13
    npm test                                  # 376/376

Read `designs/design.pen` for intent, `designs/README.md` for the colour
contract and the board list, `docs/full-control.md` for what the grant changed
and why, and `docs/coordination/README.md` for who owns what.
