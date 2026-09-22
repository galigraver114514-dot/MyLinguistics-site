# agent-visual log

Newest entries at the top. Only agent-visual writes here.

Read first, in this order:

1. `docs/coordination/agent-visual-brief.md` - what you own and the traps.
2. `docs/coordination/README.md` - the shared rules (agent-reader owns it).
3. `docs/coordination/log-wordbook.md` and `docs/coordination/log-reader.md`.
4. `docs/ja-vocab-book-redesign.md` - the current information architecture.
5. `git log --oneline -15` and `git status --short`.

## 2026-09-22 - T1 continued: the design goes into git, and every hand-written duration goes through the tokens

### The design is versioned; the PNGs are not

`design.pen` (1.4 MB), `check-overlap.cjs` and a new `README.md` - what the
eleven boards are, the colour contract, the seven rules, how to re-export. The
deploy workflow already excludes this whole directory from the published site
(agent-reader set that up in `ff33c47`), so this adds nothing to the web.
`designs/exports/` stays out of git: the PNGs are derived, regenerable, and
would be rewritten every design round. REQUEST sent for the `.gitignore` line.

### Motion: six hand-written durations, now five tokens

The audit found them; they are gone.

| Was | Now | Where |
| --- | --- | --- |
| `0.18s ease` | `--motion-fast` + `--ease-out` | the compact nav title |
| `0.22s ease` | `--motion-base` + `--ease-out` | the sheet backdrop |
| `0.28s cubic-bezier(0.32,0.72,0,1)` | `--motion-base` + `--ease-ios` | the sheet |
| `0.2s ease` | `--motion-base` + `--ease-out` | the wordbook progress fill |
| `0.06s` / `0.15s` | `--motion-fast` + `--ease-out` | `.btn` press feedback |

The sheet moved from 280 ms to 220 ms because `ui-redesign-plan.md` section 6
assigns sheets to `--motion-base` and the token is the decision, not the old
number. `grep -rn 'transition[^;]*[0-9]' assets/css/` returns nothing and the
only `cubic-bezier` left in the directory are the two token definitions.

`prefers-reduced-motion` turns motion **off**, not shorter. `shell.css` already
had a block covering its three rules; `wordbook.css` and `style.css` had none
and now do.

### One more line out of the same audit

`.wb-review-top .btn { margin-left: auto }` gave *every* button in the row an
auto margin, so two buttons would spread apart instead of the group moving to
the right. Now `:first-of-type`. With the single button that row has today the
rendering is identical, which is why this is safe to do without a look.

### Left alone, on purpose, with the reason

- **The river's mask axis** (`linear-gradient(90deg, ...)`, `wordbook.css:230`).
  The audit called it the wrong axis, but the axis that matters is the one the
  field overflows along, and I cannot see the river rendered from here. Rewriting
  a decorative mask on a guess is not worth it; it is on the list for the next
  time the river is touched.
- **Night-mode highlight alphas.** The `--hl-*` rename is free; a calibration
  needs eyes on a dark page, and it is not in anyone's plan yet.

### A red main waiting to happen, and not mine

`src/lexicon/store.js:24` imports `DAY_MS` from `./brick.js` while line 37
declares its own `const DAY_MS`. The suite dies with `SyntaxError: Identifier
'DAY_MS' has already been declared` and 11 tests fail. It is agent-wordbook's
in-flight edit, uncommitted, so `main` is fine **today** - but it is a red main
the moment it is committed. I left it alone: it is their file and their
refactor, and the protocol's answer to a collision is to wait or escalate, not
to reach across. I verified it is not mine before saying so: no test reads any
stylesheet except to assert the `<link>` is present, and
`node --test tests/reader-*.test.js tests/shell.test.js tests/lang-switch.test.js`
is 114/114 on that same tree.

## 2026-09-22 - T1: the two things agent-reader is blocked on, five REQUESTs, and the motion pass

The arbitration in `log-reader.md` (commit `ff33c47`) is accepted as written: the
visual layer is mine, `README.md` carries one map, and the only shared file left
is `assets/js/i18n.js`. This entry clears the two items agent-reader is waiting
on, then works the T1 plan.

### ANSWER: the reader's theme attribute, and one thing the earlier answer missed

`reader/reader.css` now matches **both** attributes:

    html[data-page-theme='paper'], html[data-theme='paper'] { ... }

for all three themes. Land either commit first - the reader keeps its paper
either way, so there is no window where the page loses its theme. The old half
of each selector is deleted in the commit after yours, and I will say so here.

**One correction to the token-rename answer.** You wrote that nothing in
`reader/js/**` reads `--paper`, `--ink`, `--accent`, `--line` or `--reader-size`
through `getComputedStyle`. That is true, and it is not the whole coupling:
**`reader/js/app.js:900` does `note.style.color = 'var(--muted)'`** - a live CSS
variable inside an inline style. `getComputedStyle` was the wrong test; the
grep for the variable name is the right one.

So this commit renames four (`--paper --ink --line --bar` → `--page-bg
--page-ink --page-rule --page-bar`) and leaves `--muted` in place with
`--muted: var(--page-muted)` next to it, because renaming it without your one
line would silently drop the note's colour to inherited. That is a one-release
bridge with an exit condition, not a second vocabulary:

    REQUEST: one line in reader/js/app.js
      to: agent-reader
      why: line 900 sets `note.style.color = 'var(--muted)'`, so `--muted` can
        not be renamed out of reader.css without it. Keeping the name keeps the
        collision with tokens.css alive for as long as it exists, and that
        collision is the thing that bites when the reader is embedded.
      shape: `note.style.color = 'var(--page-muted)'`, one line, no behaviour
        change. I delete the `--muted` alias in the next commit after yours.
      blocks: nothing today; it blocks the embedded reader, step 3
      needs-by: whenever

No per-theme highlight calibration in this commit. The `--hl-*` names are a
strict rename of the six values that were hard-coded, so nothing visible moves;
night mode's highlight alphas stay at the light-mode values they have today
until someone can look at a dark page and judge them. A rename is verifiable
from the diff; a calibration is not.

### ANSWER: the progress rail element contract

You own the reader's markup and gestures; the rail's look is mine, so the
contract is the seam between them rather than a design:

    <div id="rail" role="progressbar" aria-label="読書位置"
         aria-valuemin="1" aria-valuemax="1" aria-valuenow="1">
      <div id="rail-fill"></div>
    </div>

- **Placement matters**: `#rail` must be a sibling of `#viewport` **after** it,
  the way `#foot` already is, so that `#viewport.vertical ~ #rail` can reach it.
  Vertical text advances leftward and the rail has to fill from the right; that
  one sibling selector is how the stylesheet knows, and it needs no new attribute.
- **You update three things** where `#page-info` is already updated
  (`reader/js/app.js:401`): `aria-valuemax` = `state.pages`, `aria-valuenow` =
  `state.page + 1`, and `rail.style.setProperty('--progress', pages > 1 ?
  page / (pages - 1) : 0)`.
- **I draw** `#rail-fill` with `transform: scaleX(var(--progress, 0))` and
  `transform-origin` flipped by the vertical selector. Transform rather than
  width, so a page turn never triggers layout, and it composites.
- **Tap to jump and hold to scrub stay yours** - they are gestures, and gestures
  are `reader/js/**`. I will not put a control in your markup that you did not
  ask for.
- The look is **provisional**: the 読書 board is not drawn yet. Because
  `reader/reader.css` is mine, I can restyle it without asking you for anything.

### REQUEST: seven additive navigation keys for assets/js/i18n.js

    REQUEST: add the seven navigation keys, in all three languages
      to: agent-wordbook
      why: you are the named single writer for the IA change, and the floating
        capsule cannot ship with the labels it has. `nav.study` says 学習 and
        the design says 語彙; `nav.reader` says リーダー and the design says
        読書; the four second-level items do not exist at all.
      shape: ADD, do not reword. `nav.reading` 読書 / Reading / 阅读,
        `nav.words` 語彙 / Vocabulary / 词汇, `nav.wall` 壁 / Wall / 壁,
        `nav.river` 川 / River / 川, `nav.pool` 池 / Pool / 池,
        `nav.sea` 海 / Sea / 海, `nav.dict` 辞書 / Dictionary / 词典.
        Leave `nav.reader`, `nav.study` and `nav.overview` untouched:
        tests/lang-switch.test.js:45 asserts zh `nav.reader` is 阅读器, and the
        old static markup still uses all three until your item 4 deletes it.
      blocks: the capsule's labels - items 3 and 5 behind it
      needs-by: when you write item 10, or sooner if it is cheap

### REQUEST: freeze the route vocabulary before you write item 6

    REQUEST: use these four hashes for the vocabulary sections
      to: agent-wordbook
      why: the capsule has to emit the same vocabulary your router consumes, or
        a tap lands nowhere. Two vocabularies invented in two files is the
        collision again, one level down.
      shape: `study.html#wall`, `#river`, `#pool`, `#sea`, and `data-tab` with
        the same four values. 海's three parts (単語総覧 / ブリック総覧 / 辞書)
        are the in-page segmented control, not capsule items.
      blocks: the capsule's second level (item 3's other half)
      needs-by: before item 6 lands

### REQUEST: the class-name contract for the 語彙 skeleton, wall and sheets

    REQUEST: take these class names verbatim in item 5's markup
      to: agent-wordbook
      why: the styling half is mine and the markup half is yours. Freezing the
        names first is what lets the two halves be written at the same time
        without waiting for each other; if you rename one, my CSS is dead code
        and neither of us finds out from a test.
      shape: `.wb-shell` (the split), `.wb-rail` (left column), `.wb-main`,
        `.wb-seg` / `.wb-seg-item` / `.is-active` (the segmented control),
        `.wb-course` / `.wb-course-tab` / `.wb-course-cells` / `.wb-cell`
        (the wall), `.wb-glyph` / `.wb-glyph-cell` (the ten-cell brick),
        `.wb-scrim` / `.wb-sheet` / `.wb-sheet-head` / `.wb-sheet-body`
        (the two floating sheets).
      blocks: the 語彙 restyle
      needs-by: before item 5

### REQUEST: three small things in your files

    REQUEST: .gitignore, overview.html, and the two test files
      to: agent-wordbook
      why: three separate small things that are each one line, gathered so they
        cost one turn instead of three.
      shape: 1) `.gitignore` gains `designs/exports/` - the PNGs are derived
        from design.pen and regenerable, and they are 2.4 MB that would be
        rewritten every design round. design.pen and check-overlap.cjs do go
        into git, and the deploy workflow already excludes the whole directory
        from the published site. 2) `overview.html` is a redirect stub to
        `study.html#overview` and dies with the IA. 3) when item 4 deletes the
        static navbar and tab bar, `tests/shell.test.js:20-21` and `:71-74` and
        `tests/wordbook-sections.test.js:46,52` move with it - they assert
        `class="tabbar"`, `id="navbar"` and `.tabbar-item[data-tab=...]`.
      blocks: nothing of mine. My capsule is built so that those tests pass
        unmodified, which is why it can ship before your markup lands.
      needs-by: whenever

### What T1 actually changed

`reader/reader.css`: the dual theme selectors above, `--page-*` for four names,
`--hl-*` for the six hard-coded highlight values, and the `--muted` bridge.
Nothing visible moves; the diff is a rename plus one selector widening.

## 2026-09-22 - the token layer lands, and the artifact's palette folds from 61 colours to 52

The human settled the collision this log's REQUEST raised: **the design system,
the shell, motion and interaction are agent-visual's.** `assets/css/tokens.css`
is the first file to change, because everything else gets written against its
names.

### What was added

- **Six part-of-speech hues** (`--pos-verb|noun|greet|adv|expr|conj`), with the
  dark set at Apple's dark-mode values. The rendered design already used all
  six; three of them had no token, so the colour contract could not have been
  written against names.
- **The depth ladder as alpha** - `--depth-none 12%`, `--depth-learning 55%`,
  `--depth-review 100%` - consumed as
  `color-mix(in srgb, var(--pos-verb) var(--depth-learning), transparent)`.
- **Two exit neutrals**: `--exit-known`, `--exit-retired`. Leaving the ladder is
  not a hue and not a stage, so it gets its own names.
- **The five motion values** from `ui-redesign-plan.md` section 6, at the names
  and numbers that document already fixed.

Additive only: no existing token changed value, no selector moved, `npm test`
337 pass, and **nothing consumes the new names yet**. Landing them before their
consumers is deliberate - it is what stops the next component from inventing a
duration or a hue.

### What the artifact had been doing instead

Writing the contract down and then measuring the artifact against it found **61
distinct colours for roughly 14 roles**:

- **Five greys doing one job.** `#ececf0` (the empty slot in a 10-cell brick
  glyph), `#e9e9ee` (the same slot on other boards), `#e3e3e8` (chip fills),
  `#d9d9de` (bar tracks), `#f0f0f3` and `#e0e0e5` (1px rules). One inert fill,
  six values. All folded to `#e5e5ea` (`--surface-3`): 62 + 81 fills, 93 + 94
  strokes.
- **A 15% "current course" tint** (`#007aff26`) sitting next to the 12% wash it
  was supposed to stand out from. A three-point difference is invisible; folded
  to 12%.
- Blue now has exactly three steps (12% / 55% / 100%) plus the solid, which is
  what the contract says. 52 colours remain and all seven rules are still 0.

### Two findings the folding exposed - recorded, not papered over

1. **One brick states its progress twice, and differently.** The wall's 70 word
   cells are a 12% wash whatever the course's phase, while the brick's 10-cell
   glyph in the left rail carries the phase as depth. On `DiHAx` a 復習中 course
   and a 未開始 course read identically on the wall itself. Proposed fix, **not
   applied**: the thin colour tab left of each course name carries the depth,
   and the 10 cells stay a constant wash - they are a reading surface, and at
   100% they would be a wall of saturated colour needing white text. The human's
   readability-first rule decides this one, so it goes to them rather than into
   the board.
2. **40% is a role, not drift.** All six hues have a `66` variant, used only on
   6px-tall bars (the 内訳 charts and the review rail). That is the magnitude
   channel. It wants a name of its own rather than being folded into a depth
   ladder it is not part of.

Left alone on purpose: the river's own four blues (`#cfe3fb` `#dbe9fb`
`#a8c6ea` `#e0efff`) - 川 is a canvas world with its own look and is already
excluded from the ladder; `#b8b8bd` on ten 12px icons; six 8x5 cells at 20% in
`Kr4lF` / `rvSeq`.

### Not committed yet

`designs/` is still untracked. Committing it publishes `design.pen` (1.4 MB) and
11 PNGs to Pages, which is the human's call, not an oversight.

## 2026-09-22 - the rendered design is finished; the record below it is behind, and here is the correction

Four drawing rounds are missing from this log, so anything below that describes
**演習**, a two-pill 海 scope control, or a single-dictionary 海 board is
superseded. The current artifact, recorded before implementation starts:

`designs/design.pen`, **11 boards**, every one 1194x834 landscape, all seven
geometry rules 0:

| Board | What it is |
| --- | --- |
| `c2CdO` `rNm6y` `PXk00` `ob2Y0` | 海 - 単語総覧 / ブリック総覧 / 辞書 (multi-dictionary) / 辞書 (landing) |
| `DiHAx` `Kr4lF` `rvSeq` | 壁 - 積む / 復習 / 復習 with the sidebar collapsed |
| `HnsOq` `gLDnX` | 池 - 選ぶ and ブリック設定, both **floating sheets over the pool** |
| `zAWvX` | 川 - the river |
| `gRwYR` | 語の循環 - the system diagram, no navigation |

Decisions the implementation must not undo:

- **演習 was renamed 壁 by the human, twice** (墙, then 壁). The earlier REQUEST
  further down still says 演習; this section supersedes its wording. 壁 is
  first-class, not a rename of the drill: a brick can be grasped from the wall
  (`rNm6y` card action `壁へ掴む`, wall footer `海から次のブリックを掴む`).
- **海 is three parts, switched by a segmented control at the top of the left
  column** (単語 / ブリック / 辞書). Not the two-pill `自分 / 辞書` scope control
  this log proposed earlier, and not a switcher buried mid-column - the human's
  complaint was exactly that the switch point was invisible.
- **辞書's left column is 調べた語 lookup history with times**, not a word list.
  A word list there duplicated 単語総覧.
- **池 holds only ブリック待ち.** 候補 stay on the river side and the bucket makes
  the card, so the pool is the packing workshop. Packing is two floating sheets
  over the pool (`HnsOq` 自動で組む / 手で選ぶ + checkbox rows; `gLDnX` 名前 /
  品詞 / 語数 / モード / 初回の復習), not separate screens.
- **Colour contract, three channels.** 形 = 所属 (brick cell shape, status chip,
  list position); 濃淡 = 進度 (12% 未着手 / 55% 学習中 / 100% 復習中);
  色相 = 品詞 (動詞 `#007aff` 名詞 `#248a3d` 挨拶 `#a05a00` 副詞 `#30b0c7`
  表現 `#af52de` 接続詞 `#5856d6`); 中性 = 出口 (既知 `#8e8e93`, 卒業/無視
  `#c7c7cc`). **Time is never a colour** - a due date is text. UI controls keep
  their own neutral (`#e5e5ea` fill, `#6c6c70` glyph) and are not part of the
  state ladder.
- `assets/css/tokens.css` has only two of those six hues. 副詞 / 表現 / 接続詞
  are new tokens.
- `designs/check-overlap.cjs` now enforces **seven** rules (out of bounds,
  text-on-text, same-parent surface overlap, text that cannot fit, content that
  outgrows its box, and a floating layer is not a collision with what it covers).
  It is the gate, not a nicety: it found the canvas's injected probe nodes, two
  text nodes past their box, and a lane 18px over its rule.

`designs/` is **untracked** - the design is not in git yet. Committing it
publishes `design.pen` (1.4 MB) and the exports to Pages; that is a decision,
not an oversight.

### REQUEST (supersedes the two earlier IA requests)

    REQUEST: move the IA and its load-bearing hooks in one commit
      to: agent-wordbook (study.html, src/lexicon/entry.js, the tests),
          agent-reader (the shell)
      why: every test that asserts the old names moves with this. tests/shell
        .test.js asserts data-tab="reader|learn|overview" and the seven
        data-view names; tests/wordbook-sections.test.js asserts
        data-section="learn|overview"; tests/pages.test.js asserts
        data-i18n="wb.title"; tests/lang-switch.test.js asserts
        wb.tab.passive. Split across commits, main is red and every push
        deploys.
      shape: the seven views become 壁 (brick), 川 (river), 池 (pool + the two
        floating sheets), 海 (lexicon + bricks + a 辞書 panel that does not
        exist yet). 受け身 / passive is deleted by the human's earlier decision
        and its strings go with it. The in-page .wb-tabs row is gone - the
        switch is the segmented control in the left column. overview.html is a
        redirect stub and dies with the IA.
      blocks: the whole 語彙 restyle
      needs-by: before the markup changes

    REQUEST: write the three missing 品詞 hues into tokens.css
      to: agent-reader
      why: 副詞 / 表現 / 接続詞 have no token, and the design's colour contract
        cannot be written against names that do not exist. Part of step 1 of
        ui-redesign-plan.md, which you and I both claim.
      blocks: every coloured surface in the design
      needs-by: with the token pass

    REQUEST: answer the territory transfer before writing tokens.css or shell.js
      to: agent-reader
      why: commit 1471d5f gave the design system, the shell, motion and
        interaction to you, and README.md's map still says so. My CLAIM (this
        log) came after that decision and has no ANSWER, so right now two agents
        own tokens.css, shell.css and shell.js. That is the one thing the
        protocol cannot survive, and it is why nothing in assets/ has been
        touched.
      blocks: everything I would write in CSS or shell JS
      needs-by: now

## 2026-09-22 - 海 (the sea): the dictionary, and the features that never got a UI

Board `K2rGYs`, 1194x834, geometry 0 | 0 | 0 | 0. **The human approved the
shape first**: "查词典是「我知道一个词，去查它」，看总览是「我不知道有哪些
词」。左搜索 + 中词条 + 右总览的三段式" was put to them and they said
"可以，这个方案不错，来做".

Columns, on the same 18px margin / 12px gutter the other boards use:
left 320 (search + group filter + **your** 1,284 words), middle 520 (the
entry), right 294 (総覧 + 出典), plus a full-width primary at the bottom.
The right column is two cards so 総覧 can end on a whole number of bars:
`74+466=540`, `552+199=751`, button `764+52=816`.

Decisions worth not re-litigating:

- **The left list is your vocabulary, not the dictionary.** A search box over
  22,640 entries and a list of your own 1,284 are different jobs, so the scope
  is a two-pill control (`自分 1,284` / `辞書 22,640`) rather than a guess.
- **State dots carry the same five colours as 池 and are not re-legended.**
  池 leads with state, so it pays for a legend; here state is metadata, and a
  second legend on every screen is exactly the clutter this language exists to
  remove.
- **A step is not an exit.** The first draft drew the five pool states as one
  five-segment gradient and the render showed 既知 `#8e8e93` and 無視
  `#c7c7cc` merging into one grey band - and worse, it implied 既知/無視 are
  stages 4 and 5 of a progression. They are exits. The panel now shows the
  real path, 候補 → カード待ち → ブリック入り, three labelled bars, the
  reached ones solid and the current label in its own colour. Generalises
  downwards: a word still in 候補 gets one solid bar and two pale ones.
- **One place breaks the no-kana rule and needs a ruling.** The entry header
  carries `水 / みず`. Elsewhere there is no kana anywhere, but a dictionary's
  reading is a field of the entry and is what you search by, not a gloss on a
  word you already have. Flagged to the human rather than decided silently.

### What has code and no UI at all

Audited by diffing element ids against the scripts that use them (both pages
are fully wired - nothing is broken), by building the module import graph over
`src/`, `reader/js/` and `assets/js/`, and by scanning the 142 i18n keys for
consumers. Nothing in `src/` is dead at module level. The gaps are features:

| Capability | Evidence | Has UI? |
| --- | --- | --- |
| `Dictionary.kanji(ch)` -> KanjiInfo | `interface-dict.md` API; **zero consumers**, the only "kanji" hits outside it are a word in a comment | **no** |
| JMdict attribution | `interface-dict.md`; `dict/README.md` says it "must be rendered wherever the data is shown"; JMdict is CC BY-SA 4.0 | **no** - added to 海's 出典 card |
| `Entry.priority` (ichi1/news1/spec1/gai1) | parsed and used for ordering in `jmdict.js:287`, never displayed | **no** - added as 一般/新聞 chips |
| `Dictionary.problems()` | API | no |
| `lexicon().sample(n)` | `interface-dict.md` 1.4: "answers the wordbook's request for a way to reach the shared word pool" | **no** - the river still runs off `src/lexicon/river-pool.js` |
| typed answers, 6 modes | `wbInput`, `wbTypeWrap`, `wbTolerance`, `compareAnswer`, keys `wb.mode.recognize/reading/cloze/produce/fill/sentence`, `wb.match.exact/diff`, `wb.typeOptional` | **no** - the biggest one |
| due-interval previews | `formatDue`, keys `wb.due.min/hour/day/month/year`, one under each grade button | replaced by a bar; needs a ruling |
| Look only | `wbLookOnly`, `wb.lookOnly.on`, `wb.next` | no |
| mine a word, 5 fields | `wbMineWord/Reading/Definition/Sentence`, `wb.mine.*` | no |
| candidate inbox | `wb.inbox.*` - approve makes cards, reject ignores | a **second** waiting room, not the same as 池 |
| brick dissolve | `dissolveBrick`, `wb.bricks.dissolve` | no |
| 4 stats | `renderStats`, `wb.stat.words/due/new/recognition` | belongs to ホーム |
| text mining / frequency list / export / restore / reset | `runImport`, `runFrequency`, `exportJson`, `runRestore`, `resetAll` | belongs to a settings surface |
| Yomitan import | `importDictionary`, `forgetDictionaries`, `restoreDictionaries` | **no** - moved into 海's bottom button |
| dictionary status banners | `wbDictNotice`, `wb.dictMissing`, `wb.dictLoaded`, `wb.notice` | no |

Two more, outside the wordbook:

- The reader is **fully wired** - 45 ids, all consumed - but all of it needs a
  home in 読書: 本棚, 目次, the dictionary panel with its back/prev/next
  history, しおり, notes, highlights, the five-action selection bar, and the
  display sheet (縦/横 x **three** schemes x 14-34px).
- **The reader has three colour schemes, the site has two.** `paper/night/white`
  in `reader/js/app.js:105`; `THEME_TO_SITE` folds `white` into `light`. The
  third scheme exists only inside the reader.

### Dead strings and dead wiring

Six i18n keys have no consumer: `nav.about`, `nav.home`, `nav.menu`,
`wb.manage`, `wb.notice`, `wb.tab.review`. `about.html` ships but the primary
nav does not link it. And `wb.done.note` still says "Switch to Passive to keep
meeting words" - a sentence pointing at a view the human has deleted.
`src/lexicon/digest.js` is the passive engine and goes with it.

### Trap found this round

`Update(id, props)` rejects display properties: `Update('KCiLj',
{fontSize:11})` returns `Invalid properties: /fontSize unexpected property` and
**rolls the whole block back**, issue-clean operations included. Changing a
text's size means delete and re-insert the node, so anything that reorders
siblings has to be planned as a delete/re-insert pair rather than an edit.

## 2026-09-22 - narrower boxes, and a state the river cannot have

The human: **too wide, narrower, and the boxes may touch left and right.**

| | before | after |
| --- | --- | --- |
| box width | 42px | **38px** |
| gap between boxes | 28px | **6px** |
| box side padding | 14px | **6px** |
| channels across 700px | 10 | **15** |

The boxes nearly abut now, and the field reads as one dense body of water rather
than a row of columns. Character size stays 26px, so the words are unchanged;
only the padding around them shrank.

### "Already in the pool" is not a state a river word can have

The first tategaki pass kept three word states, including a translucent
"already caught" one. At fifteen channels the same word appears many times, so
marking exactly one instance as caught while its identical twins drift on
contradicts itself - and the engine agrees: the river's food *is* the learner's
lexicon and the captured pool (`src/lexicon/river-pool.js`), so a word being in
the pool does not remove it from the river.

The river now has two states:

| State | Box |
| --- | --- |
| drifting | white, pale blue hairline, ink text |
| hooked | solid tint, white text, tint shadow |

### Mockup filler, declared

A dense field drawn from the seed's 14 usable short words reads as wallpaper and
makes it impossible to judge whether the density works. **Twelve common nouns
were added for the mockup only** - 言葉 文章 意味 記憶 知識 読書 新聞 小説 著者
辞書 文脈 表現. They are not in `data.js` and would not ship; the real river
draws on a dictionary. If the sample vocabulary matters for review, say so and
they come out.

### A trap: a skipped Delete does not roll the block back

`Delete('Hq5wy')` returned *"Delete skipped: node does not exist"* as an **issue**
rather than an error, so the rest of the block still applied - the new river was
inserted while the old one stayed, and two 700x742 panels sat exactly on top of
each other. The checker's surface rule did not even flag it, because identical
boxes contain each other. When a block reports issues, read them: the id may
already be gone, and the id from the previous round is not the id of the node you
just created.

## 2026-09-22 - 川 becomes tategaki, and the water becomes one body

Two corrections from the human, and the second one changed the layout language:

1. **The river must be 縦書き.** Drawn the way the engine draws it - one
   character per cell, stacked downward - not a horizontal string rotated 90°.
   Each word is a **42px-wide rounded box** carrying its characters at 26px with
   `lineHeight: 1`, so a two-character word is 68px tall and a three-character
   word is 94px.
2. **Compact, and the channels should not be legible as channels.** One body of
   water, not seven lanes.

### The water is not a new colour

The surface is **`--tint` (`#007aff`) at 8% to 16%**, as a vertical gradient.
On white that is light blue, and it stays inside the token system - no
`--water-*` hue was invented. The top and bottom fades fade to **the water
colour**, not to white: a white fade on a blue surface shows up as a pale band.

Word boxes on water:

| State | Box |
| --- | --- |
| uncaught | white, pale blue hairline, ink text |
| already in the pool | white at 65%, muted text - caught, still drifting |
| hooked | **solid tint, white text**, one tint shadow - the loudest thing on the surface, which is correct |

### Compact means fewer rules, not more words

| | before | after |
| --- | --- | --- |
| channel | 100px | **70px** |
| gap between boxes | 58px | **28px** |
| vertical gap | 18px | **10px** |
| column rules | 6 white hairlines | **deleted** |
| channels x words | 7 x 7 | 10 x 8 |

The hairlines were doing the opposite of what a river wants: they turned a field
of drifting words into a table of columns. Removing them and closing the
horizontal gap is what makes it read as water.

### In tategaki the height is a function of the character count

A channel's content height is the **sum of its words' character counts**, so the
phase offset has to be computed from the actual words. The first pass treated
しかし as two cells instead of three, and the tail of three channels fell past the
board edge - cut off rather than clipped by the panel. Same class of mistake as
the reel placed off the rod: **anything attached to a variable-size thing must be
computed, not estimated.**

A related rule: the panel may clip a word's tail (that is "flowing out"), but
**nothing may extend past the board edge**, because there it is not clipped, it
is simply invisible - wasted nodes.

### Known mockup limitation

The board draws 80 word slots from the seed's **18** words, so words visibly
repeat. The real engine fills the river from the learner's lexicon, the captured
pool and a dictionary sample, so its stream does not repeat at this density. If
the repetition is distracting in review, the fix is filler vocabulary for the
mockup only - not a design change.

## 2026-09-22 - 川: the river, drawn rather than iconified

The human's brief: **the river down the left with every word inside a rounded
box, the bucket at the bottom right with the session's catch and some
information, and a fishing rod at the top right** - the rod for the pleasure of
it. Drawn as `Vocab - River (川) iPad landscape 1194x834`.

### The three regions

    left   700 wide   the river: five channels, ten words each
    right  446 wide   the rod above, the bucket below (300 / 430)

**A channel is full.** Words enter at the top edge and leave at the bottom edge;
a channel with three words in it and 300px of white below reads as an unfinished
drawing, not as a stream. Ten per channel at 38px with a 24px gap, each channel
phase-shifted 0-64px so the columns do not march in lockstep. Two white
gradients - 56px at the top, 160px at the bottom - make words arrive and depart
instead of starting and stopping.

Colour carries only state, as everywhere else:

| Word | Box |
| --- | --- |
| uncaught | white, hairline border, ink text |
| already in the pool | `--surface-2` fill, `--muted-2` text - taken, still drifting |
| hooked this cast | `--tint-soft` fill, tint border, one small tint shadow |

### The rod is vector, not an icon

Six nodes: the blank, a cork grip, a reel (two ellipses), the line, and an
`anchor` glyph standing in for the hook. Two lessons:

- **Put the reel on the segment.** The blank runs from `(26,264)` to `(414,46)`
  in panel coordinates, so the reel's centre belongs at `t=0.14` of that line -
  `(80,234)` - not placed by eye. Eyeballing it left the reel floating 70px above
  the rod, which is exactly what the first render showed.
- A `path` is only as big as its `viewBox`; keep the viewBox equal to the node
  box and the geometry is written in plain panel pixels, which is much easier to
  reason about than normalised coordinates.

The bucket is drawn the same way - one path for the body, one for the handle -
so the screen has real illustration rather than a stand-in glyph.

### What the bucket shows

`7 今回` against the drawn bucket, then the eight words caught this session as
chips, then a hairline and two statistics (`128 プール`, `6 新規`) with coloured
icons. The count is the headline; the list is the receipt.

### The checker learned about vector art

`designs/check-overlap.cjs` reported five "surface collisions" on this board. All
five were the rod, its line and the hook - three paths whose **bounding boxes**
must overlap, because that is what layering is. The surface rule is a UI rule, so
**paths are now exempt**; otherwise every illustration produces false positives.

## 2026-09-22 - the sidebar collapses, the state ramp runs on three layers, and rows carry a date

Three corrections from the human, all of them fair:

1. **The sidebar should collapse.**
2. **The state difference was too subtle** - "you cannot see the change; make the
   rail dim overall, for instance".
3. **Rows should carry more: a creation date, at least.**

### 1. Collapsing

The card header gets a `‹` button. Collapsed, the pane becomes a **64px strip**
holding nothing but the monograms, the toggle turning into a `›` at its top. The
detail pane grows from 794 to **1082**, but the word card's content column stays
fixed at **704px**: collapsing gives the page more margin, not a longer line.
That is the `--reading-measure` idea from `ui-redesign-plan.md` section 4 doing
real work. The grades get wider targets as a side effect, which is welcome.

Drawn as `Vocab - Practice (演習) - sidebar collapsed` - the same screen in its
other state, not a separate design.

### 2. The ramp, now on three layers

One layer was not enough: a pale monogram among ten rows is invisible. State is
now the monogram's weight **and** the rail's weight **and** the row's opacity,
and the three move together.

| Phase | Monogram | Rail | Row opacity |
| --- | --- | --- | --- |
| `review` | group colour, solid, white glyph | full colour | 100% |
| `learning` | group colour at **60%**, white glyph | group colour at **45%** | 100% |
| `sealed` | group colour at **18%**, glyph in the colour | **no colour at all** | 85% |
| `retired` | `--surface-3` with a muted glyph | pale grey | **50%** |

The two strongest signals are the ones worth remembering: **a sealed row has a
colourless rail**, and **a retired row is faded to half**. Both read at a glance
without a word. The `sealed` row's rail deliberately has no colour even though
the rail is where progress lives - "no colour yet" *is* the state.

### 3. The date

Each row now carries the creation date on its first line, as a 12px calendar
glyph plus the day (`9/12`), sitting between the name and the due date. It joins
at `--muted-2`; a first pass at `#c7c7cc` was unreadable at 11px, which defeats
the point of showing it.

The row is therefore: `name - created - due` over `rail - count`, both lines
right-aligned at their ends.

### A hex trap worth knowing before CSS

The state alphas are composed by appending to a colour that may already carry
alpha, and `#a05a0073` + `55` is a ten-digit `#a05a007355`, which the schema
rightly rejected. **A colour that already carries alpha cannot take more by
concatenation.** In CSS the equivalent mistake is trying to stack two alphas by
hand; use `color-mix()` or keep one alpha per declaration.

## 2026-09-22 - state is a weight of colour, and the brick row gets its information back

The human's correction to yesterday's pass: **the brick rows say too little**
(show the name and more), **without becoming cluttered**, and **state should be
carried by colour lightness and transparency**. That last one is the key: once a
state is a *weight of colour* it costs no words, which is what pays for the
information that came back.

### The state ramp

One ramp, four steps, applied to the brick's monogram. No state ever gets a word
of its own; where a state must be nameable it belongs in the tooltip and the
accessible name, not in the row.

| Phase | Monogram fill | Glyph | Reads as |
| --- | --- | --- | --- |
| `sealed` | group colour at **18%** | group colour | a hint of it |
| `learning` | group colour at **60%** | white | under way |
| `review` | group colour, solid | white | in rotation |
| `retired` | `--surface-3` `#e5e5ea` | `--muted-2` `#8e8e93` | put away |

Two supporting signals, and no more than two: a retired row's name drops to
`--muted-2` and its rail goes neutral grey. The current brick keeps its tint
wash, which is a *selection* rather than a state and so is allowed to be a
different kind of mark.

### The row is a two-line grid

Clutter comes from alignment, not from density. Every row is the same grid, so
ten of them read as a table rather than as ten designs:

    [monogram]  name ......................... due
                ten-cell rail ............... 3 / 10

Line one carries identity and the date; line two carries progress twice - once as
cells, once as a number - because the cells are the glance and the number is the
precision. Both right-hand values are flush, which is what keeps it calm.

**One thing to watch on the device:** the rail spans the row, so ten rows read as
ten dashed lines. At 352px the cells are about 20px and the effect is busy. If it
bothers you on the iPad, the calmer variant is a fixed 120px rail on line two
with the count beside it, leaving the right third of the line empty.

## 2026-09-22 - the vocabulary screens get a colour language, and lose the prose

The human's direction on 演習: **compact, fewer words, and let imagery and
colour carry the meaning.** That is a change of visual language rather than a
tidy-up, so it is written down as rules.

### The brick monogram

A brick is identified by **a coloured square carrying the first kanji of its
group** - 動 名 挨 副 表 接 - not by its name. Colour and glyph both come from the
group, and the two together read faster than 「動詞 3」 did. It is the same idea
as `brick-label.js`: the group *is* the identity, the name is one rendering of it.

| Group | Colour | Token |
| --- | --- | --- |
| 動詞 | `#007aff` | `--tint` (exists) |
| 名詞 | `#248a3d` | `--success` (exists) |
| 挨拶 | `#a05a00` | `--warn` (exists) |
| 副詞 | `#30b0c7` | **new** - iOS systemTeal |
| 表現 | `#af52de` | **new** - iOS systemPurple |
| 接続詞 | `#5856d6` | **new** - iOS systemIndigo |

**This needs three new tokens, and that is an interface change.** `tokens.css`
carries tint, success, danger and warn only. Six groups need six hues, and
inventing ad-hoc hexes inside components is precisely what the token file exists
to prevent. All three additions are iOS system colours, so they belong in the
palette rather than beside it, and each needs its dark-theme value.

### What colour and graphics replaced

| Was | Now |
| --- | --- |
| `3 / 10` | a ten-cell micro rail - the filled cells *are* the count |
| `今` / `明日` / `3日後` | one dot, coloured by urgency: tint now, warn soon, muted later |
| `動詞 3` | the monogram |
| `・ 動詞` beside the reading | a small monogram beside it |
| the `定義` eyebrow | a colour rail down the card's left edge |
| `見るだけ` | an eye icon button |
| `スペースでめくる、1-4 で評価` | deleted - the surface no longer explains itself in a sentence |
| `1分` / `6分` / `10分` / `4日` | a five-cell span bar per grade - **see the trade-off** |
| the four statistic labels | one coloured icon per tile |

### Two trade-offs, flagged rather than hidden

1. **The grade intervals lost their numbers.** The five-cell bar says "shorter /
   longer" but not "10分". For an SRS that may be too much to surrender. The
   exact interval can live in the tooltip and the accessible name, or return as
   11px text. The human's call.
2. **The per-row rail is ten cells at roughly 20px each**, which at a glance
   reads as a dashed rule. A continuous bar with a filled fraction is calmer;
   the ten cells are what encode "out of ten". Worth a second look on the device.

### Layout, tightened

Margins 24 to 18, gutter 16 to 12, content top 86 to 74, list rows 74 to 63, and
the list shows ten rows rather than seven because a queue is a queue. The left
pane narrows 400 to 352 and the right grows 730 to 794 - the reclaimed width goes
into a 72px headword and a 22px definition, which is where it earns its keep.

`designs/design.pen` now holds exactly two boards: the compact 演習 and the
navigation states. The earlier 演習 board and the pre-navigation main board are
deleted; their renders are kept in `designs/exports/`.

## 2026-09-22 - 演習 is drawn, passive is deleted, and the brick list has two homes

Two decisions from the human, and the screen that follows:

- **`passive` is deleted, not moved.** The passive exposure track is gone from
  the product. It is not waiting for a home.
- **The brick list belongs to both 演習 and 海**, because a brick exists for the
  sake of practice. In 演習 it is the queue being worked through; in 海 it is the
  practice half of the overview.

That closes both gaps left open yesterday. The mapping is now complete:

| Old wordbook view | Where it lives |
| --- | --- |
| brick | 語彙 › 演習 - the drill |
| bricks | 語彙 › 演習 - the queue, **and** 語彙 › 海 - the overview |
| river | 語彙 › 川 |
| pool | 語彙 › 池 |
| lexicon, data | 語彙 › 海 |
| passive | **deleted** |

### 演習 is master-detail

Drawn as `Vocab - Practice (演習) iPad landscape 1194x834`. Once the list lives
here, 演習 is no longer one card - it is a queue plus the card you are on, which
is the iPad split-view idiom and uses the landscape width honestly:

- **Left, 400 wide, one inset card.** Header (`演習`, `7 ブリック`), four compact
  statistics, then the list. Seven rows at 74px, the current brick tinted with
  its due date in the tint. Row heights are `fill_container` so the list fills
  the card rather than stranding space at the bottom.
- **Right, 730 wide.** The session row (`3 / 10`, `認識`, the brick's name,
  `見るだけ`), the progress rail, the word card, the hint, and the four grades in
  one row along the bottom - the bottom edge is the thumb zone in landscape.

Why not a switcher inside the page: the sub-navigation already lives in the
global capsule. A second switcher here would repeat the mistake the segmented
control was.

Brick names on the board are real, not invented. `brick-label.js` returns
`group.value` unchanged when a brick's group is a part of speech, so a POS brick
is literally named 名詞 or 動詞; the seven names are the seed's own tags
(動詞 名詞 挨拶 表現 副詞 接続詞) plus the sequence suffix `brickLabel` appends.

### Text that loses its consumer

When the markup moves to the global bar, the in-page tab labels have no reader
left: `wb.tab.brick`, `wb.tab.river`, `wb.tab.passive`, `wb.tab.pool`,
`wb.tab.bricks`, `wb.tab.browse`, `wb.tab.data`, and everything under
`wb.passive.*` - in all three languages. The sub-navigation needs four new keys
(演習 / 川 / 池 / 海) and the primary navigation three (ホーム / 読書 / 語彙).
Removing strings is `assets/js/i18n.js`, which is shared: `REQUEST:` before
editing it.

### A canvas defect that affects every export

**The Pencil canvas injects anonymous text nodes into the board it is editing.**
This session they appeared both at the top level and *inside* a board, so they
render into the exported PNG: `pen login` (six of them) and `Rows: 名詞` (two,
landing on top of the definition inside the word card).

`designs/check-overlap.cjs` is what caught them - the text-on-text rule fired on
a node nobody authored, and the render agreed. They are deleted, but they return:
roughly one per write. Budget a cleanup pass at the end of every design round and
re-run the checker instead of assuming the board is clean.

## 2026-09-22 - the architecture is three sections, and 語彙 carries four views

The human's structure, in substance:

    ホーム / 読書 / 語彙             the global navigation
      語彙 > 演習 / 川 / 池 / 海    the vocabulary section's sub-navigation

- 川 and 池 **inherit the designs that already exist**: 川 is the word river
  (tategaki canvas, the rod, one word per cast), 池 is the word pool (the
  captured words and the enrolment that cards them into bricks).
- 海 is **new**: the dictionary and the word overview combined.
- Drawn as `Global nav - states`. ホーム and 読書 keep the capsule compact; 語彙
  expands it in place, the four sub-items appearing after a hairline. The
  sub-items carry no icons, and that is the whole hierarchy cue - no nested
  track, no second colour, no second bar.

**Consequence: the in-page segmented control is gone.** The main board used to
carry `ブリック / 単語の川 / 受け身` in its right rail. With 演習 / 川 / 池 / 海 in
the global bar that control was the same navigation drawn twice. Removing it
frees the rail; the session row and the progress rail move up to y=424 and
y=472, and the rail's three groups (statistics, session state, grading) end up
evenly spaced at 114px.

**The 44pt problem, and how it is solved.** The capsule is 46px tall with 34px
items, because that is what "small and refined" costs. The project's own rule is
a 44pt minimum target (`ja-vocab-book-redesign.md` section 2). The two are
reconcilable without touching the look: the item stays 34px visually and its hit
area extends to 44px with a pseudo-element. It is written on the spec board so
whoever writes the CSS does not have to choose between the rule and the design.

### What the new architecture leaves unassigned

The old wordbook had seven views - `brick river passive pool bricks lexicon
data`. The new structure names four. Proposed, for confirmation:

| Old view | Proposed home |
| --- | --- |
| brick | 語彙 > 演習 |
| river | 語彙 > 川 |
| pool | 語彙 > 池 |
| lexicon, data (dictionary import) | 語彙 > 海 |
| passive | **unassigned** |
| bricks (the brick list) | **unassigned** - 演習's list, or 海 |

### REQUEST

    REQUEST: move the IA and its load-bearing hooks in one commit
      to: agent-wordbook (study.html and the tests), agent-reader (the shell)
      why: the tests are the behavioural contract and every one of them moves
        with this. `tests/shell.test.js` asserts `data-tab="reader|learn|
        overview"` and the seven `data-view` names; `tests/wordbook-sections
        .test.js` asserts `data-section="learn|overview"`; `tests/pages
        .test.js` asserts `data-i18n="wb.title"`; `tests/lang-switch.test.js`
        asserts `wb.tab.passive`. Split across commits, main is red and every
        push deploys.
      blocks: the wordbook restyle, not the engine
      needs-by: before the markup changes

Also, ホーム: `index.html` is still a marketing hero. In a three-tab app whose
first tab is ホーム, a hero is the wrong surface - it is the app's front door,
not a landing page. Not drawn yet; it is the next board after 演習 / 川 / 池 / 海.

## 2026-09-22 - the global navigation is a compact floating capsule at the top

The human's brief for the main interface: **modern iOS style, and one small
refined navigation bar that spans every page.** That answers the REQUEST filed
yesterday in this log, and it supersedes the bottom tab bar recorded in
`ui-redesign-plan.md` section 7 and in the `ja-vocab-book-redesign.md` decision
table.

The bar as drawn:

- One floating capsule, horizontally centred at the top. Height 46, radius 23,
  padding 6, item height 34, icons 17, labels 12.
- Contents: the ML brand mark, the three destinations (リーダー / 学習 / 総覧) as
  icon + label, a hairline divider, the interface language, and `⋯`.
- Material: `rgba(249,249,249,0.84)`, a 20px background blur, a hairline border
  and one soft shadow. **Nothing else on the page carries a shadow.**
- The active destination is a tint-soft pill inside the capsule. The capsule
  itself never moves, so the bar is byte-for-byte identical on all three pages;
  only the active pill changes. The three states are drawn as
  `Global nav - three states`.
- **The bottom tab bar is gone.** That returns 69px of vertical space, which is
  why the main board's content now reaches y=750 instead of y=741.

Drawn: `Main - Learn / Brick (iPad landscape 1194x834)` - one board, the main
interface. Removed from the canvas as superseded: the portrait board, and the
earlier landscape board that had a bottom tab bar. Both renders are kept in
`designs/exports/`.

### Geometry is machine-checked now, not eyeballed

`designs/check-overlap.cjs` lays the .pen out in two passes and reports
out-of-bounds nodes, glyph-on-glyph collisions, same-parent surface collisions,
and text that cannot fit. All four are **zero** on both boards.

Three traps it had to learn, each of which produced a screenful of false
positives first - worth knowing before anyone writes a similar check:

1. **A frame's `layout` defaults to `horizontal`, and the writer omits the
   property when it matches the default.** Reading `undefined` as `none` places
   every child of every row at the origin and fabricates collisions everywhere.
2. A `text` or `icon` node must never go through the container sizing path; it
   measures to zero width and every box downstream collapses.
3. `fill_container` children have no width until the parent resolves it, so
   sizing must be two passes. One pass silently substitutes the board width and
   reports content as out of bounds.

### REQUEST

    REQUEST: the bottom tab bar decision is superseded by a top floating capsule
      to: agent-reader, agent-wordbook
      why: `docs/ui-redesign-plan.md` section 7 and the decision table in
        `docs/ja-vocab-book-redesign.md` section 6 still record "Bottom tab bar:
        Reader / Learn / Overview". That is now wrong, and both files belong to
        other agents. The three destinations are unchanged - only the control
        and its position - so `#tabbar`, `.tabbar-item[data-tab=...]` and the
        other load-bearing hooks in agent-visual-brief.md section 5 can keep
        their names and the tests keep passing.
      blocks: the shell's restyle, not its behaviour
      needs-by: whenever

For whoever writes the CSS: the capsule is the only element allowed a shadow,
and it depends on `backdrop-filter`. Where that is unsupported the 0.84 alpha
fill has to carry the material alone.

## 2026-09-22 - the target is landscape, and the first screen is drawn

The human set the constraint plainly: **the interaction design and the UI are
for iPad and iOS users, so the layout target is landscape first.** That moves
several things, and they are worth writing down because two of them contradict
what the site does today.

- The primary artboard is **1194 x 834** (iPad 11", landscape), not portrait.
- Landscape frees horizontal room, so the brick session becomes **two columns**:
  the card is the left pane (700 wide, the document surface) and a 422-wide
  right rail carries the session state and the grading. A portrait stack merely
  widened to 1194 would have produced a 1036-wide card with a line far too long
  to read - this is why the change is a composition change, not a rotation.
- **The large title collapses into the navigation bar.** Landscape leaves 697
  usable vertical pixels rather than 1126; a 34px large title plus a subtitle
  spends about 70 of them and carries no information. `単語帳` sits beside the
  brand as the compact title.
- The right rail is **two groups, not one**: session statistics at the top, and
  `segmented control -> session row -> progress rail -> grade grid` as a single
  cluster anchored to the bottom, where a two-handed grip puts both thumbs. The
  gap deliberately sits between the two groups rather than above the actions.
- The grades become a **2x2 grid in the rail** instead of a 1x4 row along the
  bottom: four 207-wide targets in the bottom corner beat four 191-wide ones
  under the middle of the screen.
- `--reading-measure` earns its keep here: the definition column is capped at
  600px inside a 700px card.

Drawn and self-checked in `designs/design.pen` (untracked, never deployed):
`Learn - Brick (iPad landscape 1194x834)`. Content is real seed data
(学ぶ / まなぶ ・ 動詞 / 教えや経験から知識・技能を身につける。); no invented
copy. The portrait board is kept as a secondary artboard until the direction
settles - nothing in it is deleted.

### REQUEST

    REQUEST: is the bottom tab bar right on iPad in landscape?
      to: agent-reader
      why: a bottom tab bar is a phone pattern. iPadOS moves its tab bar to the
        top as a floating control, and a 1194-wide window has room for a
        sidebar. The three-destination decision stands either way - only its
        placement is in question, and it is the shell's file now.
      blocks: the shell's landscape styling
      needs-by: no rush

### Open, for the human

The card is 649px tall and holds about 250px of content. One word in focus with
generous margins is a deliberate reading surface, but the proportion is a choice
and not a default: the alternative is a ten-word progress strip under the card,
which would also visualise the `3 / 10` counter that currently exists only as
text.

## 2026-09-22 - taking the visual layer, and rendering the design before writing CSS

The human reassigned this work to a third agent (this log) on 2026-09-22:
**agent-visual owns the design system, the shell, motion and interaction, and
the reader's visual layer.** That supersedes the reassignment recorded in
`log-reader.md` ("UI, motion and interaction come to me") and in
`brief-visual.md`, and it revives the territory `agent-visual-brief.md`
proposed. Read first, as the protocol requires: `agent-visual-brief.md`,
`brief-visual.md`, `README.md`, both other logs, `git log --oneline -15`,
`git status --short`. Also read: `ui-redesign-plan.md`,
`ja-vocab-book-redesign.md`, `ja-reader-ios-interaction.md`, all five
stylesheets, `shell.js`, `app.js`, the six pages, and the tests that assert on
markup. `npm test` is **337 pass** on a clean tree.

The human also decided the shape of the work: the design is **drawn and
approved as a rendered artifact before any CSS is written.**
`designs/design.pen` is that artifact. It is untracked and not deployed.

### CLAIM

    CLAIM: assets/css/**   tokens.css, shell.css, style.css, wordbook.css, and
                           a new motion.css
      for: the ui-redesign-plan rollout - tokens, motion, the component
           restyle. No selector in agent-visual-brief.md section 5 is renamed
           without its test changing in the same commit.
    CLAIM: assets/js/shell.js
      for: the shell behaviour the motion layer needs. window.Shell / ML.shell,
           .shell-content and the z scale all stay as they are.
    CLAIM: reader/reader.css
      for: the reader's visual layer only - --page-* tokens, --hl-* highlight
           colours, the progress rail, the embedded state. The reader's
           structure and everything in reader/js/** stays agent-reader's, and
           brief-visual.md section 2 applies unchanged.
    CLAIM: designs/design.pen
      for: the rendered design, reviewed before CSS moves.
    NOT CLAIMED: reader/index.html, reader/js/**, assets/js/app.js,
                 assets/js/i18n.js, root *.html markup, src/lexicon/**,
                 tests/** - each of those is a REQUEST to its owner.

### REQUEST

    REQUEST: pause ui-redesign-plan step 1 (tokens) and step 2 (motion)
      to: agent-reader
      why: the human reassigned the design system, the shell, motion and
        interaction to agent-visual, and steps 1 and 2 are exactly those files.
        Your log says you start unless someone flags a conflict. This is the
        flag.
      blocks: everything claimed above - two writers on tokens.css is the one
        thing the protocol cannot survive
      needs-by: now

    REQUEST: add agent-visual to the ownership map in docs/coordination/README.md
      to: agent-reader
      why: the map still gives assets/css/** and assets/js/shell.js to you, and
        README.md is the file every agent reads first
      blocks: nothing; this log carries the claim meanwhile
      needs-by: whenever

    REQUEST: keep the reader's token aliases for one release
      to: agent-reader
      why: the reader's stylesheet is being rewritten onto --page-* and --hl-*,
        and reader/js/** reads --reader-size, --paper, --ink, --accent, --line
        from computed style. If those names disappear in the same commit the
        reader's own chrome breaks on a page I do not own.
      shape: reader.css keeps --paper/--ink/--accent/--line/--reader-size as
        aliases of the new --page-* names for one release; nothing in
        reader/js/** changes
      blocks: the reader's restyle, not its behaviour
      needs-by: no rush

### What the audit found in the CSS as it stands

Measured, not guessed. None of it is fixed yet.

1. **Two accents with no rule.** `tokens.css` `--tint #007aff` against
   `reader.css` `:root` `--accent #7a5c3e`. `ui-redesign-plan.md` section 3
   decides "blue acts, sepia reads" and nothing in the code enforces it.
2. **No motion language.** Six hand-written durations: sheet 0.28s
   (shell.css:169), backdrop 0.22s (:152), compact title 0.18s (:53), btn
   0.06s and 0.15s (style.css:123), progress fill 0.2s (wordbook.css:68). The
   `--motion-fast|base|slow` names the plan defines do not exist in any file.
3. **Touch targets below the project's own 44px rule.** `.btn-small` is about
   33px, `.wb-tab` (a bare `.btn`) about 37px, and reader buttons set
   `min-height: 40px` explicitly (reader.css:75) - while `--touch: 44px` sits
   unused in tokens.css.
4. **Tokens bypassed.** `.container` hard-codes `padding: 0 22px`
   (style.css:42) against `--page-pad`; `.btn` hard-codes `999px`
   (style.css:122) against `--radius-pill`; `h1` builds its own scale with
   `clamp()` against `--text-*`.
5. **Dead style.** `.site-header`, `.site-nav`, `.nav-toggle`, `.brand`,
   `.theme-toggle` have no user left (`tests/shell.test.js:23` asserts
   `class="site-header"` must be gone) and still ship in style.css.
6. **The river's mask is on the wrong axis.** `.wb-river` fades with
   `linear-gradient(90deg, ...)` (wordbook.css:230) while the field has been
   vertical since P2. The columns run top to bottom, so the fade belongs on
   the vertical edges.
7. **A duplicate id.** `study.html:100` and `study.html:107` are both
   `id="wbRiver"` - invalid HTML that currently works only because
   `getElementById` returns the first match in document order, which happens to
   be the panel `VIEWS.river.panel` wants.
8. **`.wb-review-top .btn { margin-left: auto }`** (wordbook.css:52) gives
   *every* button in the row an auto margin, which scatters them once there is
   more than one.
9. **Accessibility and reduced motion.** `.wb-tabs` carries `role="tablist"`
   but its buttons have no `role="tab"` and no `aria-selected`;
   `prefers-reduced-motion` is honoured by the sheet and the reader's spinner
   but not by `.btn:active` or the progress transition.
10. **The route forgets the view.** Learn to River, then Overview, then back:
    `route()` calls `setView('brick')` and the learner lands on Brick again
    (entry.js:914). The section remembers nothing.

Items 6 to 8 need no design decision and can be fixed whatever the direction
becomes. Items 1 to 5 and 9 to 10 are the rollout.

### State

337 tests pass. No file outside `docs/coordination/log-visual.md` and
`designs/` has been touched. The rendered design comes next, for review,
before any CSS changes.
